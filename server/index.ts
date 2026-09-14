import "dotenv/config";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import {
  subagentTranscript,
  type Turn,
  withoutReasoning,
} from "../shared/model.ts";
import {
  operationRequest,
  rpcAllowlist,
  rpcQueries,
} from "../shared/resources.ts";
import { exportConversation } from "./export.ts";
import { Hermes, HermesHttpError } from "./hermes.ts";
import { equal, hash, identity, randomSecret } from "./identity.ts";

const keys = await identity();
const publicUrl = new URL(
  process.env.ARURA_PUBLIC_URL || "http://localhost:5173",
);
const convexUrl = process.env.CONVEX_URL || "http://127.0.0.1:3210";
const convex = new ConvexHttpClient(convexUrl);
async function refreshAuth() {
  convex.setAuth(await keys.sign("arura:adapter"));
}
await refreshAuth();
const authTimer = setInterval(() => void refreshAuth().catch(report), 180000);
const hermes = new Hermes();
const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed";
const cookieName = "arura_session";
const cookie = (secret: string, maxAge: number) =>
  `${cookieName}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${
    publicUrl.protocol === "https:" ? "; Secure" : ""
  }`;
async function authenticated(request: Request) {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (!raw) throw new Error("Authorization required");
  const d = await convex.query(anyApi.devices.resolve, {
    secretHash: hash(raw),
  });
  if (!d) throw new Error("Device access revoked");
  return d as { id: string; name: string };
}
async function userClient(request: Request) {
  const d = await authenticated(request);
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(await keys.sign(d.id));
  return { client, device: d };
}
const attempts = new Map<string, { count: number; since: number }>();
let maintenanceRunning = false;
const fileWrites = new Map<string, Promise<unknown>>();
const activeCommands = new Set<string>();
hermes.on("settled", (key: string) => activeCommands.delete(key));
let processing = false;
let recovered = false;
let reconciling: Promise<void> | undefined;
let reconcileAgain = false;
const watched = new Set<string>();
const lastActivity = new Map<string, number>();
const historyJobs = new Map<string, Promise<void>>();
function syncHistory(key: string, offset = 0): Promise<void> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % 100) {
    return Promise.reject(new Error("Invalid history page"));
  }
  const work = (historyJobs.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const head = await hermes.history(key);
        await convex.mutation(anyApi.workspace.ingest, { page: head });
        if (!offset) return;
        const page = await hermes.history(key, offset);
        const after = await hermes.history(key);
        if (head.revision !== after.revision) continue;
        await convex.mutation(anyApi.workspace.ingest, {
          page: { ...page, headRevision: head.revision },
        });
        return;
      }
      throw new Error(
        "Conversation changed while loading older messages. Try again when the turn settles.",
      );
    });
  historyJobs.set(key, work);
  void work
    .finally(() => {
      if (historyJobs.get(key) === work) historyJobs.delete(key);
    })
    .catch(() => {});
  return work;
}

