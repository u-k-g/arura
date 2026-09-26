import { record } from "./contracts.ts";
export type Section = "essential" | "pinned" | "recent" | "archived";
export interface Conversation {
  key: string;
  profile: string;
  bot?: boolean;
  essentialIcon?: string;
  sourceId: string;
  source?: string;
  backgroundSession?: boolean;
  cronSidebar?: boolean;
  title: string;
  activityAt: number;
  messageActivityAt?: number;
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
  role: "user" | "assistant" | "tool" | "event";
  attachments?: { url: string; name: string; image: boolean }[];
  text: string;
  tool?: string;
  toolCallId?: string;
  details?: unknown;
  createdAt?: number;
  // Compaction-archived row: displayed for context but no longer in the
  // active transcript, so Hermes can never target it for an edit or branch.
  compacted?: boolean;
}
export function groupMessages(messages: Message[]) {
  const groups: {
    prompt?: Message;
    answer?: Message;
    event?: Message;
    work: Message[];
  }[] = [];
  let group: (typeof groups)[number] | undefined;
  for (const message of messages) {
    // Older synchronized history may still contain this presentation-only event.
    if (message.role === "event" && message.text === "Model changed") continue;
    if (message.role === "event") {
      groups.push({ event: message, work: [] });
      group = undefined;
    } else if (message.role === "user") {
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
    const answer = group.work.findLastIndex(
      (message) => message.role === "assistant",
    );
    if (answer >= 0) group.answer = group.work.splice(answer, 1)[0];
  }
  return groups;
}
export function workGroup(
  groups: ReturnType<typeof groupMessages>,
  turn: Pick<Turn, "text" | "startedAt"> & Partial<Pick<Turn, "state">>,
) {
  const text = turn.text.replace(/\s+/g, "");
  const answer =
    text &&
    groups.findLast(
      (group) =>
        group.answer?.text.replace(/\s+/g, "").startsWith(text) &&
        (group.answer.createdAt === undefined ||
          group.answer.createdAt >= turn.startedAt),
    );
  if (answer) return answer;
  // A completed reply absent from history may follow several unsynced prompts.
  // Keep it separate until its matching answer arrives in the saved transcript.
  if (turn.state && turn.state !== "running") return undefined;
  return (
    groups.findLast(
      (group) =>
        group.prompt?.createdAt !== undefined &&
        group.prompt.createdAt <= turn.startedAt &&
        (!group.answer || (group.answer.createdAt ?? 0) >= turn.startedAt),
    ) ??
    groups.findLast(
      (group) =>
        group.prompt && !group.answer && group.prompt.createdAt === undefined,
    )
  );
}
// A tool call and its result can fall on opposite history-page boundaries.
export function mergeHistoryMessages(messages: Message[]): Message[] {
  const merged: Message[] = [];
  const calls = new Map<string, number>();
  for (const message of messages) {
    const index = message.toolCallId
      ? calls.get(message.toolCallId)
      : undefined;
    if (index !== undefined) {
      const previous = merged[index];
      merged[index] = {
        ...previous,
        text: message.text,
        tool: previous.tool === "Tool" ? message.tool : previous.tool,
        details: { ...record(previous.details), ...record(message.details) },
      };
    } else {
      if (message.toolCallId) calls.set(message.toolCallId, merged.length);
      merged.push(message);
    }
  }
  return merged;
}
export interface Activity {
  id: string;
  label: string;
  state: "running" | "complete" | "error";
  details?: unknown;
}
export interface TurnMilestone {
  at: number;
  label: string;
}
export interface TurnStats {
  firstOutputAt?: number;
  outputTokens?: number;
  tokensPerSecond?: number;
  milestones: TurnMilestone[];
  answerId?: string;
}
export interface Interaction {
  id: string;
  kind: "approval" | "clarify" | "secret";
  text: string;
  options?: string[];
  multiple?: boolean;
  questions?: ClarificationQuestion[];
}
export interface ClarificationQuestion {
  id: string;
  text: string;
  options: string[];
  multiple: boolean;
  answer?: string;
}
export function interactionFromEvent(
  type: string,
  payload: Record<string, unknown>,
): Interaction {
  const choices = (value: unknown) =>
    Array.isArray(value)
      ? value.map((choice) => visibleText(String(choice)))
      : [];
  return {
    id: String(payload.request_id ?? payload.id ?? type),
    kind: type.split(".")[0] as Interaction["kind"],
    text: visibleText(
      payload.question ??
        payload.description ??
        payload.prompt ??
        payload.command ??
        (Array.isArray(payload.questions)
          ? "Hermes has a few questions"
          : "Hermes needs your input"),
    ),
    options: choices(payload.choices ?? payload.options),
    multiple: payload.multi_select === true,
    ...(Array.isArray(payload.questions)
      ? {
          questions: payload.questions
            .filter(
              (q) =>
                q &&
                typeof q.qid === "string" &&
                typeof q.question === "string",
            )
            .map((q) => ({
              id: q.qid,
              text: visibleText(q.question),
              options: choices(q.choices),
              multiple: q.multi_select === true,
              ...(record(payload.answers)[q.qid] !== undefined
                ? {
                    answer: visibleText(
                      Array.isArray(record(payload.answers)[q.qid])
                        ? JSON.stringify(record(payload.answers)[q.qid])
                        : String(record(payload.answers)[q.qid]),
                    ),
                  }
                : {}),
            })),
        }
      : {}),
  };
}
export interface Turn {
  recovering?: boolean;
  conversation: string;
  text: string;
  activity: Activity[];
  stats?: TurnStats;
  startedAt: number;
  finishedAt?: number;
  state: "running" | "complete" | "error" | "interrupted";
  error?: string;
  interactions: Interaction[];
}
export const conversationKey = (profile: string, id: string) =>
  JSON.stringify([profile || "default", id]);
export function conversationActivity(
  c: Pick<Conversation, "activityAt" | "messageActivityAt">,
): number {
  return c.messageActivityAt ?? c.activityAt;
}
export function conversationArchiveActivity(
  c: Pick<Conversation, "activityAt" | "messageActivityAt" | "unarchivedAt">,
): number {
  return Math.max(conversationActivity(c), c.unarchivedAt ?? 0);
}
export function conversationReadActivity(
  c: Pick<Conversation, "activityAt" | "messageActivityAt">,
): number {
  return Math.max(c.activityAt, c.messageActivityAt ?? 0);
}
export function scheduledRunIdentity(source: string, rootId: string) {
  if (source.trim().toLowerCase() !== "cron") return undefined;
  const match = /^cron_(.+)_(\d{8})_(\d{6})$/.exec(rootId);
  return match
    ? { jobId: match[1], runStamp: `${match[2]}${match[3]}` }
    : undefined;
}
export function shouldArchive(
  c: Conversation,
  days: number,
  now: number,
): boolean {
  return (
    c.section === "recent" &&
    !c.bot &&
    c.source !== "cron" &&
    !c.folderId &&
    !c.running &&
    !c.pendingInput &&
    now - conversationArchiveActivity(c) >= days * 86_400_000
  );
}
export function archiveAgeStatus(
  c: Conversation,
  days: number,
  now: number,
  enabled = true,
): "warning" | "overdue" | undefined {
  if (!enabled || !Number.isFinite(days) || days < 1) return undefined;
  if (shouldArchive(c, days, now)) return "overdue";
  if (shouldArchive(c, Math.max(0, days - 1), now)) return "warning";
  return undefined;
}
export function plainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .filter((x) => x?.type === "text")
      .map((x) => x.text ?? "")
      .join("\n");
  }
  return "";
}
// Reasoning is removed before projection, not merely hidden by the renderer.
export function visibleText(value: unknown): string {
  return plainText(value)
    .replace(/<(think|thinking|reasoning)>[\s\S]*?(?:<\/\1>|$)/gi, "")
    .replace(/<[^>]*$/, "")
    .trim();
}
// Display protocol reference: NousResearch/hermes-agent, desktop
// src/lib/chat-messages/hydration.ts and shared/src/skill-scaffold.ts.
// Keep model-facing context in Hermes, not in the user's message bubble.
export function userMessageText(value: unknown): string {
  const text = visibleText(value);
  const skill = text.match(/^\[IMPORTANT: The user has invoked the "([^"]+)"/);
  if (skill) {
    const bundle = text.includes(" skill bundle,");
    const instructionMarker = bundle
      ? "\nUser instruction: "
      : "The user has provided the following instruction alongside the skill invocation: ";
    const start = bundle
      ? text.indexOf(instructionMarker)
      : text.lastIndexOf(instructionMarker);
    const instruction =
      start < 0
        ? ""
        : text
            .slice(start + instructionMarker.length)
            .split(
              bundle ? "\n\n[Loaded as part of the " : "\n\n[Runtime note:",
            )[0]
            .trim()
            .replace(/\s+/g, " ");
    const name = skill[1].trim();
    if (name) {
      return `${name.startsWith("/") ? name : `/${name}`}${
        instruction ? ` ${instruction}` : ""
      }`;
    }
  }
  const marker = /(?:^|\n)--- Attached Context ---\s*\n/.exec(text);
  const prompt = (marker ? text.slice(0, marker.index) : text)
    .replace(/(?:^|\n)--- Context Warnings ---[\s\S]*$/, "")
    .trim();
  if (!marker) return prompt;
  const context = text.slice(marker.index + marker[0].length);
  const references = [
    ...new Set(
      Array.from(
        context.matchAll(
          /@(file|folder|url|image|tool|terminal):(?:"[^"\n]+"|'[^'\n]+'|`[^`\n]+`|\S+)/g,
        ),
        (match) => match[0],
      ),
    ),
  ];
  return [references.filter((ref) => !prompt.includes(ref)).join("\n"), prompt]
    .filter(Boolean)
    .join("\n\n");
}
export function withoutReasoning(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutReasoning).filter((item) => item !== null);
  }
  if (value && typeof value === "object") {
    const event = value as Record<string, unknown>;
    if (/reasoning|thinking/i.test(String(event.type ?? event.event ?? ""))) {
      return null;
    }
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
  const results = new Map(
    rows
      .filter((row) => row.role === "tool" && row.tool_call_id)
      .map((row) => [String(row.tool_call_id), row]),
  );
  const calls = new Set(
    rows.flatMap((row) =>
      Array.isArray(row.tool_calls)
        ? row.tool_calls.map((call) => String(record(call).id))
        : [],
    ),
  );
  return rows.flatMap((row, index): Message[] => {
    if (
      row.display_kind === "hidden" ||
      row.display_kind === "model_switch" ||
      !["user", "assistant", "tool"].includes(String(row.role))
    ) {
      return [];
    }
    if (row.role === "tool" && calls.has(String(row.tool_call_id))) return [];
    const content = row.display_content ?? row.content ?? row.text;
    const text =
      row.role === "user" ? userMessageText(content) : visibleText(content);
    const id = String(row.id ?? row.row_id ?? row.message_id ?? `row-${index}`);
    const createdAt =
      typeof row.timestamp === "number" ? row.timestamp * 1000 : undefined;
    const eventLabels: Record<string, string> = {
      auto_continue: "Resumed interrupted turn",
      personality_switch: "Personality changed",
      async_delegation_complete: "Background agent work finished",
    };
    const event = eventLabels[String(row.display_kind)];
    if (event) {
      return [
        { id, role: "event", text: event, ...(createdAt ? { createdAt } : {}) },
      ];
    }
    const attachments: NonNullable<Message["attachments"]> = [];
    if (Array.isArray(content)) {
      for (const block of content) {
        const item = record(block);
        if (item.type !== "image_url") continue;
        const url =
          typeof item.image_url === "string"
            ? item.image_url
            : record(item.image_url).url;
        if (
          typeof url === "string" &&
          /^(https?:|file:|data:image\/(?:png|jpeg|webp|gif);|\/)/i.test(url)
        ) {
          attachments.push({
            url,
            name: url.startsWith("data:")
              ? "Attached image"
              : url.split("/").at(-1)?.split("?")[0] || "Attached image",
            image: true,
          });
        }
      }
    }
    const messages: Message[] =
      text || attachments.length || row.role === "tool"
        ? [
            {
              id,
              role: row.role as Message["role"],
              text,
              ...(attachments.length ? { attachments } : {}),
              ...(createdAt ? { createdAt } : {}),
              ...(row.compacted ? { compacted: true } : {}),
              ...(row.role === "tool"
                ? {
                    tool: String(row.name ?? row.tool_name ?? "Tool"),
                    ...(row.tool_call_id
                      ? { toolCallId: String(row.tool_call_id) }
                      : {}),
                    details: { output: withoutReasoning(content) },
                  }
                : {}),
            },
          ]
        : [];
    if (Array.isArray(row.tool_calls)) {
      for (const raw of row.tool_calls) {
        const call = record(raw),
          fn = record(call.function),
          result = results.get(String(call.id));
        messages.push({
          id: `${id}:tool:${call.id}`,
          ...(call.id ? { toolCallId: String(call.id) } : {}),
          role: "tool",
          tool: String(fn.name ?? call.name ?? "Tool"),
          text: result ? visibleText(result.content) : "Tool call",
          details: {
            input: withoutReasoning(fn.arguments ?? call.arguments ?? ""),
            output: result
              ? withoutReasoning(result.content)
              : "Awaiting result",
          },
          ...(createdAt ? { createdAt } : {}),
        });
      }
    }
    return messages;
  });
}
export function streamedInterimText(interim: string, stream: string): string {
  if (!interim) return stream;
  if (interim.startsWith(stream)) return interim;
  if (stream.startsWith(interim)) return stream;
  return interim + stream;
}

export function elapsed(start: number, end = Date.now()): string {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
