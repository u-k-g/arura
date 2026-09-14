import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { connected, subscribe } from "./client";
import { loadCache, saveCache } from "./cache";
import { Empty, Icon } from "./ui";

export default function Artifacts(props: { navigate: (view: string) => void }) {
  const [search, setSearch] = createSignal("");
  const [limit, setLimit] = createSignal(30);
  const [data, setData] = createSignal<any>({
    items: [],
    pending: 0,
    failures: 0,
  });
  createEffect(() => {
    connected();
    const term = search(),
      count = limit(),
      key = `artifacts:${term}:${count}`;
    let disposed = false,
      fresh = false;
    void loadCache<any>(key).then((value) => {
      if (!disposed && !fresh && value) setData(value);
    });
    const stop = subscribe(
      "artifacts",
      "list",
      { search: term, limit: count },
      (value) => {
        fresh = true;
        setData(value);
        void saveCache(key, value);
      },
    );
    onCleanup(() => {
      disposed = true;
      stop();
    });
  });
  return (
    <div class="resource-page">
      <button
        type="button"
        class="text-button"
        onClick={() => props.navigate("resources:files")}
      >
        <Icon name="arrow-left" />
        Host files
      </button>
      <h1>Generated files</h1>
      <p>Files shared by Hermes across your conversations.</p>
      <input
        type="search"
        aria-label="Search generated files"
        placeholder="Search files…"
        value={search()}
        onInput={(e) => {
          setSearch(e.currentTarget.value);
          setLimit(30);
        }}
      />
      <Show when={data().pending}>
        <p role="status">
          Indexing {data().pending} conversations…
          {data().failures
            ? ` ${data().failures} could not be read and will retry.`
            : ""}
        </p>
      </Show>
      <Show when={!connected()}>
        <p>Showing files saved on this device. Reconnect to open host files.</p>
      </Show>
      <div class="resource-list">
        <For each={data().items}>
          {(file: any) => (
            <article class="resource-card">
              <div class="resource-card-heading">
                <Icon name="page" />
                <div>
                  <h3>{file.name}</h3>
                  <p>{file.title}</p>
                  <small>{file.path}</small>
                </div>
              </div>
              <div class="resource-actions">
                <a
                  href={`/api/download?path=${encodeURIComponent(file.path)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open with browser
                </a>
                <a
                  href={`/api/download?path=${encodeURIComponent(file.path)}`}
                  download=""
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => props.navigate(file.conversation)}
                >
                  Conversation
                </button>
              </div>
            </article>
          )}
        </For>
      </div>
      <Show when={!data().items.length && !data().pending}>
        <Empty title="No files found" />
      </Show>
      <Show when={data().hasMore}>
        <button type="button" onClick={() => setLimit((n) => n + 30)}>
          Show 30 more
        </button>
      </Show>
    </div>
  );
}