async function migrateProfile(
  from: string,
  to: string,
  conversations: Awaited<ReturnType<Hermes["list"]>>,
) {
  const ids = conversations
    .filter((c) => c.profile === to)
    .map((c) => c.sourceId);
  for (let i = 0; i < ids.length; i += 50) {
    await convex.mutation(anyApi.profiles.renamed, {
      from,
      to,
      sourceIds: ids.slice(i, i + 50),
    });
  }
  await convex.mutation(anyApi.profiles.finishRename, { from });
  hermes.forgetProfile(from);
  for (const key of watched) {
    if (JSON.parse(key)[0] === from) {
      watched.delete(key);
      lastActivity.delete(key);
      turnBuffer.delete(key);
    }
  }
}
async function reconcile() {
  if (reconciling) {
    reconcileAgain = true;
    return reconciling;
  }
  reconciling = (async () => {
    do {
      reconcileAgain = false;
      const conversations = await hermes.list();
      const pending = await convex.query(anyApi.profiles.pendingRenames, {});
      const profiles = new Set(conversations.map((c) => c.profile));
      for (const rename of pending) {
        if (!profiles.has(rename.from) && profiles.has(rename.to)) {
          await migrateProfile(rename.from, rename.to, conversations);
        }
      }
      const existing = await convex.query(anyApi.workspace.sourceKeys, {});
      const keys = new Set(conversations.map((c) => c.key));
      await convex.mutation(anyApi.workspace.ingest, {
        conversations,
        deletedKeys: existing.filter((key: string) => !keys.has(key)),
        online: true,
        changed: true,
      });
      await convex.mutation(anyApi.artifacts.schedule, {
        conversations: conversations.map(({ key, activityAt }) => ({
          key,
          activityAt,
        })),
      });
      for (const c of conversations) {
        if (watched.has(c.key) && lastActivity.get(c.key) !== c.activityAt) {
          await syncHistory(c.key);
        }
        lastActivity.set(c.key, c.activityAt);
      }
    } while (reconcileAgain);
  })().finally(() => {
    reconciling = undefined;
  });
  return reconciling;
}
const turnBuffer = new Map<string, Turn>();
hermes.on("started", (key: string) => {
  void syncHistory(key).catch(report);
});
let indexingFiles = false;
const artifactTimer = setInterval(async () => {
  if (indexingFiles || !hermes.online) return;
  indexingFiles = true;
  try {
    const scan = await convex.query(anyApi.artifacts.next, { now: Date.now() });
    if (scan) {
      try {
        const page = await hermes.history(scan.conversation, scan.offset);
        await convex.mutation(anyApi.artifacts.record, {
          id: scan._id,
          scan: scan.scan,
          offset: scan.offset,
          hasMore: page.hasMore,
          files: page.artifacts,
        });
      } catch (error) {
        await convex.mutation(anyApi.artifacts.record, {
          id: scan._id,
          scan: scan.scan,
          offset: scan.offset,
          hasMore: false,
          files: [],
          error: errorMessage(error).slice(0, 300),
        });
      }
    }
  } catch (error) {
    report(error);
  } finally {
    indexingFiles = false;
  }
}, 1000);
hermes.on("turn", (turn: Turn) => turnBuffer.set(turn.conversation, turn));
hermes.on("reconcile", () => void reconcile().catch(report));
hermes.on("resync", (key: string | undefined) => {
  if (key) void syncHistory(key).catch(report);
});
hermes.on(
  "changed",
  () =>
    void convex
      .mutation(anyApi.workspace.ingest, { changed: true })
      .catch(report),
);
hermes.on("connection", (online: boolean) => {
  void convex.mutation(anyApi.workspace.ingest, { online }).catch(report);
  if (online) void reconcile().catch(report);
});
hermes.on("fault", report);
hermes.on("complete", (key: string, turn: Turn) => {
  void convex
    .mutation(anyApi.workspace.ingest, {
      notice: {
        id: `${key}:${turn.startedAt}`,
        conversation: key,
        title:
          turn.state === "complete" ? "Reply ready" : "Hermes needs attention",
      },
    })
    .catch(report);
  void syncHistory(key).catch(report);
  activeCommands.delete(key);
});
function report(error: unknown) {
  console.error(errorMessage(error).slice(0, 300));
}
let flushingTurns = false;
const flushTimer = setInterval(async () => {
  if (flushingTurns) return;
  flushingTurns = true;
  try {
    for (const [key, turn] of turnBuffer) {
      turnBuffer.delete(key);
      try {
        await convex.mutation(anyApi.workspace.ingest, { turn });
      } catch (error) {
        if (!turnBuffer.has(key)) turnBuffer.set(key, turn);
        report(error);
      }
    }
  } finally {
    flushingTurns = false;
  }
}, 150);
async function processCommands() {
  if (processing || !hermes.online) return;
  processing = true;
  try {
    if (!recovered) {
      await convex.mutation(anyApi.commands.recover, {});
      recovered = true;
    }
    const commands = await convex.query(anyApi.commands.queue, {
      blocked: [...activeCommands.keys()],
    });
    for (const queued of commands) {
      if (queued.kind === "send" && activeCommands.has(queued.conversation)) {
        continue;
      }
      const command = await convex.mutation(anyApi.commands.claim, {
        id: queued._id,
      });
      if (!command) continue;
      const { kind, payload, conversation: key } = command;
      const alreadyRunning = activeCommands.has(key);
      try {
        let result: any = { ok: true };
        if (kind === "create") {
          result = await hermes.create(payload.profile ?? "default");
          await convex.mutation(anyApi.workspace.ingest, {
            conversations: [result],
          });
        } else if (kind === "openBot") {
          result = await hermes.openBot(String(payload.profile ?? "default"));
          await convex.mutation(anyApi.workspace.ingest, {
            conversations: [result],
          });
        } else if (kind === "branch") {
          result = await hermes.branch(key, String(payload.messageId));
          await convex.mutation(anyApi.workspace.ingest, {
            conversations: [result],
          });
        } else if (kind === "load") {
          watched.add(key);
          await syncHistory(key, Number(payload.offset ?? 0));
        } else if (kind === "send") {
          if (typeof payload.text !== "string" || !payload.text.trim()) {
            throw new Error("Write a message first");
          }
          const session_id = await hermes.attach(key);
          for (const attachment of payload.attachments ?? []) {
            if (attachment.image && typeof attachment.path === "string") {
              await hermes.call("image.attach", {
                session_id,
                path: attachment.path,
              });
            }
          }
          let prompt = payload.text;
          let shouldSubmit = true;
          if (prompt.startsWith("/") && !payload.edit) {
            const [, name, arg = ""] = prompt
              .trim()
              .match(/^\/(\S+)(?:\s+([\s\S]*))?$/)!;
            try {
              result = await hermes.call("command.dispatch", {
                session_id,
                name,
                arg,
              });
            } catch (error) {
              if (
                !(error instanceof Error) ||
                !error.message.startsWith(
                  "not a quick/plugin/bundle/skill command:",
                )
              ) {
                throw error;
              }
              result = await hermes.call("slash.exec", {
                session_id,
                command: prompt,
              });
            }
            shouldSubmit =
              ["send", "skill"].includes(result.type) &&
              typeof result.message === "string";
            if (shouldSubmit) prompt = result.message;
          }
          if (shouldSubmit) {
            activeCommands.add(key);
            result = await hermes.call(
              "prompt.submit",
              {
                session_id,
                text: prompt,
                ...(payload.edit
                  ? {
                      truncate_before_row_id: payload.edit,
                      confirm_truncate: true,
                      confirm_empty_truncate: true,
                    }
                  : {}),
                profile: JSON.parse(key)[0],
              },
              1800000,
            );
          }
        } else if (kind === "rename" || kind === "delete") {
          const [profile, id] = JSON.parse(key);
          result = await hermes.rest(
            `/api/sessions/${encodeURIComponent(id)}${
              kind === "delete" ? "?" + new URLSearchParams({ profile }) : ""
            }`,
            kind === "delete" ? "DELETE" : "PATCH",
            kind === "rename" ? { title: payload.title, profile } : undefined,
          );
          await reconcile();
        } else if (kind === "rpc") {
          if (!rpcAllowlist.has(payload.method)) {
            throw new Error("Unsupported action");
          }
          const session_id = key ? await hermes.attach(key) : undefined;
          result = await hermes.call(payload.method, {
            ...payload.params,
            ...(session_id ? { session_id } : {}),
          });
          if (payload.method === "subagent.tail") {
            result.text = subagentTranscript(
              String(result.text ?? ""),
              payload.params?.details === true,
            );
          }
          const dispatch = result.dispatch ?? result;
          if (
            ["send", "skill"].includes(dispatch.type) &&
            typeof dispatch.message === "string"
          ) {
            activeCommands.add(key);
            await hermes.call(
              "prompt.submit",
              { session_id, text: dispatch.message },
              1800000,
            );
          }
          if (
            payload.params?.request_id &&
            ["approval.respond", "clarify.respond"].includes(payload.method)
          ) {
            hermes.answered(
              key,
              payload.params.request_id,
              result.status === "expired"
                ? undefined
                : payload.params.question_id,
              payload.params.answer,
              Array.isArray(result.remaining) ? result.remaining : undefined,
            );
            if (
              result.status === "expired" ||
              (payload.method === "approval.respond" &&
                result.resolved === false)
            ) {
              throw new Error(
                "This input request expired or was already answered.",
              );
            }
          }
        }
        await convex.mutation(anyApi.commands.finish, {
          id: command._id,
          status:
            kind === "send" && activeCommands.has(key)
              ? "accepted"
              : "complete",
          result: withoutReasoning(result),
        });
      } catch (error) {
        const message = errorMessage(error);
        const unknown = /unknown|disconnected|timed out/i.test(message);
        if (!unknown && !alreadyRunning) activeCommands.delete(key);
        await convex.mutation(anyApi.commands.finish, {
          id: command._id,
          status: unknown ? "unknown" : "error",
          error: message,
        });
      }
    }
  } catch (error) {
    report(error);
  } finally {
    processing = false;
  }
}
const commandTimer = setInterval(() => void processCommands(), 500);
const reconcileTimer = setInterval(() => void reconcile().catch(report), 30000);
let checkingBackup = false;
async function checkBackup() {
  if (checkingBackup) return;
  checkingBackup = true;
  try {
    const backup = await convex.query(anyApi.backups.pending, {});
    if (!backup) return;
    if (backup.status === "starting") {
      if (Date.now() - backup._creationTime > 60000)
        await convex.mutation(anyApi.backups.update, {
          id: backup._id,
          status: "error",
          error:
            "The adapter restarted or lost contact before the backup was acknowledged. Check Hermes before starting another backup.",
        });
      return;
    }
    const status = await hermes.rest("/api/actions/backup/status");
    if (
      status.pid !== backup.pid ||
      (!status.running && status.exit_code !== 0)
    ) {
      await convex.mutation(anyApi.backups.update, {
        id: backup._id,
        status: "error",
        error:
          "Hermes could not confirm that this backup finished successfully. Check the host action logs.",
      });
    } else if (!status.running) {
      await convex.mutation(anyApi.backups.update, {
        id: backup._id,
        status: "complete",
      });
    }
  } finally {
    checkingBackup = false;
  }
}
const backupTimer = setInterval(() => void checkBackup().catch(report), 2000);

