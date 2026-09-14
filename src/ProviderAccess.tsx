import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { inform, resource, revision } from "./client.ts";
import { Dialog, run } from "./ui.tsx";

type Provider = {
  id: string;
  name: string;
  flow: string;
  docs_url?: string;
  disconnectable: boolean;
  disconnect_hint?: string;
  status: { logged_in: boolean };
};
type Flow = {
  provider: string;
  session_id: string;
  user_code: string;
  verification_url: string;
  poll_interval: number;
  status?: string;
  error_message?: string;
};
const webUrl = (value?: string) =>
  value && /^https?:\/\//i.test(value) ? value : undefined;

export default function ProviderAccess() {
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [flow, setFlow] = createSignal<Flow>();
  const [error, setError] = createSignal("");
  async function refresh() {
    const value = await resource("providers");
    setProviders(
      (value.providers ?? []).filter(
        (provider: Provider) => !/^(nous|hermes[-_]cloud)$/.test(provider.id),
      ),
    );
  }
  createEffect(() => {
    revision();
    void refresh().catch((error) => setError(error.message));
  });
  createEffect(() => {
    const current = flow();
    if (!current || (current.status && current.status !== "pending")) return;
    let disposed = false,
      polling = false;
    const timer = setInterval(
      async () => {
        if (polling) return;
        polling = true;
        try {
          const value = await resource("providerPoll", {
            id: current.provider,
            session: current.session_id,
          });
          if (!disposed && value.status !== "pending") {
            setFlow({ ...current, ...value });
            await refresh();
          }
        } catch (error) {
          if (!disposed) setError((error as Error).message);
        } finally {
          polling = false;
        }
      },
      Math.max(1, current.poll_interval || 5) * 1000,
    );
    onCleanup(() => {
      disposed = true;
      clearInterval(timer);
    });
  });
  async function close() {
    const current = flow();
    if (current && (!current.status || current.status === "pending")) {
      await resource("providerCancel", { session: current.session_id }, {});
    }
    setFlow(undefined);
  }
  return (
    <div class="resource-list">
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <For each={providers()}>
        {(provider) => (
          <article class="resource-card">
            <h3>{provider.name}</h3>
            <p>{provider.status.logged_in ? "Connected" : "Not connected"}</p>
            <Show
              when={provider.flow === "device_code"}
              fallback={
                <p>
                  Configure this provider on the Hermes host, then refresh this
                  page.
                </p>
              }
            >
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    const value = await resource(
                      "providerStart",
                      { id: provider.id },
                      {},
                    );
                    if (value.flow !== "device_code") {
                      throw new Error(
                        "This provider requires setup on the Hermes host.",
                      );
                    }
                    setFlow({ ...value, provider: provider.id });
                  })
                }
              >
                {provider.status.logged_in ? "Sign in again" : "Sign in"}
              </button>
            </Show>
            <Show when={webUrl(provider.docs_url)}>
              <a
                href={webUrl(provider.docs_url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Provider instructions
              </a>
            </Show>
            <Show when={provider.status.logged_in && provider.disconnectable}>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    if (!confirm(`Disconnect ${provider.name}?`)) return;
                    await resource(
                      "providerDisconnect",
                      { id: provider.id },
                      {},
                    );
                    await refresh();
                    inform("Provider disconnected");
                  })
                }
              >
                Disconnect
              </button>
            </Show>
          </article>
        )}
      </For>
      <Show when={flow()}>
        {(current) => (
          <Dialog title="Authorize provider" close={() => void run(close)}>
            <Show
              when={!current().status || current().status === "pending"}
              fallback={
                <p role="status">
                  {current().error_message ?? current().status}
                </p>
              }
            >
              <p>Open the provider's page and enter this code:</p>
              <p>
                <strong>{current().user_code}</strong>
              </p>
              <a
                href={webUrl(current().verification_url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open authorization page
              </a>
              <p role="status">Waiting for authorization…</p>
            </Show>
            <button type="button" onClick={() => void run(close)}>
              Close
            </button>
          </Dialog>
        )}
      </Show>
    </div>
  );
}
