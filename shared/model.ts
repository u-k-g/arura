export type Section = "essential" | "pinned" | "recent" | "archived";
export interface Conversation {
  key: string;
  profile: string;
  bot?: boolean;
  sourceId: string;
  title: string;
  activityAt: number;
  section: Section;
  folderId?: string;
  rank: number;
  archivedAt?: number;
  unarchivedAt?: number;
  running: boolean;
  pendingInput: boolean;
  deleted?: boolean;
}
export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  tool?: string;
  details?: unknown;
  createdAt?: number;
}
export function groupMessages(messages: Message[]) {
  const groups: { prompt?: Message; answer?: Message; work: Message[] }[] = [];
  let group: (typeof groups)[number] | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      group = { prompt: message, work: [] };
      groups.push(group);
    } else {
      if (!group) {
        group = { work: [] };
        groups.push(group);
      }
      group.work.push(message);
    }
  }
  for (const group of groups) {
    if (group.work.at(-1)?.role === "assistant")
      group.answer = group.work.pop();
  }
  return groups;
}
export interface Activity {
  id: string;
  label: string;
  state: "running" | "complete" | "error";
  details?: unknown;
}
export interface Interaction {
  id: string;
  kind: "approval" | "clarify" | "secret";
  text: string;
  options?: string[];
}
export interface Turn {
  recovering?: boolean;
  conversation: string;
  text: string;
  activity: Activity[];
  startedAt: number;
  finishedAt?: number;
  state: "running" | "complete" | "error" | "interrupted";
  error?: string;
  interactions: Interaction[];
}
export const conversationKey = (profile: string, id: string) =>
  JSON.stringify([profile || "default", id]);
export function shouldArchive(
  c: Conversation,
  days: number,
  now: number,
): boolean {
  return (
    c.section === "recent" &&
    !c.folderId &&
    !c.running &&
    !c.pendingInput &&
    now - Math.max(c.activityAt, c.unarchivedAt ?? 0) >= days * 86_400_000
  );
}
export function plainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .filter((x) => x?.type === "text")
      .map((x) => x.text ?? "")
      .join("\n");
  return "";
}
// Reasoning is removed before projection, not merely hidden by the renderer.
export function visibleText(value: unknown): string {
  return plainText(value)
    .replace(/<(think|thinking|reasoning)>[\s\S]*?(?:<\/\1>|$)/gi, "")
    .replace(/<[^>]*$/, "")
    .trim();
}
export function withoutReasoning(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(withoutReasoning).filter((item) => item !== null);
  if (value && typeof value === "object") {
    const event = value as Record<string, unknown>;
    if (/reasoning|thinking/i.test(String(event.type ?? event.event ?? "")))
      return null;
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/^(reasoning|thinking)(?:_text|_content|_delta)?$/i.test(key),
        )
        .map(([key, item]) => [key, withoutReasoning(item)]),
    );
  }
  return typeof value === "string" ? visibleText(value) : value;
}
export function subagentTranscript(text: string, details = false): string {
  return text
    .split("\n")
    .flatMap((line) => {
      const match = line.match(
        /^(\d{2}:\d{2}:\d{2}) (user|assistant|tool|result|final)\s*\| (.*)$/,
      );
      if (!match) return [];
      const [, time, role, body] = match;
      const content =
        !details && role === "tool"
          ? body.split("(")[0]
          : !details && role === "result"
            ? body.split(":")[0]
            : visibleText(body);
      return [`${time} ${role} | ${content}`];
    })
    .join("\n");
}
export function normalizeMessages(rows: Record<string, unknown>[]): Message[] {
  return rows.flatMap((row, index) => {
    if (
      row.display_kind === "hidden" ||
      !["user", "assistant", "tool"].includes(String(row.role))
    )
      return [];
    const text = visibleText(row.display_content ?? row.content ?? row.text);
    if (!text && row.role !== "tool") return [];
    return [
      {
        id: String(row.id ?? row.row_id ?? row.message_id ?? `row-${index}`),
        role: row.role as Message["role"],
        text,
        ...(typeof row.timestamp === "number"
          ? { createdAt: row.timestamp * 1000 }
          : {}),
        ...(row.role === "tool"
          ? { tool: String(row.name ?? row.tool_name ?? "Tool") }
          : {}),
      },
    ];
  });
}
export function elapsed(start: number, end = Date.now()): string {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
