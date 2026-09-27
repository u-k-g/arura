import { marked } from "marked";

export function splitSourcesSection(text: string) {
  const tokens = marked.lexer(text);
  const sourceNote = (token: (typeof tokens)[number]) =>
    token.type === "paragraph" &&
    /^Sources\s+\[[0-9]+\]/i.test(token.text.trim());

  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    if (token.type !== "paragraph" && token.type !== "heading") continue;

    const tail = tokens.slice(index + 1);
    const inline = token.type === "paragraph"
      ? token.raw.trim().match(/^(?:\*\*|__)?Sources:(?:\*\*|__)?\s+(.+)$/is)
      : null;
    if (
      inline && /https?:\/\/|\[[0-9]+\]/i.test(inline[1]) &&
      tail.every((part) => part.type === "space" || sourceNote(part))
    ) {
      return {
        answer: tokens.slice(0, index).map((part) => part.raw).join("")
          .trimEnd(),
        sources: [inline[1].trim(), ...tail.map((part) => part.raw)]
          .join("").trim(),
      };
    }

    if (!/^(?:\*\*|__)?Sources:?(?:\*\*|__)?$/i.test(token.text.trim())) {
      continue;
    }
    if (
      !tail.some((part) => part.type === "list") ||
      tail.some((part) => part.type !== "list" && part.type !== "space")
    ) {
      continue;
    }
    return {
      answer: tokens.slice(0, index).map((part) => part.raw).join("")
        .trimEnd(),
      sources: tail.map((part) => part.raw).join("").trim(),
    };
  }
}

export function sourceLinks(sources: string) {
  const links = new Map<string, string>();
  for (const line of sources.split("\n")) {
    const match = line.match(
      /^\s*(?:[-*+]\s*)?(?:\[([1-9]\d*)\]|([1-9]\d*)\.)\s+(?:\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/\S+))/i,
    );
    if (!match) continue;
    const url = (match[3] ?? match[4]).replace(/[.,;:]+$/, "");
    try {
      const parsed = new globalThis.URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        links.set(match[1] ?? match[2], parsed.href);
      }
    } catch {
      // Leave malformed references as plain text.
    }
  }
  return links;
}
