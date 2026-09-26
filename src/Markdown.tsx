import { fileReferences } from "../shared/artifacts.ts";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { createMemo, Show } from "solid-js";
import { Icon } from "./ui.tsx";

DOMPurify.addHook("beforeSanitizeAttributes", (node) => {
  if (node.nodeName !== "A") return;
  const element = node as Element;
  const href = element.getAttribute("href");
  if (!href || /^https?:/i.test(href)) return;
  const file = fileReferences([
    { role: "assistant", content: `[file](<${href}>)` },
  ])[0];
  if (file) {
    element.setAttribute(
      "href",
      `/api/download?path=${encodeURIComponent(file.path)}`,
    );
  }
});
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function splitSourcesSection(text: string) {
  const tokens = marked.lexer(text);
  const last = tokens.findLastIndex((token) => token.type !== "space");
  const inline = tokens[last];
  if (inline?.type === "paragraph") {
    const match = inline.raw
      .trim()
      .match(/^(?:\*\*|__)?Sources:?(?:\*\*|__)?\s+(.+)$/is);
    if (match && /https?:\/\/|\[[0-9]+\]/i.test(match[1])) {
      return {
        answer: tokens
          .slice(0, last)
          .map((token) => token.raw)
          .join("")
          .trimEnd(),
        sources: match[1].trim(),
      };
    }
  }
  const index = tokens.findLastIndex(
    (token) =>
      (token.type === "paragraph" || token.type === "heading") &&
      /^(?:\*\*|__)?Sources:?(?:\*\*|__)?$/i.test(token.text.trim()),
  );
  if (index < 0) return;
  const tail = tokens.slice(index + 1);
  if (
    !tail.some((token) => token.type === "list") ||
    tail.some((token) => token.type !== "list" && token.type !== "space")
  ) {
    return;
  }
  return {
    answer: tokens
      .slice(0, index)
      .map((token) => token.raw)
      .join("")
      .trimEnd(),
    sources: tail
      .map((token) => token.raw)
      .join("")
      .trim(),
  };
}

export function Markdown(props: { text: string }) {
  const html = () =>
    DOMPurify.sanitize(marked.parse(props.text, { async: false }) as string, {
      FORBID_TAGS: ["img", "iframe", "video", "audio", "object", "embed"],
      FORBID_ATTR: ["style"],
    });
  return <div class="markdown" innerHTML={html()} />;
}

export function AnswerMarkdown(props: { text: string }) {
  const section = createMemo(() => splitSourcesSection(props.text));
  return (
    <Show when={section()} fallback={<Markdown text={props.text} />}>
      {(parts) => (
        <>
          <Show when={parts().answer}>
            <Markdown text={parts().answer} />
          </Show>
          <details class="sources-disclosure">
            <summary>
              Sources <Icon name="nav-arrow-down" />
            </summary>
            <Markdown text={parts().sources} />
          </details>
        </>
      )}
    </Show>
  );
}
