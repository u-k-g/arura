import { deepStrictEqual, equal } from "node:assert/strict";
import { fileReferences } from "../shared/artifacts.ts";
import {
  type Conversation,
  groupMessages,
  interactionFromEvent,
  normalizeMessages,
  shouldArchive,
  subagentTranscript,
  visibleText,
  withoutReasoning,
} from "../shared/model.ts";

Deno.test("clarification projection keeps question IDs, choices and restored answers without reasoning", () => {
  const value = interactionFromEvent("clarify.request", {
    request_id: "request",
    reasoning: "PRIVATE",
    questions: [
      {
        qid: "color",
        question: "<think>PRIVATE</think>Choose colors",
        choices: ["Blue", "Green"],
        multi_select: true,
      },
      { qid: "place", question: "Where?", choices: [] },
    ],
    answers: { color: '["Blue"]' },
  });
  deepStrictEqual(value.questions, [
    {
      id: "color",
      text: "Choose colors",
      options: ["Blue", "Green"],
      multiple: true,
      answer: '["Blue"]',
    },
    { id: "place", text: "Where?", options: [], multiple: false },
  ]);
  equal(JSON.stringify(value).includes("PRIVATE"), false);
  deepStrictEqual(
    interactionFromEvent("clarify.request", {
      question: "Which?",
      choices: ["A", "B"],
    }).options,
    ["A", "B"],
  );
});

Deno.test("reasoning never enters visible history or nested RPC results", () => {
  equal(visibleText("<think>private</think>Public answer"), "Public answer");
  equal(visibleText("<think>unfinished private"), "");
  equal(visibleText("<thi"), "");
  deepStrictEqual(
    normalizeMessages([
      {
        id: 1,
        role: "assistant",
        content: "<reasoning>private</reasoning>Answer",
        reasoning: "private",
      },
      { id: 2, role: "assistant", display_kind: "hidden", content: "private" },
    ]),
    [{ id: "1", role: "assistant", text: "Answer" }],
  );
  deepStrictEqual(
    withoutReasoning({
      messages: [
        {
          text: "Answer",
          reasoning: "private",
          nested: { thinking: "private" },
        },
      ],
    }),
    { messages: [{ text: "Answer", nested: {} }] },
  );
});

Deno.test("generated files come from public assistant output and explicit tool paths", () => {
  const files = fileReferences([
    { id: 1, role: "user", content: "[Private](/private/user.txt)" },
    {
      id: 2,
      role: "assistant",
      content:
        "<think>[Private](/private/reasoning.txt)</think>[Report](/files/report.pdf) [Remote](https://example.com/report.pdf)",
    },
    {
      id: 3,
      role: "tool",
      content: JSON.stringify({
        output_path: "/files/report.csv",
        reasoning: { path: "/private/hidden.txt" },
      }),
    },
    {
      id: 4,
      role: "assistant",
      display_kind: "hidden",
      content: "[Hidden](/files/hidden.txt)",
    },
  ]);
  deepStrictEqual(
    files.map((file) => file.path),
    ["/files/report.pdf", "/files/report.csv"],
  );
});

Deno.test("completed conversation turns retain final answers and collapse intermediate work", () => {
  const messages = [
    { id: "1", role: "user" as const, text: "Research" },
    { id: "2", role: "assistant" as const, text: "Searching" },
    { id: "3", role: "tool" as const, text: "Raw result" },
    { id: "4", role: "assistant" as const, text: "Final report" },
    { id: "5", role: "user" as const, text: "Follow up" },
  ];
  const groups = groupMessages(messages);
  equal(groups.length, 2);
  equal(groups[0].answer?.text, "Final report");
  deepStrictEqual(
    groups[0].work.map((message) => message.id),
    ["2", "3"],
  );
  equal(groups[1].answer, undefined);
  equal(messages.length, 5);
});

Deno.test("delegated transcript drops private reasoning and incomplete log lines", () => {
  const text = [
    "private tail of a truncated reasoning line",
    "12:00:00 think    | private reasoning",
    "12:00:01 assistant | Visible progress",
    "12:00:02 tool     | -> read_file(secret args)",
    "12:00:03 result   | read_file ok 1s: raw output",
    "12:00:04 final    | Complete",
  ].join("\n");
  equal(
    subagentTranscript(text),
    [
      "12:00:01 assistant | Visible progress",
      "12:00:02 tool | -> read_file",
      "12:00:03 result | read_file ok 1s",
      "12:00:04 final | Complete",
    ].join("\n"),
  );
  equal(subagentTranscript(text, true).includes("private"), false);
  equal(subagentTranscript(text, true).includes("raw output"), true);
});

Deno.test("archive protects pinned folders, active work, input, and recently restored chats", () => {
  const now = 30 * 86400000;
  const c: Conversation = {
    key: "k",
    profile: "default",
    sourceId: "s",
    title: "Chat",
    activityAt: 0,
    section: "recent",
    rank: 0,
    running: false,
    pendingInput: false,
  };
  equal(shouldArchive(c, 7, now), true);
  for (
    const patch of [
      { section: "essential" },
      { section: "pinned" },
      { folderId: "folder" },
      { running: true },
      { pendingInput: true },
      { unarchivedAt: now - 1000 },
    ]
  ) {
    equal(shouldArchive({ ...c, ...patch } as Conversation, 7, now), false);
  }
  equal(shouldArchive({ ...c, activityAt: now - 7 * 86400000 }, 7, now), true);
});
