import FileEditor from "./FileEditor.tsx";
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import { inform, resource, revision } from "./client.ts";
import { run } from "./ui.tsx";

export default function ProfileInstructions(props: { name: string }) {
  const [text, setText] = createSignal("");
  const [original, setOriginal] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [saveError, setSaveError] = createSignal("");
  let previousName = "";
  createEffect(() => {
    const name = props.name;
    revision();
    const changedProfile = name !== previousName;
    previousName = name;
    if (!changedProfile && untrack(() => text() !== original())) return;
    let disposed = false;
    if (changedProfile) setLoading(true);
    setError("");
    setSaveError("");
    void resource("soul", { id: name })
      .then((value) => {
        if (
          disposed ||
          (!changedProfile && untrack(() => text() !== original()))
        ) {
          return;
        }
        const content = String(value.content ?? value.soul ?? "");
        setText(content);
        setOriginal(content);
      })
      .catch((error) => {
        if (!disposed) setError(error.message);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    onCleanup(() => {
      disposed = true;
    });
  });
  async function save() {
    if (saving()) return;
    const name = props.name,
      content = text(),
      baseline = original();
    setSaveError("");
    setSaving(true);
    try {
      const latest = await resource("soul", { id: name });
      if (String(latest.content ?? latest.soul ?? "") !== baseline) {
        throw new Error(
          "Instructions changed elsewhere. Reopen this profile before saving; your draft has been kept.",
        );
      }
      const result = await resource("saveSoul", { id: name }, { content });
      if (result.ok === false) {
        throw new Error(result.error ?? "Could not save instructions");
      }
      if (name === props.name) setOriginal(content);
      inform("Instructions saved");
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="profile-instructions">
      <h4>SOUL.md</h4>
      <Show when={loading()}>
        <p role="status">Loading instructions…</p>
      </Show>
      <Show when={saveError()}>
        <p role="alert" class="error">
          {saveError()}
        </p>
      </Show>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <Show when={!loading() && !error()}>
        <div class="inline-file-editor">
          <FileEditor
            path="SOUL.md"
            label="Personality & instructions"
            content={text()}
            change={setText}
            select={() => {}}
          />
        </div>
        <div class="resource-actions">
          <span class="muted">
            {text() === original() ? "Saved" : "Unsaved changes"}
          </span>
          <button
            type="button"
            disabled={saving() || text() === original()}
            onClick={() => void run(save)}
          >
            {saving() ? "Saving…" : "Save instructions"}
          </button>
        </div>
      </Show>
    </section>
  );
}
