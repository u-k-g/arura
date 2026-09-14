type Row = { id: number; role: string; content: string; name?: string };
export function hermesFixture(
  port = 0,
  hooks: {
    beforeReplay?: () => void;
    truncatedReplay?: boolean;
    resume?: (sid: string) => Record<string, unknown>;
    requirePassword?: boolean;
  } = {},
) {
  const sockets = new Set<WebSocket>();
  const subscriptions = new Map<WebSocket, Set<string>>();
  let epoch = "fixture-epoch";
  const files = new Map([
    ["/fixture/notes.md", "# Notes\n\nOriginal host content.\n"],
    ["/fixture/large.txt", "A partial preview"],
  ]);
  const jobs: { id: string; name: string; prompt: string; schedule: string }[] =
    [];
  const sessions = new Map<
    string,
    {
      id: string;
      title: string;
      started_at: number;
      last_active: number;
      messages: Row[];
      hidden?: boolean;
    }
  >();
  let avatarData = "";
  let botRevision = 0;
  let botMetadata: Record<string, unknown> = {};
  let mcpStatus = "starting";
  const mcpState = crypto.randomUUID();
  const mcpFlowId = crypto.randomUUID();
  let memoryContent = "Prefers perennial flowers.";
  let memoryWrites = 0;
  let providerConnected = false;
  const providerFlow = crypto.randomUUID();
  let modelConfig: Record<string, unknown> = {
    fallback_providers: [
      { provider: "old", model: "old-model", key_env: "SAVED_KEY" },
    ],
    fallback_model: "legacy-model",
    moa: {
      default_preset: "default",
      active_preset: "",
      privacy_filter: "",
      presets: {
        default: {
          enabled: true,
          reference_models: [
            { provider: "fixture", model: "reference", enabled: true },
          ],
          aggregator: { provider: "fixture", model: "aggregator" },
          reference_temperature: null,
          aggregator_temperature: null,
          reference_timeout: null,
          degraded_reference_policy: "loud",
          fanout: "user_turn",
        },
      },
    },
  };
  let auxiliary = {
    task: "title",
    provider: "fixture",
    model: "small",
    base_url: "",
  };
  const sequences = new Map<string, number>();
  const replay = new Map<string, unknown[]>();
  let rowId = 1;
  const create = (id: string = crypto.randomUUID()) => {
    const s = {
      id,
      title: id === "fixture-chat"
        ? "Fixture conversation"
        : `Test conversation ${id.slice(0, 8)}`,
      started_at: Date.now() / 1000,
      last_active: Date.now() / 1000,
      messages: [] as Row[],
      hidden: false,
    };
    sessions.set(id, s);
    return s;
  };
  create("fixture-chat");
  function event(type: string, sid: string, payload: unknown) {
    const seq = (sequences.get(sid) ?? 0) + 1;
    sequences.set(sid, seq);
    const frame = {
      jsonrpc: "2.0",
      method: "event",
      params: { type, session_id: sid, seq, payload },
    };
    const history = replay.get(sid) ?? [];
    history.push(frame);
    replay.set(sid, history);
    for (const ws of sockets) {
      if (
        ws.readyState === WebSocket.OPEN &&
        (!sid || subscriptions.get(ws)?.has(sid))
      ) {
        ws.send(JSON.stringify(frame));
      }
    }
    return frame;
  }
  const inputs = new Map<
    string,
    {
      sid: string;
      kind: string;
      resolve: () => void;
      qids?: string[];
      answers: Record<string, string>;
    }
  >();
  async function interaction(
    sid: string,
    kind: string,
    payload: Record<string, unknown>,
  ) {
    const request_id = crypto.randomUUID();
    await new Promise<void>((resolve) => {
      inputs.set(request_id, {
        sid,
        kind,
        resolve,
        answers: {},
        ...(Array.isArray(payload.questions)
          ? { qids: payload.questions.map((q: any) => q.qid) }
          : {}),
      });
      event(`${kind}.request`, sid, { request_id, ...payload });
    });
  }
  async function answer(sid: string, text: string) {
    const s = sessions.get(sid)!;
    s.messages.push({ id: rowId++, role: "user", content: text });
    event("message.start", sid, {});
    if (text === "ARURA_TEST_INTERACTIONS") {
      await interaction(sid, "approval", {
        description: "Allow reading the fixture notes?",
      });
      await interaction(sid, "clarify", {
        question: "Which garden color?",
        choices: ["Blue", "Green"],
      });
      await interaction(sid, "clarify", {
        questions: [
          {
            qid: "flowers",
            question: "Which flowers?",
            choices: ["Iris", "Rose", "Lily"],
            multi_select: true,
          },
          {
            qid: "location",
            question: "Where should they grow?",
            choices: [],
            multi_select: false,
          },
        ],
      });
      await interaction(sid, "secret", {
        prompt: "Enter the fixture verification code",
      });
    }
    event("reasoning.delta", sid, {
      text: "PRIVATE REASONING MUST NOT APPEAR",
    });
    event("tool.start", sid, {
      tool_call_id: "fixture-tool",
      name: "Read notes",
    });
    const reply = `Received: ${text}\n\n[Notes](/fixture/notes.md)`;
    for (const piece of reply.match(/[\s\S]{1,8}/g) ?? []) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      event("message.delta", sid, { text: piece });
    }
    s.messages.push({ id: rowId++, role: "assistant", content: reply });
    s.last_active = Date.now() / 1000;
    event("tool.complete", sid, { tool_call_id: "fixture-tool" });
    event("message.complete", sid, {
      text: reply,
      reasoning: "PRIVATE REASONING MUST NOT APPEAR",
    });
    event("sessions.changed", "", {});
  }
  const server = Deno.serve(
    { hostname: "127.0.0.1", port, onListen: () => {} },
    async (request) => {
      const url = new URL(request.url),
        path = url.pathname;
      const json = (data: unknown) => Response.json(data);
      if (path === "/api/auth/providers") {
        return json({
          providers: [{ name: "local", supports_password: true }],
        });
      }
      if (path === "/auth/password-login") {
        const body = await request.json();
        if (body.provider !== "local") {
          return new Response("provider is required", { status: 422 });
        }
        if (body.username !== "fixture" || body.password !== "fixture-only") {
          return new Response("Unauthorized", { status: 401 });
        }
        return Response.json(
          { ok: true },
          {
            headers: {
              "set-cookie":
                "hermes_fixture_session=authorized; HttpOnly; Path=/",
            },
          },
        );
      }
      if (
        hooks.requirePassword &&
        !request.headers
          .get("cookie")
          ?.includes("hermes_fixture_session=authorized")
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (path === "/api/auth/ws-ticket") {
        return json({ ticket: "fixture-ticket" });
      }
      if (
        path === "/api/ws" &&
        hooks.requirePassword &&
        url.searchParams.get("ticket") !== "fixture-ticket"
      ) {
        return new Response("Ticket required", { status: 401 });
      }
      if (path === "/api/ws") {
        const { socket, response } = Deno.upgradeWebSocket(request);
        sockets.add(socket);
        subscriptions.set(socket, new Set());
        socket.onopen = () =>
          socket.send(
            JSON.stringify({
              method: "event",
              params: {
                type: "gateway.ready",
                payload: { replay_epoch: epoch },
              },
            }),
          );
        socket.onclose = () => {
          sockets.delete(socket);
          subscriptions.delete(socket);
        };
        socket.onmessage = (message) => {
          const { id, method, params = {} } = JSON.parse(message.data);
          let result: unknown = { ok: true };
          if (method === "session.create") {
            const s = create();
            s.hidden = Boolean(params.hidden);
            subscriptions.get(socket)!.add(s.id);
            result = { session_id: s.id, stored_session_id: s.id };
          } else if (method === "session.list") {
            result = {
              sessions: [...sessions.values()]
                .filter(
                  (session) => !params.title || session.title === params.title,
                )
                .map((session) => ({ ...session, resolved_id: session.id })),
            };
          } else if (method === "session.title") {
            const session = sessions.get(params.session_id);
            if (session) session.title = params.title;
            event("sessions.changed", "", {});
          } else if (method === "profiles.list") {
            const canonical = [...sessions.values()].find(
              (session) => session.title === "Bot Chat",
            );
            result = {
              profiles: [
                {
                  name: "default",
                  display_name: "",
                  ui_meta: { "hermes-bots": botMetadata },
                  ui_meta_revisions: { "hermes-bots": botRevision },
                  has_avatar: Boolean(avatarData),
                  canonical_session: canonical
                    ? { ...canonical, resolved_id: canonical.id }
                    : null,
                },
              ],
            };
          } else if (method === "profiles.configure") {
            if (
              params.ui_meta_expected_revisions?.["hermes-bots"] !== botRevision
            ) {
              result = { ok: false, applied: { ui_meta: false } };
            } else {
              botMetadata = params.ui_meta["hermes-bots"];
              botRevision++;
              result = {
                ok: true,
                applied: {
                  ui_meta: true,
                  ui_meta_revisions: { "hermes-bots": botRevision },
                },
              };
              event("profiles.changed", "", {});
            }
          } else if (method === "profiles.get_asset") {
            result = avatarData
              ? { found: true, data: avatarData, mime: "image/png" }
              : { found: false };
          } else if (method === "profiles.set_asset") {
            avatarData = params.clear ? "" : params.data;
            result = { ok: true };
          } else if (method === "session.resume") {
            subscriptions.get(socket)!.add(params.session_id);
            result = {
              session_id: params.session_id,
              session_key: params.session_id,
              running: false,
              ...hooks.resume?.(params.session_id),
            };
          } else if (method === "prompt.submit") {
            if (params.truncate_before_row_id !== undefined) {
              const session = sessions.get(params.session_id)!;
              const index = session.messages.findIndex(
                (row) =>
                  String(row.id) === String(params.truncate_before_row_id),
              );
              if (
                index < 0 ||
                !params.confirm_truncate ||
                !params.confirm_empty_truncate
              ) {
                socket.send(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    id,
                    error: {
                      code: 4000,
                      message: "Invalid truncation request",
                    },
                  }),
                );
                return;
              }
              session.messages.splice(index);
            }
            result = { status: "streaming" };
            void answer(params.session_id, params.text);
          } else if (
            ["approval.respond", "clarify.respond", "secret.respond"].includes(
              method,
            )
          ) {
            const input = inputs.get(params.request_id);
            if (
              input &&
              input.sid === params.session_id &&
              method === `${input.kind}.respond`
            ) {
              if (input.qids && params.question_id) {
                if (!input.qids.includes(params.question_id)) {
                  throw new Error("Invalid fixture question ID");
                }
                input.answers[params.question_id] = params.answer;
                const remaining = input.qids.filter(
                  (qid) => input.answers[qid] === undefined,
                );
                if (!remaining.length) {
                  inputs.delete(params.request_id);
                  input.resolve();
                }
                result = { status: "ok", remaining };
              } else {
                inputs.delete(params.request_id);
                input.resolve();
                result = { status: "ok", resolved: true };
              }
            } else result = { status: "expired", resolved: false };
          } else if (method === "session.events.since") {
            hooks.beforeReplay?.();
            result = {
              events: (replay.get(params.session_id) ?? []).filter(
                (e: any) => e.params.seq > params.last_seen,
              ),
              latest_seq: sequences.get(params.session_id) ?? 0,
              truncated: hooks.truncatedReplay ?? false,
              epoch,
            };
          } else if (method === "session.branch") {
            const source = sessions.get(params.session_id)!;
            const branch = create();
            branch.messages = source.messages.slice(0, params.count);
            result = { session_id: branch.id, stored_session_id: branch.id };
          } else if (method === "model.options") {
            result = {
              providers: [
                {
                  slug: "fixture",
                  name: "Fixture provider",
                  models: ["fixture-model", "fixture-alternative"],
                },
              ],
            };
          } else if (method === "config.set") {
            if (
              params.scope !== "session" ||
              !["model", "reasoning"].includes(params.key)
            ) {
              socket.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  error: {
                    code: 4000,
                    message: "Expected a session-scoped setting",
                  },
                }),
              );
              return;
            }
            result = { ok: true };
          } else if (method === "session.control.read") {
            result = { control: {} };
          } else if (method === "session.context_breakdown") {
            result = {
              context_used: 2000,
              context_max: 100000,
              context_percent: 2,
              model: "fixture-model",
              categories: [],
            };
          } else if (method === "subagent.list") {
            result = { subagents: [] };
          } else if (method === "complete.slash") {
            result = {
              items: [
                {
                  text: "/research",
                  display: "/research",
                  meta: "Research a topic",
                  kind: "skill",
                },
              ].filter((item) => item.text.startsWith(params.text)),
            };
          }
          socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
        };
        return response;
      }
      if (path === "/api/profiles/sessions") {
        return json({
          sessions: [...sessions.values()]
            .filter((session) => !session.hidden)
            .slice(0, 1),
          profile_totals: { default: sessions.size },
          errors: [],
        });
      }
      if (path === "/api/sessions") {
        return json({
          sessions: [...sessions.values()].slice(
            Number(url.searchParams.get("offset") ?? 0),
            Number(url.searchParams.get("offset") ?? 0) + 100,
          ),
          total: sessions.size,
        });
      }
      if (path === "/api/sessions/search") {
        const query = url.searchParams.get("q")?.toLowerCase() ?? "";
        return json({
          results: [...sessions.values()]
            .filter((session) =>
              session.messages.some((message: any) =>
                String(message.content ?? "")
                  .toLowerCase()
                  .includes(query)
              )
            )
            .map((session) => ({
              session_id: session.id,
              title: session.title,
              snippet: "PRIVATE_REASONING_SEARCH_SNIPPET",
            })),
        });
      }
      const match = path.match(/^\/api\/sessions\/([^/]+)(\/messages)?$/);
      if (match) {
        const s = sessions.get(decodeURIComponent(match[1]));
        if (!s) return new Response("Not found", { status: 404 });
        if (match[2]) {
          return json({
            messages: s.messages,
            session_id: s.id,
            pagination: { has_more: false },
          });
        }
        if (request.method === "PATCH") {
          Object.assign(s, await request.json());
          event("sessions.changed", "", {});
          return json({ ok: true });
        }
        if (request.method === "DELETE") {
          sessions.delete(s.id);
          event("sessions.changed", "", {});
          return json({ ok: true });
        }
      }
      if (path === "/api/status" || path === "/api/health") {
        return json({ status: "healthy" });
      }
      if (path === "/api/fs/list") {
        return json({
          path: "/fixture",
          entries: [...files.keys()].map((path) => ({
            path,
            name: path.split("/").at(-1),
            is_dir: false,
          })),
        });
      }
      if (path === "/api/fs/read-text") {
        return json({
          truncated: url.searchParams.get("path") === "/fixture/large.txt",
          content: files.get(url.searchParams.get("path") ?? "") ?? "",
        });
      }
      if (path === "/api/fs/write-text" && request.method === "POST") {
        const { path, content } = await request.json();
        files.set(path, content);
        return json({ ok: true });
      }
      if (path === "/api/fs/download") {
        return new Response(
          files.get(url.searchParams.get("path") ?? "") ?? "",
          { headers: { "content-type": "text/plain" } },
        );
      }
      if (path === "/api/cron/jobs") return json({ jobs });
      if (path === "/api/cron/blueprints") {
        return json({
          blueprints: [
            {
              key: "daily-note",
              title: "Daily note",
              description: "A daily note about a topic",
              scheduleHuman: "Every morning",
              fields: [
                {
                  name: "topic",
                  type: "text",
                  label: "Topic",
                  default: "",
                  options: [],
                  optional: false,
                  strict: false,
                  help: "What should Hermes cover?",
                },
                {
                  name: "time",
                  type: "time",
                  label: "Time",
                  default: "08:00",
                  options: [],
                  optional: false,
                  strict: false,
                  help: "",
                },
              ],
            },
          ],
        });
      }
      if (path === "/api/cron/blueprints/instantiate") {
        const body = await request.json();
        if (
          body.blueprint !== "daily-note" ||
          !body.values?.topic ||
          !body.values?.time
        ) {
          return new Response("Invalid blueprint fields", { status: 400 });
        }
        const job = {
          id: crypto.randomUUID(),
          name: "Daily note",
          prompt: body.values.topic,
          schedule: body.values.time,
        };
        jobs.push(job);
        return json(job);
      }
      if (path === "/api/profiles") {
        return json({
          profiles: [{ name: "default", description: "Fixture profile" }],
        });
      }
      if (path === "/api/mcp/servers") {
        return json({
          servers: {
            fixture: { name: "fixture", enabled: true, auth: "oauth" },
          },
        });
      }
      if (path === "/api/mcp/servers/fixture/auth") {
        mcpStatus = "authorization_required";
        return json({
          flow_id: mcpFlowId,
          server_name: "fixture",
          status: mcpStatus,
          authorization_url: `https://example.com/authorize?state=${mcpState}`,
        });
      }
      if (path === `/api/mcp/oauth/flows/${mcpFlowId}`) {
        if (request.method === "DELETE") mcpStatus = "error";
        return json({
          flow_id: mcpFlowId,
          server_name: "fixture",
          status: mcpStatus,
          authorization_url: `https://example.com/authorize?state=${mcpState}`,
        });
      }
      if (path === "/api/mcp/oauth/callback/fixture") {
        if (
          url.searchParams.get("state") !== mcpState ||
          mcpStatus !== "authorization_required"
        ) {
          return new Response("Invalid state", { status: 404 });
        }
        mcpStatus = "approved";
        return new Response("Authorization received", {
          headers: { "content-type": "text/html" },
        });
      }
      if (path === "/api/learning/graph") {
        return json({
          nodes: [
            {
              id: "memory:0",
              label: "Garden preference",
              kind: "memory",
              timestamp: 1700000000,
              category: "personal",
              useCount: 1,
            },
          ],
          edges: [],
          writes: memoryWrites,
        });
      }
      if (path === "/api/learning/node") {
        if (request.method === "PUT") {
          memoryContent = (await request.json()).content;
          memoryWrites++;
        }
        return json({
          ok: true,
          id: "memory:0",
          label: "Garden preference",
          kind: "memory",
          content: memoryContent,
        });
      }
      if (path === "/api/model/info") {
        return json({ provider: "fixture", model: "fixture-model" });
      }
      if (path === "/api/model/moa") {
        if (request.method === "PUT") {
          modelConfig.moa = { ...(await request.json()), privacy_filter: "" };
        }
        return json(modelConfig.moa);
      }
      if (path === "/api/config") {
        if (request.method === "PUT") {
          const body = await request.json();
          if (!body.config) {
            return new Response("Missing config", { status: 400 });
          }
          modelConfig = { ...modelConfig, ...body.config };
        }
        return json({ config: modelConfig });
      }
      if (path === "/api/model/auxiliary") {
        return json({
          tasks: [auxiliary],
          main: { provider: "fixture", model: "fixture-model" },
        });
      }
      if (path === "/api/model/set") {
        const body = await request.json();
        if (body.scope !== "auxiliary" || body.task !== "title") {
          return new Response("Incorrect auxiliary scope", { status: 400 });
        }
        if (!body.confirm_expensive_model) {
          return json({
            ok: false,
            confirm_required: true,
            confirm_message: "Confirm this helper model cost?",
          });
        }
        auxiliary = {
          task: body.task,
          provider: body.provider,
          model: body.model,
          base_url: body.base_url ?? "",
        };
        return json({ ok: true });
      }
      if (path === "/api/providers/oauth") {
        return json({
          providers: [
            {
              id: "fixture",
              name: "Fixture provider",
              flow: "device_code",
              disconnectable: true,
              status: { logged_in: providerConnected },
            },
          ],
        });
      }
      if (path === "/api/providers/oauth/fixture/start") {
        return json({
          session_id: providerFlow,
          flow: "device_code",
          user_code: "TEST-CODE",
          verification_url: "https://example.com/authorize",
          poll_interval: 1,
        });
      }
      if (path === `/api/providers/oauth/fixture/poll/${providerFlow}`) {
        providerConnected = true;
        return json({ session_id: providerFlow, status: "success" });
      }
      if (path === `/api/providers/oauth/sessions/${providerFlow}`) {
        return json({ ok: true });
      }
      if (
        path === "/api/providers/oauth/fixture" &&
        request.method === "DELETE"
      ) {
        providerConnected = false;
        return json({ ok: true });
      }
      if (path === "/api/models") {
        return json({
          models: [{ id: "fixture-model", name: "Fixture model" }],
        });
      }
      return new Response("Fixture route not implemented", { status: 404 });
    },
  );
  return {
    server,
    event,
    sessions,
    sockets,
    restart() {
      epoch = crypto.randomUUID();
      replay.clear();
      sequences.clear();
      for (const socket of sockets) socket.close();
    },
    async close() {
      for (const ws of sockets) ws.close();
      await server.shutdown();
    },
  };
}
if (Deno.mainModule === import.meta.url) {
  const fixture = hermesFixture(
    Number(Deno.env.get("HERMES_FIXTURE_PORT") ?? 39119),
  );
  console.log(`Hermes fixture listening on ${fixture.server.addr.port}`);
}
