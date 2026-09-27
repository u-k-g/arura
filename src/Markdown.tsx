import { fileReferences } from "../shared/artifacts.ts";
import DOMPurify from "dompurify";
import { Marked, marked } from "marked";
import markedKatex from "marked-katex-extension";
import { createMemo, createResource, For, Show } from "solid-js";
import { Icon } from "./ui.tsx";
import "katex/dist/katex.min.css";

const mathMarkdown = new Marked(
  markedKatex({ output: "mathml", throwOnError: false, nonStandard: true }),
);

export function splitPreviews(text: string) {
  const parts: { text?: string; file?: string }[] = [];
  const directive = /^::preview\{file="([^"\n]+\.html?)"\}[ \t]*$/gm;
  let offset = 0;
  for (const match of text.matchAll(directive)) {
    if (match.index > offset)
      parts.push({ text: text.slice(offset, match.index) });
    parts.push({ file: match[1] });
    offset = match.index + match[0].length;
  }
  if (offset < text.length || !parts.length)
    parts.push({ text: text.slice(offset) });
  return parts;
}

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
    DOMPurify.sanitize(
      mathMarkdown.parse(props.text, { async: false }) as string,
      {
        FORBID_TAGS: ["img", "iframe", "video", "audio", "object", "embed"],
        FORBID_ATTR: ["style"],
      },
    );
  return <div class="markdown" innerHTML={html()} />;
}

function previewDocument(source: string) {
  const document = new globalThis.DOMParser().parseFromString(
    source,
    "text/html",
  );
  const csp = document.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  document.head.prepend(csp);
  const theme = globalThis.getComputedStyle(
    globalThis.document.documentElement,
  );
  const style = document.createElement("style");
  style.textContent = `:root {
    --foreground: ${theme.getPropertyValue("--ink")};
    --muted-foreground: ${theme.getPropertyValue("--muted")};
    --accent: ${theme.getPropertyValue("--accent")};
    --border: ${theme.getPropertyValue("--line")};
    --card: ${theme.getPropertyValue("--panel")};
    color: var(--foreground);
    font-family: ${theme.fontFamily};
  }
  body { margin: 0; background: transparent; }`;
  document.head.append(style);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}

function InlinePreview(props: { file: string }) {
  const name = () => props.file.split("/").at(-1) ?? "Preview";
  const [source] = createResource(
    () => props.file,
    async (file) => {
      const response = await globalThis.fetch(
        `/api/download?path=${encodeURIComponent(file)}`,
      );
      if (!response.ok) throw new Error("Preview file is unavailable.");
      const html = await response.text();
      if (!html.trim() || html.length > 1_000_000) {
        throw new Error("Preview file is unavailable or too large.");
      }
      return previewDocument(html);
    },
  );
  return (
    <div class="inline-preview">
      <div class="inline-preview-heading">
        <span>Preview · {name()}</span>
        <a
          href={`/api/download?path=${encodeURIComponent(props.file)}`}
          download={name()}
        >
          Download HTML
        </a>
      </div>
      <Show when={!source.loading} fallback={<p>Loading preview…</p>}>
        <Show
          when={!source.error && source()}
          fallback={<p role="status">Preview file is unavailable.</p>}
        >
          {(html) => (
            <iframe
              title={`Preview ${name()}`}
              sandbox="allow-scripts"
              referrerpolicy="no-referrer"
              srcdoc={html()}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}

function AnswerContent(props: { text: string }) {
  return (
    <For each={splitPreviews(props.text)}>
      {(part) =>
        part.file ? (
          <InlinePreview file={part.file} />
        ) : (
          <Show when={part.text?.trim()}>
            <Markdown text={part.text ?? ""} />
          </Show>
        )
      }
    </For>
  );
}

export function AnswerMarkdown(props: { text: string }) {
  const section = createMemo(() => splitSourcesSection(props.text));
  return (
    <Show when={section()} fallback={<AnswerContent text={props.text} />}>
      {(parts) => (
        <>
          <Show when={parts().answer}>
            <AnswerContent text={parts().answer} />
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
