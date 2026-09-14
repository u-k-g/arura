import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { registerPlainText } from "@lexical/plain-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  type EditorConfig,
  HISTORY_PUSH_TAG,
  KEY_DOWN_COMMAND,
  type NodeKey,
  PASTE_COMMAND,
  type SerializedTextNode,
  SKIP_DOM_SELECTION_TAG,
  TextNode,
} from "lexical";
import { createEffect, onCleanup, onMount, untrack } from "solid-js";

// Tokens retain their literal Hermes prompt text, including when copied or
// restored from a plain-text draft. They are edited/deleted as a whole.
class ReferenceNode extends TextNode {
  static getType() {
    return "arura-reference";
  }
  static clone(node: ReferenceNode) {
    return new ReferenceNode(node.__text, node.__key);
  }
  static importJSON(value: SerializedTextNode) {
    return new ReferenceNode().updateFromJSON(value).setMode("token");
  }
  constructor(text = "", key?: NodeKey) {
    super(text, key);
  }
  createDOM(config: EditorConfig) {
    const element = super.createDOM(config);
    element.classList.add("composer-reference");
    element.title = this.getTextContent();
    return element;
  }
  canInsertTextBefore() {
    return false;
  }
  canInsertTextAfter() {
    return false;
  }
}

export type ComposerHandle = {
  focus: () => void;
  replaceRange: (start: number, end: number, text: string) => void;
};

export default function ComposerInput(props: {
  value: string;
  context: string;
  placeholder: string;
  controls?: string;
  activeDescendant?: string;
  ref: (handle: ComposerHandle) => void;
  onChange: (text: string) => void;
  onCursor: (position: number) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onPasteFiles: (files: FileList) => void;
}) {
  let element!: HTMLDivElement;
  const editor = createEditor({
    namespace: "AruraComposer",
    nodes: [ReferenceNode],
    onError: (error) => {
      throw error;
    },
  });
  let lastValue = "";
  let lastContext: string | undefined;

  const replace = (value: string) => {
    const root = $getRoot();
    root.clear();
    const paragraph = $createParagraphNode();
    value.split("\n").forEach((line, index) => {
      if (index) paragraph.append($createLineBreakNode());
      if (line) paragraph.append($createTextNode(line));
    });
    root.append(paragraph);
  };
  const select = (position: number) => {
    let remaining = position;
    const paragraph = $getRoot().getFirstChild();
    for (
      const node of $isElementNode(paragraph) ? paragraph.getChildren() : []
    ) {
      const length = node.getTextContentSize();
      if ($isTextNode(node) && remaining <= length) {
        node.select(remaining, remaining);
        return;
      }
      remaining -= length;
    }
    $getRoot().selectEnd();
  };

  onMount(() => {
    editor.setRootElement(element);
    const disposers = [
      registerPlainText(editor),
      registerHistory(editor, createEmptyHistoryState(), 300),
      editor.registerNodeTransform(TextNode, (node) => {
        if (!node.isSimpleText() || editor.isComposing()) return;
        // Complete reference syntax only; a partially typed slash stays editable
        // so the existing upstream autocomplete remains in charge of suggestions.
        const match =
          /\[(?:Attached file|Conversation): [^\]\n]+\]|(?:^|(?<=\s))\/[\w-]+(?=\s)/
            .exec(
              node.getTextContent(),
            );
        if (!match) return;
        const start = match.index;
        const pieces = node.splitText(start, start + match[0].length);
        const target = pieces[start === 0 ? 0 : 1];
        target.replace(new ReferenceNode(match[0]).setMode("token"));
      }),
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          props.onKeyDown(event);
          return event.defaultPrevented;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (
            event instanceof ClipboardEvent &&
            event.clipboardData?.files.length
          ) {
            event.preventDefault();
            props.onPasteFiles(event.clipboardData.files);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const value = $getRoot().getTextContent();
          if (value !== lastValue) {
            lastValue = value;
            props.onChange(value);
          }
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            const prefix = selection.clone();
            prefix.anchor.set("root", 0, "element");
            props.onCursor(prefix.getTextContent().length);
          }
        });
      }),
    ];
    props.ref({
      focus: () => editor.focus(),
      replaceRange: (start, end, text) =>
        editor.update(
          () => {
            const value = $getRoot().getTextContent();
            replace(value.slice(0, start) + text + value.slice(end));
            select(start + text.length);
          },
          { tag: HISTORY_PUSH_TAG },
        ),
    });
    onCleanup(() => {
      for (const dispose of disposers) dispose();
      editor.setRootElement(null);
    });
  });

  createEffect(() => {
    const value = props.value;
    const context = props.context;
    untrack(() => {
      const changedContext = context !== lastContext;
      lastContext = context;
      if (value !== lastValue || changedContext) {
        lastValue = value;
        editor.update(() => replace(value), {
          discrete: true,
          tag: [SKIP_DOM_SELECTION_TAG, HISTORY_PUSH_TAG],
        });
        // Never undo into another conversation, a sent message, or an edit target.
        if (changedContext || value === "") {
          editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
        }
      }
    });
  });

  return (
    <div class="composer-input-wrap">
      {/* biome-ignore lint/a11y/useSemanticElements: Lexical requires a contenteditable root to render inline reference nodes. */}
      <div
        ref={element}
        class="composer-input"
        contentEditable
        role="textbox"
        tabIndex={0}
        aria-label="Message Hermes"
        aria-multiline="true"
        aria-controls={props.controls}
        aria-activedescendant={props.activeDescendant}
        aria-placeholder={props.placeholder}
        spellcheck
      />
      {!props.value && (
        <span class="composer-placeholder" aria-hidden="true">
          {props.placeholder}
        </span>
      )}
    </div>
  );
}
