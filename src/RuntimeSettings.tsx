import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { inform, resource, revision } from "./client";
import { Field, run } from "./ui";

type Values = Record<string, string | number | boolean>;
const defaults: Record<string, Values> = {
  delegation: {
    model: "",
    provider: "",
    base_url: "",
    reasoning_effort: "",
    max_iterations: 250,
    max_concurrent_children: 10,
    child_timeout_seconds: 0,
    max_spawn_depth: 1,
    orchestrator_enabled: true,
    inherit_mcp_toolsets: true,
    independent_completions: false,
  },
  resources: {
    max_size: 128,
    idle_ttl_secs: 3600,
    memory_high_mb: "auto",
    max_evictions_per_pass: 16,
    protect_recent: 8,
  },
  computer: {
    permission_mode: "standard",
    capability_manifest: "",
    native_wayland: false,
  },
};
const labels: Record<string, string> = {
  model: "Model (empty inherits parent)",
  provider: "Provider (empty inherits parent)",
  base_url: "Inference URL (empty inherits parent)",
  reasoning_effort: "Reasoning effort",
  max_iterations: "Maximum steps",
  max_concurrent_children: "Concurrent subagents",
  child_timeout_seconds: "Timeout in seconds (0 disables)",
  max_spawn_depth: "Maximum delegation depth",
  orchestrator_enabled: "Allow orchestration",
  inherit_mcp_toolsets: "Inherit MCP tools",
  independent_completions: "Allow independent completion",
  max_size: "Maximum cached agents",
  idle_ttl_secs: "Idle lifetime in seconds",
  memory_high_mb: "Memory threshold in MB (or auto)",
  max_evictions_per_pass: "Maximum evictions per pass",
  protect_recent: "Recently used agents to protect",
  permission_mode: "Permission mode",
  capability_manifest: "Reviewed capability manifest on the host",
  native_wayland: "Use native Wayland capture",
};
function section(config: any, kind: string): Values {
  const source = kind === "resources"
    ? config.agent?.agent_cache
    : kind === "computer"
    ? config.computer_use
    : config.delegation;
  return Object.fromEntries(
    Object.entries(defaults[kind]).map(([key, fallback]) => [
      key,
      source?.[key] ?? fallback,
    ]),
  );
}
export default function RuntimeSettings(props: { kind: string }) {
  const [values, setValues] = createSignal<Values>({});
  const [original, setOriginal] = createSignal<Values>({});
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal("");
  const [changedElsewhere, setChangedElsewhere] = createSignal(false);
  const [status, setStatus] = createSignal<any>();
  const dirty = () => JSON.stringify(values()) !== JSON.stringify(original());
  async function read() {
    const result = await resource("config");
    return section(result.config ?? result, props.kind);
  }
  async function reload() {
    const next = await read();
    setOriginal(next);
    setValues({ ...next });
    setChangedElsewhere(false);
    setError("");
    setReady(true);
  }
  createEffect(() => {
    revision();
    let cancelled = false;
    void read()
      .then((next) => {
        if (cancelled) return;
        if (dirty()) {
          setChangedElsewhere(
            JSON.stringify(next) !== JSON.stringify(original()),
          );
        } else {
          setOriginal(next);
          setValues({ ...next });
        }
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    if (props.kind === "computer") {
      void resource("computer")
        .then((next) => {
          if (!cancelled) setStatus(next);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }
    onCleanup(() => {
      cancelled = true;
    });
  });
  async function save() {
    const current = await read();
    const updates = Object.fromEntries(
      Object.entries(values()).filter(
        ([key, value]) => value !== original()[key],
      ),
    );
    if (Object.keys(updates).some((key) => current[key] !== original()[key])) {
      setChangedElsewhere(true);
      throw new Error(
        "These settings changed elsewhere. Reload before saving.",
      );
    }
    for (const [key, value] of Object.entries(updates)) {
      if (
        typeof value === "number" &&
        (!Number.isSafeInteger(value) || value < 0)
      ) {
        throw new Error(`${labels[key]} must be a non-negative integer.`);
      }
      if (
        [
          "max_iterations",
          "max_concurrent_children",
          "max_spawn_depth",
        ].includes(key) &&
        Number(value) < 1
      ) {
        throw new Error(`${labels[key]} must be at least 1.`);
      }
      if (
        key === "child_timeout_seconds" &&
        Number(value) > 0 &&
        Number(value) < 30
      ) {
        throw new Error(
          "A subagent timeout must be at least 30 seconds, or 0 to disable it.",
        );
      }
      if (
        key === "memory_high_mb" &&
        value !== "auto" &&
        (!/^\d+$/.test(String(value)) || Number(value) < 1)
      ) {
        throw new Error(
          "Memory threshold must be auto or a positive number of MB.",
        );
      }
    }
    if (
      props.kind === "computer" &&
      values().permission_mode === "bounded" &&
      !String(values().capability_manifest).trim()
    ) {
      throw new Error("Bounded access needs a reviewed capability manifest.");
    }
    const config = props.kind === "resources"
      ? { agent: { agent_cache: updates } }
      : props.kind === "computer"
      ? { computer_use: updates }
      : { delegation: updates };
    await resource("saveConfig", {}, { config });
    await reload();
    inform("Runtime settings saved");
  }
  return (
    <section>
      <p>
        {props.kind === "resources"
          ? "Keep recently used agents ready on your host. These limits control cached agents and transcripts; inference models stay with your provider."
          : props.kind === "computer"
          ? "Configure Hermes’s computer-use tool on the host. Enable or disable the tool in Tools."
          : "Defaults for delegated work. Empty model fields inherit the parent’s inference configuration."}
      </p>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <Show when={status()}>
        {(state) => (
          <div class="resource-card">
            <h3>
              {state().ready
                ? "Computer use is ready"
                : "Computer use is not ready"}
            </h3>
            <p>
              {state().platform}
              {state().version ? ` · ${state().version}` : ""}
            </p>
            <For each={state().checks ?? []}>
              {(check: any) => (
                <p>
                  {check.label}: {check.message || check.status}
                </p>
              )}
            </For>
            <Show when={state().error}>
              <p role="alert">{state().error}</p>
            </Show>
          </div>
        )}
      </Show>
      <Show when={changedElsewhere()}>
        <p role="alert">
          Settings changed on another device or on the host. Your unsaved edits
          are still here.
        </p>
      </Show>
      <Show when={ready()}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(save);
          }}
        >
          <For each={Object.keys(defaults[props.kind])}>
            {(key) => (
              <Field label={labels[key]}>
                <Show
                  when={["permission_mode", "reasoning_effort"].includes(key)}
                  fallback={
                    <input
                      type={typeof defaults[props.kind][key] === "boolean"
                        ? "checkbox"
                        : typeof defaults[props.kind][key] === "number"
                        ? "number"
                        : "text"}
                      min="0"
                      step="1"
                      checked={values()[key] === true}
                      value={String(values()[key] ?? "")}
                      onInput={(event) =>
                        setValues((old) => ({
                          ...old,
                          [key]: typeof defaults[props.kind][key] === "boolean"
                            ? event.currentTarget.checked
                            : typeof defaults[props.kind][key] === "number"
                            ? Number(event.currentTarget.value)
                            : event.currentTarget.value,
                        }))}
                    />
                  }
                >
                  <select
                    value={String(values()[key] ?? "")}
                    onChange={(event) =>
                      setValues((old) => ({
                        ...old,
                        [key]: event.currentTarget.value,
                      }))}
                  >
                    <For
                      each={key === "permission_mode"
                        ? ["standard", "bounded"]
                        : [
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
                      {(option) => (
                        <option value={option}>
                          {option || "Inherit parent"}
                        </option>
                      )}
                    </For>
                  </select>
                </Show>
              </Field>
            )}
          </For>
          <div class="resource-actions">
            <button type="submit" class="primary" disabled={!dirty()}>
              Save runtime settings
            </button>
            <button type="button" onClick={() => void run(reload)}>
              Reload settings
            </button>
          </div>
        </form>
      </Show>
    </section>
  );
}
