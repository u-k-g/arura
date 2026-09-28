import { fileReferences } from "../shared/artifacts.ts";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import { createMemo, createResource, For, Show } from "solid-js";
import { Icon } from "./ui.tsx";
import { sourceLinks, splitSourcesSection } from "./sources.ts";
import "katex/dist/katex.min.css";

const mathMarkdown = new Marked(
  markedKatex({ output: "mathml", throwOnError: false }),
);

export function splitPreviews(text: string) {
  const parts: { text?: string; file?: string }[] = [];
  const directive = /^::preview\{file="([^"\n]+\.html?)"\}[ \t]*$/gm;
  let offset = 0;
  for (const match of text.matchAll(directive)) {
    if (match.index > offset) {
      parts.push({ text: text.slice(offset, match.index) });
    }
    parts.push({ file: match[1] });
    offset = match.index + match[0].length;
  }
  if (offset < text.length || !parts.length) {
    parts.push({ text: text.slice(offset) });
  }
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

function linkCitations(html: string, references: ReadonlyMap<string, string>) {
  if (!references.size) return html;
  const template = globalThis.document.createElement("template");
  template.innerHTML = html;
  const walker = globalThis.document.createTreeWalker(
    template.content,
    globalThis.NodeFilter.SHOW_TEXT,
  );
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("a, code, pre, sup, kbd, math")) continue;
    nodes.push(node as Text);
  }
  for (const node of nodes) {
    const matches = [...node.data.matchAll(/\[([1-9]\d*)\]/g)].filter(
      (match) => references.has(match[1]),
    );
    if (!matches.length) continue;
    const fragment = globalThis.document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const index = match.index ?? 0;
      fragment.append(
        globalThis.document.createTextNode(node.data.slice(offset, index)),
      );
      const superscript = globalThis.document.createElement("sup");
      superscript.className = "source-citation";
      const link = globalThis.document.createElement("a");
      link.href = references.get(match[1]) ?? "";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", `Source ${match[1]}`);
      link.textContent = match[0];
      superscript.append(link);
      fragment.append(superscript);
      offset = index + match[0].length;
    }
    fragment.append(
      globalThis.document.createTextNode(node.data.slice(offset)),
    );
    node.replaceWith(fragment);
  }
  return template.innerHTML;
}

export function Markdown(props: {
  text: string;
  references?: ReadonlyMap<string, string>;
}) {
  const html = () =>
    linkCitations(
      DOMPurify.sanitize(
        mathMarkdown.parse(props.text, { async: false }) as string,
        {
          FORBID_TAGS: ["img", "iframe", "video", "audio", "object", "embed"],
          FORBID_ATTR: ["style"],
        },
      ),
      props.references ?? new Map(),
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

function AnswerContent(props: {
  text: string;
  references?: ReadonlyMap<string, string>;
}) {
  return (
    <For each={splitPreviews(props.text)}>
      {(part) =>
        part.file
          ? <InlinePreview file={part.file} />
          : (
            <Show when={part.text?.trim()}>
              <Markdown text={part.text ?? ""} references={props.references} />
            </Show>
          )}
    </For>
  );
}

export function AnswerMarkdown(props: {
  text: string;
  previousReferences?: ReadonlyMap<string, string>;
}) {
  const section = createMemo(() => splitSourcesSection(props.text));
  const references = createMemo(() => {
    const current = section();
    if (!current) return;
    return new Map([
      ...(props.previousReferences ?? []),
      ...sourceLinks(current.sources),
    ]);
  });
  return (
    <Show
      when={section()}
      fallback={<AnswerContent text={props.text} />}
    >
      {(parts) => (
        <>
          <Show when={parts().answer}>
            <AnswerContent text={parts().answer} references={references()} />
          </Show>
          <details class="sources-disclosure">
            <summary>
              Sources <Icon name="nav-arrow-down" />
            </summary>
            <Markdown text={parts().sources} />
          </details>
          <Show when={parts().after}>
            {(after) => (
              <AnswerContent text={after()} references={references()} />
            )}
          </Show>
        </>
      )}
    </Show>
  );
}
