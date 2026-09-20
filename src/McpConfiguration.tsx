import FileEditor from "./FileEditor.tsx";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { record } from "../shared/contracts.ts";
import { inform, resource } from "./client.ts";
import { run } from "./ui.tsx";

// Hermes replaces this entire map; config PUT deep-merges and cannot remove keys.
export default function McpConfiguration(props: {
  profile: string;
  changed: () => Promise<void>;
}) {
  const [draft, setDraft] = createSignal("");
  const [baseline, setBaseline] = createSignal("");
  const [ready, setReady] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [saveError, setSaveError] = createSignal("");
  const serialize = (value: unknown): string => JSON.stringify(value, null, 2);
  createEffect(() => {
    const profile = props.profile;
    let disposed = false;
    setReady(false);
    setError("");
    setSaveError("");
    void resource("config", { profile })
      .then((result) => {
        if (disposed) return;
        const text = serialize(
          record(result.config ?? result).mcp_servers ?? {},
        );
        setDraft(text);
        setBaseline(text);
        setReady(true);
      })
      .catch((error) => {
        if (!disposed) setError(error.message);
      });
    onCleanup(() => {
      disposed = true;
    });
  });
  async function save() {
    if (saving()) return;
    const profile = props.profile,
      text = draft(),
      original = baseline();
    setSaveError("");
    setSaving(true);
    try {
      const servers: unknown = JSON.parse(text);
      if (
        !servers ||
        typeof servers !== "object" ||
        Array.isArray(servers) ||
        Object.values(servers).some(
          (server) =>
            !server || typeof server !== "object" || Array.isArray(server),
        )
      ) {
        throw new Error(
          "Enter an object mapping server names to their configuration.",
        );
      }
      const current = await resource("config", { profile });
      if (
        serialize(record(current.config ?? current).mcp_servers ?? {}) !==
        original
      ) {
        throw new Error(
          "MCP configuration changed elsewhere. Reopen the editor before saving; your draft has been kept.",
        );
      }
      const result = await resource("saveMcp", { profile }, { servers });
      if (result.ok === false) {
        throw new Error(result.error ?? "Could not save MCP configuration");
      }
      if (props.profile === profile) setBaseline(serialize(servers));
      // The desktop reloads only after the configuration has been persisted.
      try {
        await resource("reloadMcp", { profile }, {});
      } catch (error) {
        throw new Error(
          `Configuration saved, but live tools could not reload: ${
            (error as Error).message
          }`,
        );
      }
      inform("MCP configuration saved and reloaded");
      await props.changed();
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="mcp-configuration">
      <h3>mcp.json</h3>
      <Show when={saveError()}>
        <p role="alert" class="error">
          {saveError()}
        </p>
      </Show>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <Show when={!ready() && !error()}>
        <p role="status">Loading configuration…</p>
      </Show>
      <Show when={ready()}>
        <div class="inline-file-editor">
          <FileEditor
            path="mcp.json"
            label="MCP configuration"
            content={draft()}
            change={setDraft}
            select={() => {}}
          />
        </div>
        <button
          type="button"
          disabled={saving() || draft() === baseline()}
          onClick={() => void run(save)}
        >
          {saving() ? "Saving…" : "Save MCP configuration"}
        </button>
      </Show>
    </section>
  );
}
