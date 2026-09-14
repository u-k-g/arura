import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { command, connected, request } from "./client";
import { Dialog, Field, run } from "./ui";

export type ControlView = "automation" | "context" | "subagents";
type Automation = {
  title?: string;
  prompt?: string;
  status?: string;
  turns_used?: number;
  max_turns?: number;
  fire_count?: number;
  interval_seconds?: number;
  next_fire_at?: number;
  subgoals?: Array<string | { text?: string; status?: string }>;
};
type Agent = {
  subagent_id: string;
  goal: string;
  model: string;
  status: string;
  tool_count: number;
  last_tool?: string;
};
export default function RunControls(props: {
  conversation: string;
  view: ControlView;
  close: () => void;
}) {
  const [controls, setControls] = createSignal<Record<string, Automation>>({});
  const [context, setContext] = createSignal<any>();
  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [selected, setSelected] = createSignal("");
  const [transcript, setTranscript] = createSignal<{
    available?: boolean;
    text?: string;
    truncated?: boolean;
  }>({});
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [kind, setKind] = createSignal("goal");
  const [prompt, setPrompt] = createSignal("");
  const [interval, setIntervalValue] = createSignal("30m");
  let disposed = false,
    refreshing = false;
  const query = (method: string, params = {}) =>
    request("/api/query", { method, params, conversation: props.conversation });
  async function refresh() {
    if (refreshing || disposed || !connected()) return;
    refreshing = true;
    try {
      if (props.view === "automation") {
        const value = await query("session.control.read");
        if (!disposed) setControls(value.control ?? value);
      } else if (props.view === "context") {
        const value = await query("session.context_breakdown");
        if (!disposed) setContext(value);
      } else {
        const value = await query("subagent.list");
        if (!disposed) setAgents(value.subagents ?? []);
        if (selected()) {
          const id = selected();
          const value = await query("subagent.tail", { subagent_id: id });
          if (!disposed && selected() === id) setTranscript(value);
        }
      }
      if (!disposed) setError("");
    } catch (e) {
      if (!disposed) {
        setError(e instanceof Error ? e.message : "Could not refresh");
      }
    } finally {
      refreshing = false;
    }
  }
  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    onCleanup(() => {
      disposed = true;
      clearInterval(timer);
    });
  });
  async function action(name: string, args: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      await command("rpc", props.conversation, {
        method: "session.control",
        params: { action: name, args },
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!prompt().trim()) return;
    if (kind() !== "goal" && !/^\d+(?:\.\d+)?[smhd]$/.test(interval())) {
      throw new Error("Use an interval such as 30m, 2h, or 1d");
    }
    setBusy(true);
    try {
      const text = kind() === "goal"
        ? `/goal ${prompt().trim()}`
        : kind() === "loop"
        ? `/loop ${interval()} ${prompt().trim()}`
        : `/heartbeat every ${interval()} ${prompt().trim()}`;
      await command("send", props.conversation, { text });
      setPrompt("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={props.view === "automation"
        ? "Conversation automations"
        : props.view === "context"
        ? "Context usage"
        : "Delegated work"}
      close={props.close}
    >
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <Show when={!connected()}>
        <p>Reconnect to view the current state.</p>
      </Show>
      <Show when={props.view === "automation"}>
        <For each={["goal", "loop", "heartbeat"]}>
          {(name) => (
            <Show when={controls()[name]}>
              {(value) => (
                <section class="automation-card">
                  <div class="row">
                    <h3>
                      {name === "goal"
                        ? "Goal"
                        : name === "loop"
                        ? "Repeated prompt"
                        : "Heartbeat"}
                    </h3>
                    <span>{value().status}</span>
                  </div>
                  <p>{value().title ?? value().prompt}</p>
                  <Show when={value().max_turns}>
                    <p>
                      {value().turns_used ?? 0} of {value().max_turns} turns
                    </p>
                    <progress
                      aria-label="Goal turns"
                      value={value().turns_used ?? 0}
                      max={value().max_turns}
                    />
                  </Show>
                  <Show when={value().interval_seconds}>
                    <p>
                      Every {value().interval_seconds} seconds ·{" "}
                      {value().fire_count ?? 0} runs
                    </p>
                  </Show>
                  <For each={value().subgoals ?? []}>
                    {(subgoal, index) => (
                      <div class="row">
                        <span>
                          {typeof subgoal === "string" ? subgoal : subgoal.text}
                        </span>
                        <button
                          type="button"
                          disabled={busy()}
                          onClick={() =>
                            void run(() =>
                              action("subgoal.remove", { index: index() + 1 })
                            )}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </For>
                  <div class="row">
                    <For
                      each={[
                        "pause",
                        "resume",
                        name === "loop" ? "stop" : "clear",
                      ]}
                    >
                      {(verb) => (
                        <button
                          type="button"
                          disabled={busy() || !connected()}
                          onClick={() =>
                            void run(() => action(`${name}.${verb}`))}
                        >
                          {verb[0].toUpperCase() + verb.slice(1)}
                        </button>
                      )}
                    </For>
                    <Show when={name === "goal"}>
                      <button
                        type="button"
                        disabled={busy()}
                        onClick={() => {
                          const text = window.prompt("Add a goal step");
                          if (text?.trim()) {
                            void run(() => action("subgoal.add", { text }));
                          }
                        }}
                      >
                        Add step
                      </button>
                      <button
                        type="button"
                        disabled={busy()}
                        onClick={() => void run(() => action("goal.unwait"))}
                      >
                        Clear wait
                      </button>
                    </Show>
                  </div>
                </section>
              )}
            </Show>
          )}
        </For>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(create);
          }}
        >
          <h3>Start an automation</h3>
          <Field label="Automation">
            <select
              value={kind()}
              onChange={(e) => setKind(e.currentTarget.value)}
            >
              <option value="goal">Goal</option>
              <option value="loop">Repeated prompt</option>
              <option value="heartbeat">Heartbeat</option>
            </select>
          </Field>
          <Field label="Instructions">
            <textarea
              required
              value={prompt()}
              onInput={(e) => setPrompt(e.currentTarget.value)}
            />
          </Field>
          <Show when={kind() !== "goal"}>
            <Field label="Interval" hint="For example, 30m or 2h">
              <input
                required
                value={interval()}
                onInput={(e) => setIntervalValue(e.currentTarget.value)}
              />
            </Field>
          </Show>
          <button
            type="submit"
            disabled={busy() || !connected() || !prompt().trim()}
          >
            Start
          </button>
        </form>
      </Show>
      <Show when={props.view === "context" && context()}>
        <p>{context()?.model}</p>
        <p>
          <strong>
            {Number(context()?.context_used ?? 0).toLocaleString()}
          </strong>{" "}
          / {Number(context()?.context_max ?? 0).toLocaleString()} tokens
        </p>
        <progress
          aria-label="Context utilization"
          max="100"
          value={Math.max(0, Math.min(100, context()?.context_percent ?? 0))}
        />
        <p>
          {Number(context()?.context_percent ?? 0).toFixed(1)}% used
          {context()?.context_estimated ? " · estimated" : ""}
        </p>
        <For each={context()?.categories ?? []}>
          {(category) => (
            <div class="row">
              <span>{category.label ?? category.name ?? category.key}</span>
              <span>
                {Number(category.tokens ?? 0).toLocaleString()} tokens
              </span>
            </div>
          )}
        </For>
      </Show>
      <Show when={props.view === "subagents"}>
        <Show
          when={agents().length}
          fallback={<p>No delegated work is active.</p>}
        >
          <For each={agents()}>
            {(agent) => (
              <section class="automation-card">
                <h3>{agent.goal || "Delegated task"}</h3>
                <p>
                  {agent.status} · {agent.model} · {agent.tool_count ?? 0}{" "}
                  tool calls
                </p>
                <Show when={agent.last_tool}>
                  <p>Latest: {agent.last_tool}</p>
                </Show>
                <div class="row">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(agent.subagent_id);
                      setTranscript({});
                      void refresh();
                    }}
                  >
                    View progress
                  </button>
                  <button
                    type="button"
                    disabled={busy()}
                    onClick={() =>
                      void run(async () => {
                        await command("rpc", props.conversation, {
                          method: "subagent.interrupt",
                          params: { subagent_id: agent.subagent_id },
                        });
                        await refresh();
                      })}
                  >
                    Stop task
                  </button>
                </div>
              </section>
            )}
          </For>
        </Show>
        <Show when={selected()}>
          <section aria-live="polite">
            <h3>Task progress</h3>
            <Show
              when={transcript().available}
              fallback={<p>Progress is not available yet.</p>}
            >
              <Show when={transcript().truncated}>
                <p>Showing recent activity.</p>
              </Show>
              <pre>{transcript().text || "Waiting for activity…"}</pre>
            </Show>
          </section>
        </Show>
      </Show>
    </Dialog>
  );
}
