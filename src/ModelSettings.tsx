import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { record, records } from "../shared/contracts.ts";
import { inform, mutate, resource, revision, workspace } from "./client.ts";
import { rejectAction } from "./ActionDialog.tsx";
import { run } from "./ui.tsx";

type Assignment = {
  provider: string;
  model: string;
  base_url?: string;
  task?: string;
};
type Provider = {
  id: string;
  name?: string;
  models?: string[];
  api_url?: string;
  aliases?: string[];
};

function ModelAssignment(props: {
  profile: string;
  value: Assignment;
  main?: Assignment;
  providers: Provider[];
  changed: () => Promise<void>;
}) {
  const [value, setValue] = createSignal<Assignment>({ ...props.value });
  const [saving, setSaving] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [saveError, setSaveError] = createSignal("");
  createEffect(() => {
    const next = props.value;
    if (!dirty()) setValue({ ...next });
  });
  const update = (next: Partial<Assignment>) => {
    setDirty(true);
    setValue({ ...value(), ...next });
  };
  const label = () =>
    props.value.task ? props.value.task.replaceAll("_", " ") : "Default model";
  const listId = () => `model-options-${props.value.task ?? "main"}`;
  async function save(selection?: Assignment) {
    if (saving()) return;
    const selected = { ...value(), ...selection },
      profile = props.profile;
    const endpoint = props.providers.find(
      (entry) =>
        entry.id === selected.provider ||
        entry.aliases?.includes(selected.provider),
    )?.api_url;
    if (!selected.provider.trim() || !selected.model.trim()) {
      setSaveError("Choose a provider and model.");
      return;
    }
    setSaveError("");
    setSaving(true);
    try {
      const body = {
        ...selected,
        ...(endpoint ? { base_url: selected.base_url || endpoint } : {}),
        scope: props.value.task ? "auxiliary" : "main",
      };
      let result = await resource(
        props.value.task ? "setAuxModel" : "setModel",
        { profile },
        body,
      );
      if (result.confirm_required) {
        if (
          await rejectAction(
            result.confirm_message ?? "Confirm this model selection?",
          )
        ) {
          return;
        }
        result = await resource(
          props.value.task ? "setAuxModel" : "setModel",
          { profile },
          { ...body, confirm_expensive_model: true },
        );
      }
      if (result.ok === false) {
        throw new Error(result.error ?? "Model selection was not accepted");
      }
      await props.changed();
      setDirty(false);
      inform("Model saved");
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      class="model-assignment"
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => save());
      }}
    >
      <h4>{label()}</h4>
      <Show when={saveError()}>
        <p role="alert" class="error">
          {saveError()}
        </p>
      </Show>
      <div class="model-assignment-fields">
        <label>
          Provider
          <select
            aria-label={`${label()} provider`}
            value={value().provider}
            onChange={(event) => {
              const id = event.currentTarget.value,
                provider = props.providers.find((item) => item.id === id);
              update({
                provider: id,
                model: "",
                base_url: provider?.api_url ?? "",
              });
            }}
          >
            <option value="">Choose provider</option>
            <Show
              when={
                value().provider &&
                !props.providers.some((item) => item.id === value().provider)
              }
            >
              <option value={value().provider}>{value().provider}</option>
            </Show>
            <For each={props.providers}>
              {(provider) => (
                <option
                  value={provider.id}
                  selected={value().provider === provider.id}
                >
                  {provider.name ?? provider.id}
                </option>
              )}
            </For>
          </select>
        </label>
        <label>
          Model
          <input
            aria-label={`${label()} model`}
            list={listId()}
            value={value().model}
            placeholder="Model identifier"
            onInput={(event) => update({ model: event.currentTarget.value })}
          />
        </label>
        <datalist id={listId()}>
          <For
            each={
              props.providers.find((item) => item.id === value().provider)
                ?.models ?? []
            }
          >
            {(model) => <option value={model} />}
          </For>
        </datalist>
        <button type="submit" disabled={saving() || !dirty()}>
          {saving() ? "Saving…" : "Save"}
        </button>
      </div>
      <Show when={props.value.task && props.main}>
        <button
          type="button"
          disabled={saving()}
          onClick={() => {
            const main = props.main;
            if (main) void run(() => save({ ...main, base_url: "" }));
          }}
        >
          Use main model
        </button>
      </Show>
      <Show when={props.value.task}>
        <label>
          Inference URL
          <input
            aria-label={`${label()} inference URL`}
            type="url"
            value={value().base_url ?? ""}
            onInput={(event) => update({ base_url: event.currentTarget.value })}
          />
        </label>
      </Show>
    </form>
  );
}
export default function ModelSettings(props: { profile: string }) {
  const [main, setMain] = createSignal<Assignment>();
  const [tasks, setTasks] = createSignal<Assignment[]>([]);
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [error, setError] = createSignal("");
  let generation = 0;
  onCleanup(() => {
    generation++;
  });
  async function refresh() {
    const current = ++generation;
    const [info, auxiliary, options] = await Promise.all([
      resource("modelInfo", { profile: props.profile }),
      resource("auxiliary", { profile: props.profile }),
      resource("models", { explicit_only: "1", profile: props.profile }),
    ]);
    if (current !== generation) return;
    const assignment = (item: Record<string, unknown>): Assignment => ({
      model: String(item.model ?? ""),
      provider: String(item.provider ?? ""),
      ...(typeof item.task === "string"
        ? { task: item.task, base_url: String(item.base_url ?? "") }
        : {}),
    });
    setMain(assignment(record(info)));
    setTasks(
      records(auxiliary.tasks)
        .filter((item) => !/image.?gen/i.test(String(item.task)))
        .map(assignment),
    );
    setProviders(
      records(options.providers)
        .filter(
          (item) =>
            !/^(nous|hermes[-_]cloud)$/.test(String(item.slug ?? item.id)),
        )
        .map((item) => ({
          id: String(item.slug ?? item.id),
          aliases: Array.isArray(item.aliases)
            ? item.aliases.filter(
                (alias): alias is string => typeof alias === "string",
              )
            : [],
          name: String(item.name ?? item.slug ?? item.id),
          models: Array.isArray(item.models)
            ? item.models.filter(
                (model): model is string => typeof model === "string",
              )
            : [],
          ...(typeof item.api_url === "string"
            ? { api_url: item.api_url }
            : {}),
        })),
    );
    setError("");
  }
  createEffect(() => {
    revision();
    void refresh().catch((error) => setError(error.message));
  });
  return (
    <section class="model-settings">
      <Show when={error()}>
        <p role="alert">
          {error()}{" "}
          <button type="button" onClick={() => void run(refresh)}>
            Retry
          </button>
        </p>
      </Show>
      <Show when={main()} fallback={<p role="status">Loading models…</p>}>
        {(value) => (
          <ModelAssignment
            profile={props.profile}
            value={value()}
            providers={providers()}
            changed={refresh}
          />
        )}
      </Show>
      <details class="settings-disclosure">
        <summary>Customize model list</summary>
        <p class="subtitle">
          Choose which models appear in the picker. Changes sync across your
          devices.
        </p>
        <For each={providers()}>
          {(provider) => (
            <fieldset class="model-visibility-group">
              <legend>{provider.name || provider.id}</legend>
              <For each={provider.models ?? []}>
                {(model) => {
                  const key = JSON.stringify([provider.id, model]);
                  return (
                    <label class="model-visibility">
                      <input
                        type="checkbox"
                        aria-label={`${model} · ${
                          provider.name || provider.id
                        }`}
                        checked={
                          !workspace()?.settings.hiddenModels?.includes(key)
                        }
                        onChange={(event) => {
                          const hidden = !event.currentTarget.checked;
                          void run(() =>
                            mutate("workspace.modelVisibility", {
                              model: key,
                              hidden,
                            }),
                          );
                        }}
                      />
                      <span>{model}</span>
                    </label>
                  );
                }}
              </For>
            </fieldset>
          )}
        </For>
      </details>
      <details class="settings-disclosure">
        <summary>Helper models</summary>
        <For each={tasks().flatMap((task) => (task.task ? [task.task] : []))}>
          {(task) => (
            <ModelAssignment
              profile={props.profile}
              value={
                tasks().find((entry) => entry.task === task) ?? {
                  task,
                  provider: "",
                  model: "",
                }
              }
              main={main()}
              providers={providers()}
              changed={refresh}
            />
          )}
        </For>
      </details>
    </section>
  );
}
