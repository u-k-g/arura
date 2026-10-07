import { marked } from "marked";

export function splitSourcesSection(text: string) {
  const tokens = marked.lexer(text);
  const raw = (parts: Array<(typeof tokens)[number]>) =>
    parts
      .map((part) => part.raw)
      .join("")
      .trim();
  const sourceNote = (token: (typeof tokens)[number]) =>
    token.type === "paragraph" &&
    /^Sources\s+\[[0-9]+\]/i.test(token.text.trim());
  const sourceList = (token: (typeof tokens)[number]) =>
    token.type === "list" && /https?:\/\/|\[[1-9]\d*\]/i.test(token.raw);
  const citationLine =
    /^\s*(?:[-*+]\s*)?(?:\[[1-9]\d*\]|[1-9]\d*\.)\s+(?:https?:\/\/|\[[^\]]+\]\(https?:\/\/)/i;
  const sourceCitation = (token: (typeof tokens)[number]) => {
    if (token.type !== "paragraph") return false;
    const lines = token.raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length > 0 && lines.every((line) => citationLine.test(line));
  };
  const sourceEnd = (start: number) => {
    let end = start;
    while (
      end < tokens.length &&
      (tokens[end].type === "space" ||
        sourceNote(tokens[end]) ||
        sourceList(tokens[end]) ||
        sourceCitation(tokens[end]))
    ) {
      end++;
    }
    return end;
  };

  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    if (token.type !== "paragraph" && token.type !== "heading") continue;

    const inline = token.type === "paragraph"
      ? token.raw.trim().match(/^(?:\*\*|__)?Sources:(?:\*\*|__)?\s+(.+)$/is)
      : null;
    if (inline && /https?:\/\/|\[[0-9]+\]/i.test(inline[1])) {
      let end = index + 1;
      while (
        end < tokens.length &&
        (tokens[end].type === "space" || sourceNote(tokens[end]))
      ) {
        end++;
      }
      const after = raw(tokens.slice(end));
      return {
        answer: raw(tokens.slice(0, index)),
        sources: [
          inline[1].trim(),
          ...tokens.slice(index + 1, end).map((part) => part.raw),
        ]
          .join("")
          .trim(),
        ...(after ? { after } : {}),
      };
    }

    if (!/^(?:\*\*|__)?Sources:?(?:\*\*|__)?$/i.test(token.text.trim())) {
      continue;
    }
    let first = index + 1;
    while (tokens[first]?.type === "space") first++;
    if (
      !tokens[first] ||
      !(sourceList(tokens[first]) || sourceCitation(tokens[first]))
    ) {
      continue;
    }
    const end = sourceEnd(first);
    const after = raw(tokens.slice(end));
    return {
      answer: raw(tokens.slice(0, index)),
      sources: raw(tokens.slice(first, end)),
      ...(after ? { after } : {}),
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
