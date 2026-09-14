import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { inform, resource, revision } from "./client.ts";
import { Field, run } from "./ui.tsx";

type Fallback = {
  provider: string;
  model: string;
  base_url?: string;
  key_env?: string;
  [key: string]: unknown;
};
export default function FallbackModels() {
  const [rows, setRows] = createSignal<Fallback[]>([]);
  const [legacy, setLegacy] = createSignal(false);
  const [clearLegacy, setClearLegacy] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal("");
  const [baseline, setBaseline] = createSignal("");
  const [conflict, setConflict] = createSignal(false);
  let originalLegacy: unknown;
  const fingerprint = (config: any) =>
    JSON.stringify([
      config.fallback_providers ?? [],
      config.fallback_model ?? null,
    ]);
  function accept(config: any) {
    setRows(structuredClone(config.fallback_providers ?? []));
    originalLegacy = config.fallback_model ?? null;
    setLegacy(Boolean(originalLegacy));
    setBaseline(fingerprint(config));
    setClearLegacy(false);
    setConflict(false);
    setReady(true);
  }
  createEffect(() => {
    revision();
    let cancelled = false;
    void resource("config")
      .then((result) => {
        if (cancelled) return;
        const config = result.config ?? result;
        const dirty =
          clearLegacy() ||
          JSON.stringify([rows(), originalLegacy]) !== baseline();
        if (!ready() || !dirty) accept(config);
        else setConflict(fingerprint(config) !== baseline());
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      });
    onCleanup(() => {
      cancelled = true;
    });
  });
  const update = (index: number, key: string, value: string) =>
    setRows((rows) =>
      rows.map((row, n) => (n === index ? { ...row, [key]: value } : row)),
    );
  function move(index: number, direction: number) {
    setRows((rows) => {
      const next = [...rows],
        destination = index + direction;
      if (destination < 0 || destination >= next.length) return rows;
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }
  async function save(disable = false) {
    if (
      !disable &&
      rows().some((row) => !row.provider.trim() || !row.model.trim())
    ) {
      throw new Error("Each fallback needs a provider and model.");
    }
    const result = await resource("config");
    if (fingerprint(result.config ?? result) !== baseline()) {
      setConflict(true);
      throw new Error(
        "Fallback settings changed elsewhere. Reload before saving.",
      );
    }
    await resource(
      "saveConfig",
      {},
      {
        config: {
          fallback_providers: disable ? [] : rows(),
          ...(disable || clearLegacy() ? { fallback_model: null } : {}),
        },
      },
    );
    const saved = await resource("config");
    accept(saved.config ?? saved);
    inform("Fallback models saved");
  }
  return (
    <section>
      <p>Hermes tries these models in order if the primary model fails.</p>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <Show when={conflict()}>
        <p role="alert">
          Fallbacks changed elsewhere. Your unsaved edits are preserved.
        </p>
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              const result = await resource("config");
              accept(result.config ?? result);
            })
          }
        >
          Reload fallbacks
        </button>
      </Show>
      <Show when={ready()}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => save());
          }}
        >
          <For each={rows().map((_, index) => index)}>
            {(index) => (
              <article class="resource-card">
                <h3>Fallback {index + 1}</h3>
                <Field label="Provider">
                  <input
                    required
                    value={rows()[index].provider}
                    onInput={(event) =>
                      update(index, "provider", event.currentTarget.value)
                    }
                  />
                </Field>
                <Field label="Model">
                  <input
                    required
                    value={rows()[index].model}
                    onInput={(event) =>
                      update(index, "model", event.currentTarget.value)
                    }
                  />
                </Field>
                <Field label="Inference URL (optional)">
                  <input
                    type="url"
                    value={String(rows()[index].base_url ?? "")}
                    onInput={(event) =>
                      update(index, "base_url", event.currentTarget.value)
                    }
                  />
                </Field>
                <Field label="API key environment variable (optional)">
                  <input
                    value={String(rows()[index].key_env ?? "")}
                    onInput={(event) =>
                      update(index, "key_env", event.currentTarget.value)
                    }
                  />
                </Field>
                <div class="resource-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    disabled={index === rows().length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRows((rows) => rows.filter((_, n) => n !== index))
                    }
                  >
                    Remove
                  </button>
                </div>
              </article>
            )}
          </For>
          <Show when={legacy()}>
            <p>
              Your host also has legacy fallback configuration, which runs after
              this list.
            </p>
            <Field label="Clear legacy fallback configuration">
              <input
                type="checkbox"
                checked={clearLegacy()}
                onChange={(event) =>
                  setClearLegacy(event.currentTarget.checked)
                }
              />
            </Field>
          </Show>
          <div class="resource-actions">
            <button
              type="button"
              onClick={() =>
                setRows((rows) => [...rows, { provider: "", model: "" }])
              }
            >
              Add fallback
            </button>
            <button type="submit" class="primary">
              Save fallback order
            </button>
            <button type="button" onClick={() => void run(() => save(true))}>
              Disable all fallbacks
            </button>
          </div>
        </form>
      </Show>
    </section>
  );
}
