import { createSignal } from "solid-js";
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import { clearCache, loadCache, saveCache } from "./cache";
export const [workspace, setWorkspace] = createSignal<any>(null);
export const [authorized, setAuthorized] = createSignal(false);
export const [connected, setConnected] = createSignal(false);
export const [notice, setNotice] = createSignal("");
export const [revision, setRevision] = createSignal(0);
export let client: ConvexClient | undefined;
let stopConnection = () => {};
let sessionGeneration = 0;
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
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? `Request failed (${response.status})`);
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
  const cached = await loadCache<any>("workspace");
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
      generation === sessionGeneration ? token(generation) : null,
    );
    stopConnection = client.subscribeToConnectionState((state) => {
      if (generation === sessionGeneration)
        setConnected(state.isWebSocketConnected && authorized());
    });
    client.onUpdate(
      anyApi.workspace.overview,
      {},
      (value) => {
        if (generation !== sessionGeneration) return;
        setWorkspace(value);
        setAuthorized(true);
        setConnected(true);
        setRevision(value.connection?.revision ?? 0);
        void saveCache("workspace", value);
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
    if (!cached)
      inform(error instanceof Error ? error.message : "Cannot reach the host");
  }
}
export async function login(name: string, code: string) {
  await request("/auth/login", { name, code });
  await clearCache();
  await start();
}
export async function logout() {
  await request("/auth/logout", {});
  await forgetSession(sessionGeneration);
}
export async function mutate(name: string, args: Record<string, unknown>) {
  if (!client || !connected())
    throw new Error("Connect to your host to make changes");
  const [module, method] = name.split(".");
  return client.mutation(anyApi[module][method], args);
}
export function subscribe(
  module: string,
  name: string,
  args: Record<string, unknown>,
  callback: (value: any) => void,
) {
  if (!client) return () => {};
  return client.onUpdate(anyApi[module][name], args, callback, (error) =>
    inform(error.message),
  );
}
export async function command(
  kind: string,
  conversation: string,
  payload: unknown,
): Promise<any> {
  if (!client || !connected())
    throw new Error("Connect to your host to send this request");
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
    stop = subscribe("commands", "result", { id }, (result) => {
      if (!result || ["queued", "dispatching"].includes(result.status)) return;
      clearTimeout(timer);
      stop();
      if (["error", "unknown", "cancelled"].includes(result.status))
        reject(new Error(result.error ?? result.status));
      else resolve(result.result);
    });
  });
}
export async function resource(
  operation: string,
  params: Record<string, unknown> = {},
  body?: unknown,
  method?: string,
) {
  const { operations } = await import("../shared/resources");
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) query.set(k, String(v));
  return request(
    `/api/resource/${operation}?${query}`,
    body,
    method ?? operations[operation]?.method ?? "GET",
  );
}
