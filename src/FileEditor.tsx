import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { minimalSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";

export default function FileEditor(props: {
  path: string;
  label?: string;
  content: string;
  readOnly?: boolean;
  change: (text: string) => void;
  select: (text: string, from: number, to: number) => void;
}) {
  let parent!: HTMLDivElement, view: EditorView | undefined;
  let applying = false,
    disposed = false;
  const [searchOpen, setSearchOpen] = createSignal(false),
    [query, setQuery] = createSignal(""),
    [replacement, setReplacement] = createSignal("");
  function find(backward = false) {
    if (!view || !query()) return;
    const content = view.state.doc.toString(),
      selection = view.state.selection.main;
    let at = backward
      ? selection.from === 0
        ? -1
        : content.lastIndexOf(query(), selection.from - 1)
      : content.indexOf(query(), selection.to);
    if (at < 0) {
      at = backward ? content.lastIndexOf(query()) : content.indexOf(query());
    }
    if (at >= 0) {
      view.dispatch({
        selection: { anchor: at, head: at + query().length },
        scrollIntoView: true,
      });
    }
  }
  function replace(all = false) {
    if (!view || props.readOnly || !query()) return;
    const content = view.state.doc.toString(),
      selection = view.state.selection.main;
    if (all) {
      view.dispatch({
        changes: {
          from: 0,
          to: content.length,
          insert: content.split(query()).join(replacement()),
        },
      });
    } else if (view.state.sliceDoc(selection.from, selection.to) === query()) {
      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: replacement(),
        },
        selection: { anchor: selection.from + replacement().length },
      });
      find();
    } else find();
  }
  const language = new Compartment();
  const editing = new Compartment();
  createEffect(() => {
    const readOnly = Boolean(props.readOnly);
    view?.dispatch({
      effects: editing.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  });
  onMount(() => {
    view = new EditorView({
      parent,
      doc: props.content,
      extensions: [
        minimalSetup,
        lineNumbers(),
        EditorView.lineWrapping,
        language.of([]),
        editing.of([
          EditorState.readOnly.of(Boolean(props.readOnly)),
          EditorView.editable.of(!props.readOnly),
        ]),
        EditorView.contentAttributes.of({
          "aria-label": props.label ?? "File content",
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "14px",
            backgroundColor: "var(--canvas)",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "ui-monospace, monospace",
          },
          ".cm-content": { padding: "16px 0" },
          ".cm-gutters": {
            backgroundColor: "var(--panel)",
            borderRight: "1px solid var(--line)",
          },
          "&.cm-focused": { outline: "none" },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applying) {
            props.change(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            const range = update.state.selection.main;
            props.select(
              update.state.sliceDoc(range.from, range.to),
              update.state.doc.lineAt(range.from).number,
              update.state.doc.lineAt(range.to).number,
            );
          }
        }),
      ],
    });
    void (async () => {
      const ext = props.path.split(".").at(-1)?.toLowerCase();
      const support = ext === "md"
        ? (await import("@codemirror/lang-markdown")).markdown()
        : ext === "json"
        ? (await import("@codemirror/lang-json")).json()
        : ["yaml", "yml"].includes(ext ?? "")
        ? (await import("@codemirror/lang-yaml")).yaml()
        : [];
      if (!disposed) view?.dispatch({ effects: language.reconfigure(support) });
    })();
  });
  createEffect(() => {
    const content = props.content;
    if (view && content !== view.state.doc.toString()) {
      applying = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
      applying = false;
    }
  });
  onCleanup(() => {
    disposed = true;
    view?.destroy();
  });
  return (
    <>
      <button
        type="button"
        class="text-button"
        onClick={() => setSearchOpen((value) => !value)}
      >
        Find and replace
      </button>
      <Show when={searchOpen()}>
        <div class="editor-search">
          <input
            aria-label="Find in file"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <span role="status">
            {query() ? props.content.split(query()).length - 1 : 0} matches
          </span>
          <button type="button" onClick={() => find(true)}>
            Previous
          </button>
          <button type="button" onClick={() => find()}>
            Next
          </button>
          <Show when={!props.readOnly}>
            <input
              aria-label="Replace with"
              value={replacement()}
              onInput={(event) => setReplacement(event.currentTarget.value)}
            />
            <button type="button" onClick={() => replace()}>
              Replace
            </button>
            <button type="button" onClick={() => replace(true)}>
              Replace all
            </button>
          </Show>
        </div>
      </Show>
      <div class="code-editor" ref={parent} />
    </>
  );
}
