import type { ConversationPage, Doc, Workspace } from "../shared/contracts.ts";
import { createSignal } from "solid-js";
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import { clearCache, loadCache, saveCache } from "./cache.ts";
export const [workspace, setWorkspace] = createSignal<Workspace | null>(null);
export const [authorized, setAuthorized] = createSignal(false);
export const [connected, setConnected] = createSignal(false);
export const [notice, setNotice] = createSignal("");
export const [revision, setRevision] = createSignal(0);
export const [scheduleDraft, setScheduleDraft] = createSignal<string>();
export let client: ConvexClient | undefined;
let stopConnection = () => {};
let sessionGeneration = 0;
let loadRecentPage = () => {};
export function moreConversations() {
  loadRecentPage();
}
export const refs = anyApi;
export function inform(message: string) {
  setNotice(message);
  setTimeout(
    () => setNotice((current) => (current === message ? "" : current)),
    7000,
  );
}
export async function request(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return data;
}
async function forgetSession(generation: number) {
  if (generation !== sessionGeneration) return;
  sessionGeneration++;
  setConnected(false);
  setAuthorized(false);
  setWorkspace(null);
  stopConnection();
  const previous = client;
  client = undefined;
  await Promise.all([previous?.close(), clearCache()]);
}
async function token(generation: number) {
  const response = await fetch("/auth/token", { credentials: "same-origin" });
  if (response.status === 401) {
    await forgetSession(generation);
    return null;
  }
  if (!response.ok) throw new Error("Unable to verify device access");
  return (await response.json()).token as string;
}
export async function start() {
  const generation = ++sessionGeneration;
  const cached = await loadCache<Workspace>("workspace");
  if (generation !== sessionGeneration) return;
  if (cached) {
    setWorkspace(cached);
    setAuthorized(true);
  }
  try {
    const config = await request("/api/bootstrap");
    const initial = await token(generation);
    if (!initial || generation !== sessionGeneration) return;
    stopConnection();
    await client?.close();
    if (generation !== sessionGeneration) return;
    client = new ConvexClient(config.convexUrl);
    client.setAuth(async () =>
      generation === sessionGeneration ? await token(generation) : null
    );
    stopConnection = client.subscribeToConnectionState((state) => {
      if (generation === sessionGeneration) {
        setConnected(state.isWebSocketConnected && authorized());
      }
    });
    let base: Workspace | undefined;
    let requestedPages = 0;
    const pages = new Map<number, ConversationPage>();
    const stops = new Map<number, () => void>();
    const publish = () => {
      if (generation !== sessionGeneration || !base) return;
      const ordered = [...pages.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value);
      const value = {
        ...base,
        conversations: [
          ...new Map(
            [
              ...base.conversations,
              ...ordered.flatMap((page) => page.page),
            ].map((row) => [row.key, row]),
          ).values(),
        ],
        recentHasMore: ordered.length
          ? !ordered.at(-1)?.isDone
          : base.recentHasMore,
      };
      setWorkspace(value);
      void saveCache("workspace", value);
    };
    const truncate = (after: number) => {
      for (const [index, stop] of stops) {
        if (index > after) {
          stop();
          stops.delete(index);
          pages.delete(index);
        }
      }
    };
    const follow = (index: number, cursor: string) => {
      const activeClient = client;
      if (!activeClient) return;
      let previousCursor: string | undefined;
      stops.set(
        index,
        activeClient.onUpdate(
          anyApi.workspace.recent,
          { cursor },
          (result) => {
            if (generation !== sessionGeneration) return;
            pages.set(index, result);
            if (result.isDone || previousCursor !== result.continueCursor) {
              truncate(index);
              previousCursor = result.continueCursor;
              if (!result.isDone && index + 1 < requestedPages) {
                follow(index + 1, result.continueCursor);
              }
            }
            publish();
          },
          (error) => inform(error.message),
        ),
      );
    };
    loadRecentPage = () => {
      if (generation !== sessionGeneration || !connected() || !base) return;
      const previous = pages.get(requestedPages - 1);
      const cursor = requestedPages
        ? previous?.continueCursor
        : base.recentCursor;
      if (
        !cursor ||
        (requestedPages ? previous?.isDone : !base.recentHasMore)
      ) {
        return;
      }
      follow(requestedPages++, cursor);
    };
    client.onUpdate(
      anyApi.workspace.overview,
      {},
      (value) => {
        if (generation !== sessionGeneration) return;
        if (
          !base ||
          base.recentCursor !== value.recentCursor ||
          !value.recentHasMore
        ) {
          truncate(-1);
          if (requestedPages && value.recentHasMore) {
            follow(0, value.recentCursor);
          }
        }
        base = value;
        publish();
        setAuthorized(true);
        setConnected(true);
        setRevision(value.connection?.revision ?? 0);
      },
      async (error) => {
        if (generation !== sessionGeneration) return;
        setConnected(false);
        if (/revoked|uthoriz/i.test(error.message)) {
          await forgetSession(generation);
        } else inform(error.message);
      },
    );
  } catch (error) {
    if (generation !== sessionGeneration) return;
    setConnected(false);
    if (!cached) {
      inform(error instanceof Error ? error.message : "Cannot reach the host");
    }
  }
}
export async function login(username: string, password: string) {
  await request("/auth/login", { username, password });
  await clearCache();
  await start();
}
export async function logout() {
  await request("/auth/logout", {});
  await forgetSession(sessionGeneration);
}
export async function mutate(name: string, args: Record<string, unknown>) {
  if (!client || !connected()) {
    throw new Error("Connect to your host to make changes");
  }
  const [module, method] = name.split(".");
  return await client.mutation(anyApi[module][method], args);
}
export function saveDraft(profile: string, key: string, text: string) {
  if (!connected()) return;
  void mutate("workspace.saveDraft", { profile, key, text }).catch(() => {});
}
export function subscribe<T>(
  module: string,
  name: string,
  args: Record<string, unknown>,
  callback: (value: T) => void,
) {
  if (!client) return () => {};
  return client.onUpdate(
    anyApi[module][name],
    args,
    callback,
    (error) => inform(error.message),
  );
}
export async function enqueueCommand(
  kind: string,
  conversation: string,
  payload: unknown,
  id: string = crypto.randomUUID(),
) {
  await mutate("commands.enqueue", { id, kind, conversation, payload });
  return id;
}
export function watchRuntime<T>(
  conversation: string,
  method: string,
  params: Record<string, unknown>,
  callback: (value: T) => void,
) {
  const key = JSON.stringify([conversation, method, params]);
  const watchToken = crypto.randomUUID();
  const release = () =>
    request("/api/query", {
      conversation,
      method,
      params,
      watchToken,
      unwatch: true,
    }).catch(() => {});
  let disposed = false,
    received = false;
  const stop = subscribe<T | null>(
    "workspace",
    "runtimeView",
    { key },
    (value) => {
      if (value !== null && !disposed) {
        received = true;
        callback(value);
      }
    },
  );
  void request("/api/query", {
    conversation,
    method,
    params,
    watch: true,
    watchToken,
  })
    .then((value) => {
      if (disposed) void release();
      if (!disposed && !received) callback(value as T);
    })
    .catch((error) => {
      if (!disposed) inform(error.message);
    });
  return () => {
    disposed = true;
    stop();
    void release();
  };
}
export async function command<T = Record<string, unknown>>(
  kind: string,
  conversation: string,
  payload: unknown,
): Promise<T> {
  if (!client || !connected()) {
    throw new Error("Connect to your host to send this request");
  }
  const id = crypto.randomUUID();
  await mutate("commands.enqueue", { id, kind, conversation, payload });
  return new Promise((resolve, reject) => {
    let stop = () => {};
    const timer = setTimeout(() => {
      stop();
      reject(
        new Error(
          "Still waiting for Hermes. Check the conversation before trying again.",
        ),
      );
    }, 90000);
    stop = subscribe<Doc<"commands"> | null>(
      "commands",
      "result",
      { id },
      (result) => {
        if (!result || ["queued", "dispatching"].includes(result.status)) {
          return;
        }
        clearTimeout(timer);
        stop();
        if (["error", "unknown", "cancelled"].includes(result.status)) {
          reject(new Error(result.error ?? result.status));
        } else resolve(result.result);
      },
    );
  });
}
export async function resource(
  operation: string,
  params: Record<string, unknown> = {},
  body?: unknown,
  method?: string,
) {
  const { operations } = await import("../shared/resources.ts");
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) query.set(k, String(v));
  }
  return request(
    `/api/resource/${operation}?${query}`,
    body,
    method ?? operations[operation]?.method ?? "GET",
  );
}
