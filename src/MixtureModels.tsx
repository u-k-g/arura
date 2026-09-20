import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { inform, resource, revision } from "./client.ts";
import { Field, run } from "./ui.tsx";

type Slot = {
  provider: string;
  model: string;
  reasoning_effort?: string | null;
  enabled?: boolean;
};
type Preset = {
  enabled: boolean;
  reference_models: Slot[];
  aggregator: Slot;
  reference_temperature: number | null;
  aggregator_temperature: number | null;
  reference_timeout: number | null;
  degraded_reference_policy: string;
  fanout: string;
};
type Configuration = {
  default_preset: string;
  active_preset: string;
  privacy_filter: string;
  presets: Record<string, Preset>;
};
const blank = (): Preset => ({
  enabled: true,
  reference_models: [{ provider: "", model: "", enabled: true }],
  aggregator: { provider: "", model: "" },
  reference_temperature: null,
  aggregator_temperature: null,
  reference_timeout: null,
  degraded_reference_policy: "loud",
  fanout: "user_turn",
});
function project(value: Configuration): Configuration {
  return {
    default_preset: value.default_preset,
    active_preset: value.active_preset ?? "",
    privacy_filter: value.privacy_filter ?? "",
    presets: value.presets ?? {},
  };
}
function ModelSlot(props: {
  title: string;
  value: Slot;
  change: (value: Slot) => void;
  reference?: boolean;
}) {
  return (
    <fieldset>
      <legend>{props.title}</legend>
      <Field label="Provider">
        <input
          required
          value={props.value.provider}
          onInput={(e) =>
            props.change({ ...props.value, provider: e.currentTarget.value })
          }
        />
      </Field>
      <Field label="Model">
        <input
          required
          value={props.value.model}
          onInput={(e) =>
            props.change({ ...props.value, model: e.currentTarget.value })
          }
        />
      </Field>
      <Field label="Reasoning effort">
        <select
          value={props.value.reasoning_effort ?? ""}
          onChange={(e) =>
            props.change({
              ...props.value,
              reasoning_effort: e.currentTarget.value || null,
            })
          }
        >
          <For
            each={[
              "",
              "none",
              "minimal",
              "low",
              "medium",
              "high",
              "xhigh",
              "max",
              "ultra",
            ]}
          >
            {(value) => (
              <option value={value}>{value || "Provider default"}</option>
            )}
          </For>
        </select>
      </Field>
      <Show when={props.reference}>
        <Field label="Enabled">
          <input
            type="checkbox"
            checked={props.value.enabled !== false}
            onChange={(e) =>
              props.change({
                ...props.value,
                enabled: e.currentTarget.checked,
              })
            }
          />
        </Field>
      </Show>
    </fieldset>
  );
}
export default function MixtureModels() {
  const [config, setConfig] = createSignal<Configuration>();
  const [baseline, setBaseline] = createSignal("");
  const [selected, setSelected] = createSignal("");
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal("");
  const [conflict, setConflict] = createSignal(false);
  const dirty = () => JSON.stringify(config()) !== baseline();
  const current = () => config()?.presets[selected()];
  function accept(value: Configuration) {
    const next = project(value);
    setConfig(structuredClone(next));
    setBaseline(JSON.stringify(next));
    if (!next.presets[selected()]) {
      setSelected(next.default_preset || Object.keys(next.presets)[0]);
    }
    setConflict(false);
    setError("");
  }
  createEffect(() => {
    revision();
    let cancelled = false;
    void resource("moa")
      .then((value) => {
        if (cancelled) return;
        if (!config() || !dirty()) accept(value);
        else setConflict(JSON.stringify(project(value)) !== baseline());
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    onCleanup(() => {
      cancelled = true;
    });
  });
  function change(patch: Partial<Preset>) {
    setConfig(
      (old) =>
        old && {
          ...old,
          presets: {
            ...old.presets,
            [selected()]: { ...old.presets[selected()], ...patch },
          },
        },
    );
  }
  function named(rename = false) {
    if (rename && config()?.privacy_filter) {
      throw new Error(
        "This Hermes version cannot rename presets while preserving its privacy filter.",
      );
    }
    const key = name().trim();
    if (!key || config()?.presets[key]) {
      throw new Error("Choose a unique preset name.");
    }
    setConfig((old) => {
      if (!old) return old;
      const presets = {
        ...old.presets,
        [key]: rename ? old.presets[selected()] : blank(),
      };
      if (rename) delete presets[selected()];
      return {
        ...old,
        presets,
        default_preset:
          rename && old.default_preset === selected()
            ? key
            : old.default_preset,
        active_preset:
          rename && old.active_preset === selected() ? key : old.active_preset,
      };
    });
    setSelected(key);
    setName("");
  }
  function remove() {
    if (config()?.privacy_filter) return;
    setConfig((old) => {
      if (!old || Object.keys(old.presets).length <= 1) return old;
      const presets = { ...old.presets };
      delete presets[selected()];
      return {
        ...old,
        presets,
        default_preset:
          old.default_preset === selected()
            ? Object.keys(presets)[0]
            : old.default_preset,
        active_preset:
          old.active_preset === selected() ? "" : old.active_preset,
      };
    });
    setSelected(config()?.default_preset ?? "");
  }
  async function save() {
    const value = config();
    if (!value) throw new Error("Wait for the mixture configuration to load");
    for (const [key, preset] of Object.entries(value.presets)) {
      if (
        !preset.reference_models.length ||
        [...preset.reference_models, preset.aggregator].some(
          (slot) =>
            !slot.provider.trim() ||
            !slot.model.trim() ||
            slot.provider.toLowerCase() === "moa",
        )
      ) {
        throw new Error(
          `${key} needs reference models and an aggregator, with a provider and model for each. A mixture cannot reference another mixture.`,
        );
      }
      if (
        preset.reference_timeout !== null &&
        (!Number.isFinite(preset.reference_timeout) ||
          preset.reference_timeout <= 0)
      ) {
        throw new Error(
          "Reference timeout must be positive or empty to inherit.",
        );
      }
      if (
        !["user_turn", "per_iteration"].includes(preset.fanout) &&
        !/^every_n:([2-9]|[1-9]\d+)$/.test(preset.fanout)
      ) {
        throw new Error(
          "Cadence must be user_turn, per_iteration, or every_n:N with N at least 2.",
        );
      }
    }
    const latest = project(await resource("moa"));
    if (JSON.stringify(latest) !== baseline()) {
      setConflict(true);
      throw new Error(
        "Mixture settings changed elsewhere. Reload before saving.",
      );
    }
    // Generic config merges maps; the dedicated endpoint replaces them but clears privacy_filter.
    if (value.privacy_filter) {
      await resource("saveConfig", {}, { config: { moa: value } });
    } else {
      const { privacy_filter: _privacy, ...body } = value;
      await resource("saveMoa", {}, body);
    }
    accept(await resource("moa"));
    inform("Mixture presets saved");
  }
  return (
    <section>
      <p>
        Ask reference models for contributions, then let an aggregator compose
        the answer. Each enabled model uses your configured inference
        connection.
      </p>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <Show when={conflict()}>
        <p role="alert">
          Mixture settings changed elsewhere. Your unsaved edits are preserved.
        </p>
      </Show>
      <Show when={config()}>
        {(value) => (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(save);
            }}
          >
            <Field label="Default mixture preset">
              <select
                value={value().default_preset}
                onChange={(e) =>
                  setConfig({
                    ...value(),
                    default_preset: e.currentTarget.value,
                  })
                }
              >
                <For each={Object.keys(value().presets)}>
                  {(key) => <option>{key}</option>}
                </For>
              </select>
            </Field>
            <Field label="Active mixture preset">
              <select
                value={value().active_preset}
                onChange={(e) =>
                  setConfig({
                    ...value(),
                    active_preset: e.currentTarget.value,
                  })
                }
              >
                <option value="">No active mixture</option>
                <For each={Object.keys(value().presets)}>
                  {(key) => <option>{key}</option>}
                </For>
              </select>
            </Field>
            <Field label="Preset to edit">
              <select
                value={selected()}
                onChange={(e) => setSelected(e.currentTarget.value)}
              >
                <For each={Object.keys(value().presets)}>
                  {(key) => <option>{key}</option>}
                </For>
              </select>
            </Field>
            <Field label="New preset name">
              <input
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
              />
            </Field>
            <div class="resource-actions">
              <button type="button" onClick={() => named()}>
                Add preset
              </button>
              <button
                type="button"
                disabled={Boolean(value().privacy_filter)}
                onClick={() => named(true)}
              >
                Rename selected preset
              </button>
              <button
                type="button"
                disabled={
                  Boolean(value().privacy_filter) ||
                  Object.keys(value().presets).length <= 1
                }
                onClick={remove}
              >
                Delete selected preset
              </button>
            </div>
            <Show when={value().privacy_filter}>
              <p class="subtitle">
                Your host has a mixture privacy filter. This Hermes version
                supports adding and editing presets safely, but its
                rename/delete endpoint would clear that filter.
              </p>
            </Show>
            <Show when={current()}>
              {(preset) => (
                <div class="resource-card">
                  <h3>{selected()}</h3>
                  <Field label="Preset enabled">
                    <input
                      type="checkbox"
                      checked={preset().enabled}
                      onChange={(e) =>
                        change({ enabled: e.currentTarget.checked })
                      }
                    />
                  </Field>
                  <For
                    each={preset().reference_models.map((_, index) => index)}
                  >
                    {(index) => (
                      <div>
                        <ModelSlot
                          title={`Reference ${index + 1}`}
                          reference
                          value={preset().reference_models[index]}
                          change={(slot) =>
                            change({
                              reference_models: preset().reference_models.map(
                                (old, i) => (i === index ? slot : old),
                              ),
                            })
                          }
                        />
                        <button
                          type="button"
                          disabled={preset().reference_models.length <= 1}
                          onClick={() =>
                            change({
                              reference_models:
                                preset().reference_models.filter(
                                  (_, i) => i !== index,
                                ),
                            })
                          }
                        >
                          Remove reference {index + 1}
                        </button>
                      </div>
                    )}
                  </For>
                  <button
                    type="button"
                    onClick={() =>
                      change({
                        reference_models: [
                          ...preset().reference_models,
                          { provider: "", model: "", enabled: true },
                        ],
                      })
                    }
                  >
                    Add reference model
                  </button>
                  <ModelSlot
                    title="Aggregator"
                    value={preset().aggregator}
                    change={(slot) => change({ aggregator: slot })}
                  />
                  <For
                    each={
                      [
                        "reference_temperature",
                        "aggregator_temperature",
                        "reference_timeout",
                      ] as const
                    }
                  >
                    {(key) => (
                      <Field
                        label={
                          key === "reference_timeout"
                            ? "Reference timeout in seconds (empty inherits)"
                            : `${
                                key === "reference_temperature"
                                  ? "Reference"
                                  : "Aggregator"
                              } temperature (empty uses provider default)`
                        }
                      >
                        <input
                          type="number"
                          step="any"
                          value={preset()[key] ?? ""}
                          onInput={(e) =>
                            change({
                              [key]:
                                e.currentTarget.value === ""
                                  ? null
                                  : Number(e.currentTarget.value),
                            })
                          }
                        />
                      </Field>
                    )}
                  </For>
                  <Field label="When a reference model fails">
                    <select
                      value={preset().degraded_reference_policy}
                      onChange={(e) =>
                        change({
                          degraded_reference_policy: e.currentTarget.value,
                        })
                      }
                    >
                      <option value="loud">Report the failure</option>
                      <option value="silent">Continue quietly</option>
                    </select>
                  </Field>
                  <Field label="Reference cadence">
                    <input
                      value={preset().fanout}
                      onInput={(e) => change({ fanout: e.currentTarget.value })}
                    />
                  </Field>
                  <p class="subtitle">
                    user_turn, per_iteration, or every_n:2 (or a larger
                    interval).
                  </p>
                </div>
              )}
            </Show>
            <div class="resource-actions">
              <button type="submit" class="primary" disabled={!dirty()}>
                Save mixture presets
              </button>
              <button
                type="button"
                onClick={() =>
                  void run(async () => accept(await resource("moa")))
                }
              >
                Reload mixture presets
              </button>
            </div>
          </form>
        )}
      </Show>
    </section>
  );
}