async function handle(request: Request, ip: string): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.get("origin") !== publicUrl.origin) {
      return json({ error: "Request origin denied" }, 403);
    }
  }
  if (request.method === "GET" && path.startsWith("/api/mcp/oauth/callback/")) {
    const name = decodeURIComponent(
      path.slice("/api/mcp/oauth/callback/".length),
    );
    const state = url.searchParams.get("state");
    if (
      !name ||
      name === "." ||
      name === ".." ||
      /[\\/]/.test(name) ||
      [...name].some((character) => character.charCodeAt(0) < 32) ||
      name.length > 512 ||
      !state ||
      state.length > 2048
    ) {
      return json({ error: "Invalid authorization callback" }, 400);
    }
    const params = new URLSearchParams({ state });
    for (const key of ["code", "error"]) {
      const value = url.searchParams.get(key);
      if (value && value.length > 16384) {
        return json({ error: "Invalid authorization callback" }, 400);
      }
      if (value) params.set(key, value);
    }
    // Hermes validates the one-time OAuth state. Cross-site redirects cannot
    // carry Arura's Strict cookie; only this callback bypasses device login.
    const result = await hermes.request(
      `/api/mcp/oauth/callback/${encodeURIComponent(name)}?${params}`,
    );
    return new Response(result.body, {
      status: result.status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (path === "/api/bootstrap") {
    return json({
      convexUrl: process.env.CONVEX_PUBLIC_URL ?? convexUrl,
      name: "Arura",
    });
  }
  if (path === "/.well-known/jwks.json") return json(keys.jwks);
  if (path === "/auth/login" && request.method === "POST") {
    const now = Date.now();
    let a = attempts.get(ip);
    if (!a || now - a.since > 600000) {
      a = { count: 0, since: now };
      attempts.set(ip, a);
    }
    if (++a.count > 20) {
      return json(
        { error: "Too many attempts. Try again in ten minutes." },
        429,
      );
    }
    const body = await request.json();
    if (typeof body.code !== "string" || typeof body.name !== "string") {
      return json(
        { error: "Enter an authorization code and device name" },
        400,
      );
    }
    const bootstrap =
      Boolean(process.env.ARURA_ACCESS_KEY) &&
      equal(body.code, process.env.ARURA_ACCESS_KEY!);
    const secret = randomSecret(),
      id = crypto.randomUUID();
    await convex.mutation(anyApi.devices.authorize, {
      id,
      secretHash: hash(secret),
      name: body.name,
      bootstrap,
      ...(!bootstrap ? { inviteHash: hash(body.code) } : {}),
    });
    attempts.delete(ip);
    return json({ id }, 200, {
      "set-cookie": cookie(secret, 60 * 60 * 24 * 365),
    });
  }
  if (path === "/auth/token") {
    const { device: d, client } = await userClient(request);
    await client.mutation(anyApi.devices.touch, {});
    return json({ token: await keys.sign(d.id), device: d });
  }
  if (path === "/api/search" && request.method === "GET") {
    await authenticated(request);
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!query || query.length > 200) return json({ results: [] });
    return json({ results: await hermes.search(query) });
  }
  if (path === "/api/respond" && request.method === "POST") {
    await authenticated(request);
    const { conversation, requestId, value } = await request.json();
    if (
      typeof conversation !== "string" ||
      typeof requestId !== "string" ||
      typeof value !== "string" ||
      value.length > 16384
    ) {
      return json({ error: "Invalid response" }, 400);
    }
    const session_id = await hermes.attach(conversation);
    try {
      const result = await hermes.call("secret.respond", {
        session_id,
        request_id: requestId,
        value,
      });
      hermes.answered(conversation, requestId);
      if (result.status === "expired") {
        return json(
          { error: "This input request expired or was already answered." },
          409,
        );
      }
      return json({ ok: true });
    } catch {
      return json(
        {
          error:
            "Hermes could not accept the input. Check the request before trying again.",
        },
        502,
      );
    }
  }
  if (path === "/api/query" && request.method === "POST") {
    await authenticated(request);
    const { method, params = {}, conversation } = await request.json();
    if (!rpcQueries.has(method)) {
      return json({ error: "Unsupported query" }, 400);
    }
    const session_id =
      conversation && !["commands.catalog", "complete.slash"].includes(method)
        ? await hermes.attach(conversation)
        : undefined;
    const result = await hermes.call(method, {
      ...params,
      ...(session_id ? { session_id } : {}),
    });
    if (method === "subagent.tail") {
      result.text = subagentTranscript(
        String(result.text ?? ""),
        params.details === true,
      );
    }
    return json(withoutReasoning(result));
  }
  if (path === "/auth/logout" && request.method === "POST") {
    const { client, device } = await userClient(request);
    await client.mutation(anyApi.devices.revoke, { id: device.id });
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }
  if (path === "/api/invite" && request.method === "POST") {
    const { client } = await userClient(request);
    const code = randomSecret();
    await client.mutation(anyApi.devices.issueInvite, { hash: hash(code) });
    return json({ code, expiresAt: Date.now() + 600000 });
  }
  if (path === "/api/workspace-backup") {
    const { client } = await userClient(request);
    return json(await client.query(anyApi.workspace.backup, {}), 200, {
      "content-disposition": 'attachment; filename="arura-workspace.json"',
    });
  }
  if (path === "/api/diagnostics") {
    const { client } = await userClient(request);
    const [status, health, web] = await Promise.all([
      hermes.rest("/api/status"),
      hermes.rest("/api/health"),
      client.query(anyApi.workspace.backup, {}),
    ]);
    return json(
      { createdAt: new Date().toISOString(), health, status, web },
      200,
      {
        "content-disposition": 'attachment; filename="arura-diagnostics.json"',
      },
    );
  }
  if (path === "/api/maintenance") {
    await authenticated(request);
    const actionsFile = process.env.ARURA_ACTIONS_FILE;
    const actions: Record<
      string,
      { label: string; command: string; args?: string[] }
    > = actionsFile ? JSON.parse(await readFile(actionsFile, "utf8")) : {};
    if (request.method === "GET") {
      return json(
        Object.entries(actions)
          .filter(([id]) => ["restart", "update"].includes(id))
          .map(([id, a]) => ({ id, label: a.label })),
      );
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    if (maintenanceRunning) {
      return json({ error: "A maintenance action is already running" }, 409);
    }
    const { id } = await request.json();
    if (!["restart", "update"].includes(id) || !actions[id]) {
      return json({ error: "This action is not configured on the host" }, 400);
    }
    const a = actions[id];
    maintenanceRunning = true;
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(a.command, a.args ?? [], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(
            new Error("The maintenance action exceeded its ten-minute limit"),
          );
        }, 600000);
        let text = "";
        const append = (chunk: Buffer) => {
          text = (text + chunk.toString()).slice(-64000);
        };
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        child.on("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timeout);
          code === 0
            ? resolve(text)
            : reject(new Error(text || `Action exited with ${code}`));
        });
      });
      return json({ output });
    } finally {
      maintenanceRunning = false;
    }
  }
  if (path === "/api/download") {
    await authenticated(request);
    const type = url.searchParams.get("type");
    if (type === "conversation") {
      const id = url.searchParams.get("id"),
        profile = url.searchParams.get("profile") ?? "default";
      if (!id) return json({ error: "Conversation ID is required" }, 400);
      return exportConversation(id, profile, (offset) =>
        hermes.rest(
          `/api/sessions/${encodeURIComponent(
            id,
          )}/messages?${new URLSearchParams({
            profile,
            offset: String(offset),
            limit: "500",
            order: "oldest",
            include_compacted: "true",
          })}`,
        ),
      );
    }
    const allowed =
      type === "backup" ? "/api/ops/backup/download" : "/api/fs/download";
    const query = new URLSearchParams(url.searchParams);
    query.delete("type");
    query.delete("id");
    const r = await hermes.request(`${allowed}?${query}`);
    const headers = new Headers({ "cache-control": "no-store" });
    for (const name of ["content-type", "content-disposition"]) {
      const value = r.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("x-content-type-options", "nosniff");
    headers.set("content-security-policy", "sandbox; default-src 'none'");
    const mime = (headers.get("content-type") ?? "").split(";")[0];
    if (
      ![
        "application/pdf",
        "text/plain",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/avif",
        "video/mp4",
        "audio/mpeg",
        "audio/ogg",
        "video/webm",
      ].includes(mime)
    ) {
      // Host-generated HTML/SVG must not execute with this application's origin.
      headers.set(
        "content-disposition",
        (headers.get("content-disposition") ?? "attachment").replace(
          /^inline\b/i,
          "attachment",
        ),
      );
    }
    return new Response(r.body, { status: r.status, headers });
  }
  if (path === "/api/upload" && request.method === "POST") {
    await authenticated(request);
    if (Number(request.headers.get("content-length") ?? 0) > 25 * 1024 * 1024) {
      return json({ error: "Files must be smaller than 25 MB" }, 413);
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Choose a file" }, 400);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 25 * 1024 * 1024) {
          await reader.cancel();
          return json({ error: "Files must be smaller than 25 MB" }, 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const data = await new Response(new Blob(chunks as BlobPart[]), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    for (const value of data.values()) {
      if (value instanceof File && value.size > 25 * 1024 * 1024) {
        return json({ error: "Files must be smaller than 25 MB" }, 413);
      }
    }
    const file = data.get("file");
    if (!(file instanceof File)) return json({ error: "Choose a file" }, 400);
    const data_url = `data:${file.type || "application/octet-stream"};base64,${Buffer.from(
      await file.arrayBuffer(),
    ).toString("base64")}`;
    if (file.type.startsWith("image/")) {
      const profile = url.searchParams.get("profile") ?? "default";
      return json(
        await hermes.rest(
          `/api/chat/image-upload?profile=${encodeURIComponent(profile)}`,
          "POST",
          { data_url, filename: file.name },
        ),
      );
    }
    const root =
      process.env.ARURA_UPLOAD_DIR ?? (await hermes.rest("/api/files")).path;
    if (typeof root !== "string") {
      return json({ error: "Configure a host upload directory" }, 503);
    }
    const name = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
    const target = `${root.replace(
      /\/$/,
      "",
    )}/arura-uploads/${crypto.randomUUID()}-${name}`;
    return json(
      await hermes.rest("/api/files/upload", "POST", {
        path: target,
        data_url,
        overwrite: false,
      }),
    );
  }
  if (path.startsWith("/api/resource/")) {
    await authenticated(request);
    const op = decodeURIComponent(path.slice("/api/resource/".length));
    const params = Object.fromEntries(url.searchParams);
    const spec = operationRequest(op, params);
    if (request.method !== spec.method) {
      return json({ error: "Method not allowed" }, 405);
    }
    if (op === "backup") {
      const id = await convex.mutation(anyApi.backups.begin, {});
      try {
        const status = await hermes.rest("/api/actions/backup/status");
        if (status.running)
          throw new Error("Hermes is already creating a backup");
        const result = await hermes.rest("/api/ops/backup", "POST", {});
        if (!result.ok || !result.archive || !Number.isInteger(result.pid))
          throw new Error(
            "Hermes did not return a backup archive and process ID",
          );
        await convex.mutation(anyApi.backups.update, {
          id,
          status: "running",
          archive: result.archive,
          pid: result.pid,
        });
        return json({ id });
      } catch (error) {
        await convex.mutation(anyApi.backups.update, {
          id,
          status: "error",
          error: errorMessage(error),
        });
        throw error;
      }
    }
    if (spec.rpc) {
      const body = request.method === "GET" ? params : await request.json();
      const conversation = url.searchParams.get("conversation");
      if (spec.needsConversation && !conversation) {
        return json(
          { error: "Choose a conversation for this connection" },
          400,
        );
      }
      const result = await hermes.call(spec.rpc, {
        ...body,
        ...spec.rpcParams,
        ...(conversation
          ? { session_id: await hermes.attach(conversation) }
          : {}),
        profile: url.searchParams.get("profile") ?? "default",
      });
      if (request.method !== "GET") {
        await convex.mutation(anyApi.workspace.ingest, { changed: true });
      }
      const visible =
        op === "profileRoster"
          ? JSON.parse(
              JSON.stringify(result, (key, value) =>
                key === "preview" ? undefined : value,
              ),
            )
          : result;
      return json(withoutReasoning(visible));
    }
    if (op === "saveFile") {
      const body = await request.json();
      if (
        typeof body.path !== "string" ||
        typeof body.content !== "string" ||
        typeof body.expectedContent !== "string"
      ) {
        return json({ error: "Read the complete file before saving" }, 400);
      }
      const previous = fileWrites.get(body.path) ?? Promise.resolve();
      const write = previous
        .catch(() => {})
        .then(async () => {
          const latest = await hermes.rest(
            `/api/fs/read-text?${new URLSearchParams({ path: body.path })}`,
          );
          if (
            latest.binary ||
            latest.truncated ||
            String(latest.content ?? latest.text ?? "").includes("\uFFFD")
          ) {
            return json(
              { error: "Only complete UTF-8 text files can be saved" },
              400,
            );
          }
          if ((latest.content ?? latest.text ?? "") !== body.expectedContent) {
            return json(
              {
                error:
                  "This file changed before saving. Your edits are preserved; review the newer version and try again.",
              },
              409,
            );
          }
          const result = await hermes.rest(spec.path, spec.method, {
            path: body.path,
            content: body.content,
          });
          await convex.mutation(anyApi.workspace.ingest, { changed: true });
          return json(result);
        });
      fileWrites.set(body.path, write);
      try {
        return await write;
      } finally {
        if (fileWrites.get(body.path) === write) fileWrites.delete(body.path);
      }
    }
    const body = spec.method === "GET" ? undefined : await request.json();
    if (
      ["editProfile", "deleteProfile"].includes(op) &&
      [...activeCommands.keys()].some((key) => JSON.parse(key)[0] === params.id)
    ) {
      return json(
        { error: "Stop active work before changing this profile" },
        409,
      );
    }
    if (op === "editProfile" && params.id !== "default") {
      await convex.mutation(anyApi.profiles.prepareRename, {
        from: params.id,
        to: String(body.new_name).trim().toLowerCase(),
      });
    }
    let result: Awaited<ReturnType<Hermes["rest"]>>;
    try {
      result = await hermes.rest(spec.path, spec.method, body);
    } catch (error) {
      if (
        op === "editProfile" &&
        error instanceof HermesHttpError &&
        error.status < 500
      ) {
        await convex.mutation(anyApi.profiles.finishRename, {
          from: params.id,
        });
      }
      throw error;
    }
    if (
      op === "editProfile" &&
      result.ok &&
      result.name &&
      result.name !== params.id
    ) {
      await migrateProfile(params.id, result.name, await hermes.list());
      await reconcile();
    }
    if (["createProfile", "deleteProfile"].includes(op)) await reconcile();
    if (spec.method !== "GET") {
      await convex.mutation(anyApi.workspace.ingest, { changed: true });
    }
    return json(result);
  }
  if (path.startsWith("/api/") || path.startsWith("/auth/")) {
    return json({ error: "Not found" }, 404);
  }
  const root = fileURLToPath(new URL("../dist/", import.meta.url)).replace(
    /\/$/,
    "",
  );
  let file = resolve(root, "." + decodeURIComponent(path));
  if (file !== root && !file.startsWith(root + sep)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
  } catch {
    file = resolve(root, "index.html");
  }
  try {
    const body = await readFile(file);
    const type: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
      ".webmanifest": "application/manifest+json",
    };
    return new Response(body, {
      headers: {
        "content-type": type[extname(file)] ?? "application/octet-stream",
        "cache-control": file.includes(sep + "assets" + sep)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
      },
    });
  } catch {
    return new Response(
      "Arura has not been built. Run deno task build or start the Vite development server.",
      { status: 503 },
    );
  }
}
const server = Deno.serve(
  {
    hostname: process.env.ARURA_BIND ?? "127.0.0.1",
    port: Number(process.env.ARURA_PORT ?? 4100),
  },
  async (request, info) => {
    try {
      return await handle(request, info.remoteAddr.hostname);
    } catch (error) {
      const message = errorMessage(error);
      return json(
        { error: message },
        /uthorization|access revoked/i.test(message) ? 401 : 400,
      );
    }
  },
);
void hermes.connect().catch(report);
Deno.addSignalListener("SIGTERM", () => {
  for (const timer of [
    authTimer,
    flushTimer,
    commandTimer,
    reconcileTimer,
    backupTimer,
    artifactTimer,
  ]) {
    clearInterval(timer);
  }
  hermes.close();
  void server.shutdown();
});
