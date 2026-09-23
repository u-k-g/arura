import type { ArtifactList } from "../shared/contracts.ts";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { connected, subscribe } from "./client.ts";
import { loadCache, saveCache } from "./cache.ts";
import { Empty, Icon } from "./ui.tsx";

export default function Artifacts(props: { navigate: (view: string) => void }) {
  const [search, setSearch] = createSignal("");
  const [limit, setLimit] = createSignal(30);
  const [data, setData] = createSignal<ArtifactList>({
    items: [],
    pending: 0,
    hasMore: false,
    failures: 0,
  });
  createEffect(() => {
    connected();
    const term = search(),
      count = limit(),
      key = `artifacts:${term}:${count}`;
    let disposed = false,
      fresh = false;
    void loadCache<ArtifactList>(key).then((value) => {
      if (!disposed && !fresh && value) setData(value);
    });
    const stop = subscribe<ArtifactList>(
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
    <div class="artifacts-page">
      <header class="artifact-toolbar">
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
        <span>
          Files{" "}
          <small>
            {data().items.length}
            {data().hasMore ? "+" : ""}
          </small>
        </span>
      </header>
      <Show when={data().pending}>
        <p role="status">
          Indexing {data().pending} conversations…
          {data().failures
            ? ` ${data().failures} could not be read and will retry.`
            : ""}
        </p>
      </Show>
      <Show when={!connected()}>
        <p>Showing files saved on this device. Reconnect to open files.</p>
      </Show>
      <div class="artifact-table-scroll">
        <table class="artifact-table">
          <thead>
            <tr>
              <th>Title / name</th>
              <th>Location</th>
              <th>Session</th>
              <th>
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={data().items}>
              {(file) => (
                <tr class="resource-card">
                  <td>
                    <a
                      class="artifact-name"
                      href={`/api/download?path=${
                        encodeURIComponent(
                          file.path,
                        )
                      }`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Icon name="page" />
                      {file.name}
                    </a>
                  </td>
                  <td class="artifact-location" title={file.path}>
                    {file.path}
                  </td>
                  <td>
                    <button
                      class="artifact-session"
                      type="button"
                      onClick={() => props.navigate(file.conversation)}
                    >
                      {file.title}
                      <span class="sr-only">Conversation</span>
                    </button>
                  </td>
                  <td>
                    <a
                      class="artifact-download"
                      aria-label={`Download ${file.name}`}
                      title="Download"
                      href={`/api/download?path=${
                        encodeURIComponent(
                          file.path,
                        )
                      }`}
                      download=""
                    >
                      <Icon name="download" />
                      <span class="sr-only">Download</span>
                    </a>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
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
