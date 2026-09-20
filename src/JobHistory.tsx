import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { resource, revision } from "./client.ts";
import { record, records } from "../shared/contracts.ts";

export default function JobHistory(props: {
  id: string;
  profile: string;
  navigate: (view: string) => void;
}) {
  const [runs, setRuns] = createSignal<Record<string, unknown>[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  createEffect(() => {
    const id = props.id;
    revision();
    let disposed = false;
    setLoading(true);
    setError("");
    void resource("jobRuns", { id, profile: props.profile })
      .then((value) => {
        if (!disposed) {
          setRuns(records(Array.isArray(value) ? value : record(value).runs));
        }
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
  function date(value: unknown) {
    if (!value) return "";
    const parsed = new Date(
      typeof value === "number"
        ? value < 1e12
          ? value * 1000
          : value
        : String(value),
    );
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
  }
  return (
    <section class="job-history">
      <h4>
        Run history <Show when={runs().length}>· {runs().length}</Show>
      </h4>
      <Show when={loading()}>
        <p role="status">Loading run history…</p>
      </Show>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <For each={runs()}>
        {(run) => (
          <button
            type="button"
            onClick={() =>
              props.navigate(
                JSON.stringify([
                  String(run.profile ?? (props.profile || "default")),
                  String(run.id),
                ]),
              )
            }
          >
            <span>{String(run.title || run.preview || run.id)}</span>
            <time>{date(run.last_active ?? run.started_at)}</time>
          </button>
        )}
      </For>
      <Show when={!loading() && !error() && !runs().length}>
        <p class="quiet">No runs yet.</p>
      </Show>
    </section>
  );
}
