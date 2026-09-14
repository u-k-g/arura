import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { inform, resource, revision } from "./client.ts";
import { Dialog, Empty, Field, run } from "./ui.tsx";

type Node = {
  id: string;
  label: string;
  kind: string;
  timestamp: number;
  category?: string;
  useCount?: number;
};
type Graph = { nodes: Node[]; edges: { source: string; target: string }[] };
type Document = { id: string; label: string; kind: string; content: string };

export default function MemoryGraph() {
  const [graph, setGraph] = createSignal<Graph>({ nodes: [], edges: [] });
  const [imported, setImported] = createSignal<Graph>();
  const visibleGraph = () => imported() ?? graph();
  const [query, setQuery] = createSignal("");
  const [layout, setLayout] = createSignal("map");
  const [error, setError] = createSignal("");
  const [selected, setSelected] = createSignal<Document>();
  const [content, setContent] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  let generation = 0;
  createEffect(() => {
    revision();
    const current = ++generation;
    void resource("graph")
      .then((value) => {
        if (current === generation) {
          setGraph(value);
          setError("");
        }
      })
      .catch((error) => {
        if (current === generation) setError(error.message);
      });
  });
  onCleanup(() => generation++);
  const nodes = createMemo(() =>
    visibleGraph().nodes.filter((node) =>
      `${node.label} ${node.category ?? ""} ${node.kind}`
        .toLowerCase()
        .includes(query().toLowerCase())
    )
  );
  const positions = createMemo(
    () =>
      new Map(
        nodes()
          .slice(0, 200)
          .map((node, index) => {
            const angle = index * 2.399963229728653;
            const radius = 220 *
              Math.sqrt(
                (index + 1) / Math.max(1, Math.min(200, nodes().length)),
              );
            return [
              node.id,
              {
                ...node,
                x: 300 + Math.cos(angle) * radius,
                y: 260 + Math.sin(angle) * radius,
              },
            ];
          }),
      ),
  );
  async function open(node: Node) {
    if (imported()) {
      setSelected({
        id: node.id,
        label: node.label,
        kind: node.kind,
        content: `${node.kind} · ${node.category ?? "Uncategorized"}\n${
          node.useCount ?? 0
        } uses`,
      });
      setContent(
        `${node.kind} · ${node.category ?? "Uncategorized"}\n${
          node.useCount ?? 0
        } uses`,
      );
      setEditing(false);
      return;
    }
    const document = await resource("graphNode", { id: node.id });
    if (document.ok === false) {
      throw new Error(document.error ?? "This memory is no longer available");
    }
    setSelected(document);
    setContent(document.content);
    setEditing(false);
  }
  const close = () => {
    if (selected()?.content !== content() && !confirm("Discard these edits?")) {
      return;
    }
    setSelected(undefined);
  };
  async function verify(document: Document) {
    const latest = await resource("graphNode", { id: document.id });
    if (latest.ok === false || latest.content !== document.content) {
      throw new Error(
        "This memory changed on the host. Close and reopen it before editing or deleting.",
      );
    }
  }
  async function save() {
    const document = selected();
    if (!document) return;
    await verify(document);
    const result = await resource(
      "saveGraphNode",
      {},
      { id: document.id, content: content() },
    );
    if (result.ok === false) {
      throw new Error(result.error ?? "Could not save this memory");
    }
    setSelected(undefined);
    inform("Memory updated");
  }
  async function remove() {
    const document = selected();
    if (!document || !confirm(`Remove ${document.label}?`)) return;
    await verify(document);
    const result = await resource("deleteGraphNode", {}, { id: document.id });
    if (result.ok === false) {
      throw new Error(result.error ?? "Could not remove this memory");
    }
    setSelected(undefined);
    inform(document.kind === "skill" ? "Skill archived" : "Memory removed");
  }
  function exportGraph() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: "arura-memory-map",
              version: 1,
              exportedAt: new Date().toISOString(),
              graph: {
                nodes: visibleGraph().nodes,
                edges: visibleGraph().edges,
              },
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "memory-map.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section>
      <div class="graph-toolbar">
        <Field label="Find a memory or skill">
          <input
            type="search"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </Field>
        <Field label="View">
          <select
            value={layout()}
            onChange={(event) => setLayout(event.currentTarget.value)}
          >
            <option value="map">Map</option>
            <option value="timeline">Recent changes</option>
          </select>
        </Field>
        <button type="button" onClick={exportGraph}>
          Export map snapshot
        </button>
        <Field label="Import map snapshot">
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              void run(async () => {
                if (file.size > 5 * 1024 * 1024) {
                  throw new Error("Choose a map smaller than 5 MB.");
                }
                const value = JSON.parse(await file.text());
                if (
                  value.format !== "arura-memory-map" ||
                  value.version !== 1 ||
                  !Array.isArray(value.graph?.nodes) ||
                  !Array.isArray(value.graph?.edges)
                ) {
                  throw new Error("Choose an Arura map snapshot.");
                }
                if (
                  value.graph.nodes.length > 5000 ||
                  value.graph.edges.length > 20000
                ) {
                  throw new Error("This map has too many entries.");
                }
                if (
                  value.graph.nodes.some(
                    (node: Node) =>
                      !node ||
                      typeof node.id !== "string" ||
                      typeof node.label !== "string" ||
                      !["skill", "memory"].includes(node.kind) ||
                      !Number.isFinite(node.timestamp),
                  ) ||
                  value.graph.edges.some(
                    (edge: { source?: unknown; target?: unknown }) =>
                      !edge ||
                      typeof edge.source !== "string" ||
                      typeof edge.target !== "string",
                  )
                ) {
                  throw new Error("This map contains invalid entries.");
                }
                setImported(value.graph);
                setSelected(undefined);
              });
              event.currentTarget.value = "";
            }}
          />
        </Field>
      </div>
      <Show when={imported()}>
        <p>Viewing an imported map. It does not change your Hermes memory.</p>
        <button
          type="button"
          onClick={() => {
            setImported(undefined);
            setSelected(undefined);
          }}
        >
          Back to my map
        </button>
      </Show>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <Show
        when={layout() === "map"}
        fallback={
          <div class="resource-list">
            <p>
              Ordered by the timestamps supplied by Hermes. Memory timestamps
              describe file changes, rather than a complete edit history.
            </p>
            <For each={[...nodes()].sort((a, b) => b.timestamp - a.timestamp)}>
              {(node) => (
                <button
                  type="button"
                  class="graph-timeline-item"
                  onClick={() => void run(() => open(node))}
                >
                  <span>{node.label}</span>
                  <small>
                    {node.kind} · {node.timestamp
                      ? new Date(
                        node.timestamp < 1e12
                          ? node.timestamp * 1000
                          : node.timestamp,
                      ).toLocaleString()
                      : "Unknown date"}
                  </small>
                </button>
              )}
            </For>
          </div>
        }
      >
        <p>{nodes().length} memories and skills. Select a point to read it.</p>
        <div class="memory-map-container">
          <svg
            class="memory-map"
            viewBox="0 0 600 520"
            role="img"
            aria-label="Memory and skill connections"
          >
            <For each={visibleGraph().edges}>
              {(edge) => {
                const from = () => positions().get(edge.source),
                  to = () => positions().get(edge.target);
                return (
                  <Show when={from() && to()}>
                    <line
                      x1={from()?.x}
                      y1={from()?.y}
                      x2={to()?.x}
                      y2={to()?.y}
                    />
                  </Show>
                );
              }}
            </For>
            <For each={[...positions().values()]}>
              {(node) => (
                <g>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="18"
                    class="graph-hit-target"
                  />
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.kind === "skill" ? 7 : 5}
                    class={node.kind === "skill"
                      ? "graph-skill"
                      : "graph-memory"}
                  />
                  <Show when={nodes().length < 30}>
                    <text x={node.x} y={node.y + 20} text-anchor="middle">
                      {node.label.slice(0, 24)}
                    </text>
                  </Show>
                </g>
              )}
            </For>
          </svg>
          <For each={[...positions().values()]}>
            {(node) => (
              <button
                type="button"
                class="graph-point"
                aria-label={`${node.kind}: ${node.label}`}
                title={node.label}
                style={{ left: `${node.x / 6}%`, top: `${node.y / 5.2}%` }}
                onClick={() => void run(() => open(node))}
              />
            )}
          </For>
        </div>
        <Show when={nodes().length > 200}>
          <p>
            The map shows 200 matching entries. Narrow the search or use Recent
            changes to browse all entries.
          </p>
        </Show>
      </Show>
      <Show when={!nodes().length}>
        <Empty title="No matching memories or skills" />
      </Show>
      <Show when={selected()}>
        {(document) => (
          <Dialog title={document().label} close={close}>
            <Show
              when={editing()}
              fallback={<pre class="memory-content">{document().content}</pre>}
            >
              <Field label="Content">
                <textarea
                  class="memory-editor"
                  value={content()}
                  onInput={(event) => setContent(event.currentTarget.value)}
                />
              </Field>
            </Show>
            <Show when={!imported()}>
              <div class="resource-actions">
                <Show
                  when={editing()}
                  fallback={
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                    >
                      Edit
                    </button>
                  }
                >
                  <button
                    type="button"
                    class="primary"
                    onClick={() => void run(save)}
                  >
                    Save
                  </button>
                </Show>
                <button type="button" onClick={() => void run(remove)}>
                  {document().kind === "skill"
                    ? "Archive skill"
                    : "Delete memory"}
                </button>
              </div>
            </Show>
          </Dialog>
        )}
      </Show>
    </section>
  );
}
