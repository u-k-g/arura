import { plainText, visibleText, withoutReasoning } from "./model.ts";

export type FileReference = { path: string; name: string; messageId: string };
export function fileReferences(
  messages: Record<string, unknown>[],
): FileReference[] {
  const found = new Map<string, FileReference>();
  for (const message of messages) {
    if (
      message.display_kind === "hidden" ||
      !["assistant", "tool"].includes(String(message.role))
    ) {
      continue;
    }
    const add = (raw: string) => {
      let path = raw.trim().replace(/^<|>$/g, "");
      if (path.startsWith("file://")) {
        try {
          const url = new URL(path);
          if (url.hostname && url.hostname !== "localhost") return;
          path = decodeURIComponent(url.pathname);
        } catch {
          return;
        }
      }
      if (
        !/^(?:\/[^/]|~\/|\.\.?\/|[a-zA-Z]:[\\/])/.test(path) ||
        /[\r\n\0]/.test(path) ||
        path.length > 4096
      ) {
        return;
      }
      const name = path.split(/[\\/]/).at(-1) ?? "";
      if (!/\.[a-zA-Z0-9]{1,12}$/.test(name)) return;
      found.set(path, {
        path,
        name,
        messageId: String(
          message.row_id ?? message.id ?? message.message_id ?? "",
        ),
      });
    };
    const text = visibleText(
      message.display_content ?? message.content ?? message.text,
    );
    if (message.role === "assistant") {
      for (const match of text.matchAll(
        /!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g,
      )) {
        add(match[1]);
      }
      for (const match of text.matchAll(/`((?:\/|~\/|\.\.?\/)[^`\n]+)`/g)) {
        add(match[1]);
      }
      for (const match of text.matchAll(/(?:^|\n)MEDIA:\s*(.+)/g)) {
        add(match[1]);
      }
    } else {
      let payload = message.content;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(
            plainText(payload).replace(
              /^<untrusted_tool_result[^>]*>\s*|\s*<\/untrusted_tool_result>$/g,
              "",
            ),
          );
        } catch {
          payload = undefined;
        }
      }
      const producer =
        /(?:^|_)(?:write|save|create|download|export|render|generate)(?:_|$)/i.test(
          String(message.tool_name ?? message.name ?? ""),
        );
      const visit = (value: unknown, key = "", depth = 0) => {
        if (depth > 12) return;
        if (
          typeof value === "string" &&
          (/(?:^|\.)(?:output|artifact|attachment|download|image_path|audio_path)(?:s|_path|_file)?(?:\.|$)/i.test(
            key,
          ) ||
            (producer && /(?:^|\.)(?:paths?|files?|filename)$/i.test(key)))
        ) {
          add(value);
        } else if (Array.isArray(value)) {
          for (const item of value) visit(item, key, depth + 1);
        } else if (value && typeof value === "object") {
          for (const [name, item] of Object.entries(value)) {
            visit(item, key ? `${key}.${name}` : name, depth + 1);
          }
        }
      };
      visit(withoutReasoning(payload));
    }
  }
  return [...found.values()];
}
