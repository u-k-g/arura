import { createEffect, onCleanup, onMount } from "solid-js";
import { minimalSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";

export default function FileEditor(props: {
  path: string;
  content: string;
  readOnly?: boolean;
  change: (text: string) => void;
  select: (text: string, from: number, to: number) => void;
}) {
  let parent!: HTMLDivElement, view: EditorView | undefined;
  let applying = false,
    disposed = false;
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
        EditorView.contentAttributes.of({ "aria-label": "File content" }),
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
  return <div class="code-editor" ref={parent} />;
}
