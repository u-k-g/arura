import { deepStrictEqual, equal } from "node:assert/strict";
import { fileReferences } from "../shared/artifacts.ts";
import {
  archiveAgeStatus,
  type Conversation,
  conversationArchiveActivity,
  groupMessages,
  interactionFromEvent,
  mergeHistoryMessages,
  normalizeMessages,
  shouldArchive,
  streamedInterimText,
  subagentTranscript,
  userMessageText,
  visibleText,
  withoutReasoning,
  workGroup,
} from "../shared/model.ts";

Deno.test("repeated interim stream text remains visible once", () => {
  const interim = "Let me zoom into the photo first.";
  equal(streamedInterimText(interim, "Let me "), interim);
  equal(streamedInterimText(interim, interim), interim);
  equal(streamedInterimText(interim, `${interim}\n\nThe fade starts higher.`),
    `${interim}\n\nThe fade starts higher.`);
  equal(streamedInterimText(interim, "\n\nThe fade starts higher."),
    `${interim}\n\nThe fade starts higher.`);
});

Deno.test("user message display hides expanded context and preserves unique references", () => {
  const payload =
    'Summarize @url:https://example.com\n\n--- Attached Context ---\n\n@url:https://example.com\nPAGE CONTENT\n@file:"notes with spaces.txt"\nFILE CONTENT\n@url:https://example.com';
  equal(
    userMessageText(payload),
    '@file:"notes with spaces.txt"\n\nSummarize @url:https://example.com',
  );
  equal(
    userMessageText("hello\n--- Context Warnings ---\nMissing file"),
    "hello",
  );
  equal(
    userMessageText(
      "--- Attached Context ---\n@url:https://example.com\nPAGE CONTENT",
    ),
    "@url:https://example.com",
  );
  equal(
    userMessageText("Ordinary --- Attached Context --- prose"),
    "Ordinary --- Attached Context --- prose",
  );
  const rows = [
    { id: 1, role: "user", content: payload },
    { id: 2, role: "assistant", content: payload },
  ];
  equal(normalizeMessages(rows)[0].text, userMessageText(payload));
  equal(normalizeMessages(rows)[1].text, payload);
  equal(rows[0].content, payload);
  equal(
    normalizeMessages([
      { role: "user", content: payload, display_content: "Native display" },
    ])[0].text,
    "Native display",
  );
});

Deno.test("compaction-archived rows keep their marker through projection", () => {
  const messages = normalizeMessages([
    { id: 1, role: "user", content: "Old prompt", compacted: true },
    { id: 2, role: "assistant", content: "Old answer", compacted: 1 },
    { id: 3, role: "user", content: "Active prompt" },
  ]);
  equal(messages[0].compacted, true);
  equal(messages[1].compacted, true);
  equal(messages[2].compacted, undefined);
});

Deno.test("expanded skills display the original invocation instead of instructions", () => {
  const header =
    '[IMPORTANT: The user has invoked the "research" skill, indicating they want you to follow its instructions.\nThe full skill content is loaded below.]';
  equal(userMessageText(`${header}\nSECRET SKILL BODY`), "/research");
  equal(
    userMessageText(
      `${header}\nSECRET SKILL BODY\nThe user has provided the following instruction alongside the skill invocation: Compare bikes\n\n[Runtime note: internal]`,
    ),
    "/research Compare bikes",
  );
  equal(
    userMessageText(
      '[IMPORTANT: The user has invoked the "/research /summarize" stacked skill bundle, loading 2 skills together.]\n\nUser instruction: Compare bikes\n\n[Loaded as part of the stacked skill invocation "research".]\nBODY',
    ),
    "/research /summarize Compare bikes",
  );
});

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
      { bot: true },
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

Deno.test("image-only history and tool arguments survive projection without reasoning", () => {
  const messages = normalizeMessages([
    {
      id: 1,
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,YQ==" } },
      ],
    },
    {
      id: 2,
      role: "assistant",
      content: "The answer",
      tool_calls: [
        {
          id: "call",
          function: {
            name: "read_file",
            arguments: { path: "notes", reasoning: "PRIVATE" },
          },
        },
      ],
    },
    { id: 3, role: "tool", tool_call_id: "call", content: "Result" },
  ]);
  equal(messages[0].attachments?.length, 1);
  equal(messages.length, 3);
  deepStrictEqual(messages[2].details, {
    input: { path: "notes" },
    output: "Result",
  });
  equal(groupMessages(messages)[0].answer?.text, "The answer");
  equal(groupMessages(messages)[0].work.length, 1);
});

Deno.test("timeline events retain chronology without becoming user messages", () => {
  const messages = normalizeMessages([
    { id: 1, role: "user", content: "Hello" },
    { id: 2, role: "assistant", content: "Before" },
    {
      id: 3,
      role: "user",
      display_kind: "personality_switch",
      content: "Internal model event",
    },
    { id: 4, role: "assistant", content: "After" },
  ]);
  const groups = groupMessages(messages);
  equal(groups[0].answer?.text, "Before");
  equal(groups[1].event?.text, "Personality changed");
  equal(groups[2].answer?.text, "After");
});

Deno.test("tool calls split across history pages retain both input and output", () => {
  const older = normalizeMessages([
    {
      id: 1,
      role: "assistant",
      tool_calls: [
        { id: "call", function: { name: "read_file", arguments: "notes" } },
      ],
    },
  ]);
  const newer = normalizeMessages([
    { id: 2, role: "tool", tool_call_id: "call", content: "File contents" },
  ]);
  const merged = mergeHistoryMessages([...older, ...newer]);
  equal(merged.length, 1);
  equal(merged[0].tool, "read_file");
  deepStrictEqual(merged[0].details, {
    input: "notes",
    output: "File contents",
  });
});

Deno.test("model switches are hidden without removing ordinary messages", () => {
  const rows = normalizeMessages([
    { id: 1, role: "user", content: "Model changed" },
    {
      id: 2,
      role: "user",
      display_kind: "model_switch",
      content: "Internal event",
    },
  ]);
  equal(rows.length, 1);
  equal(rows[0].text, "Model changed");
  equal(
    groupMessages([{ id: "legacy", role: "event", text: "Model changed" }])
      .length,
    0,
  );
});

Deno.test("archive age warnings share archive eligibility and restored inactivity window", () => {
  const now = 20 * 86400000;
  const c = {
    section: "recent",
    activityAt: now - 13 * 86400000,
  } as Conversation;
  equal(archiveAgeStatus(c, 14, now), "warning");
  equal(
    archiveAgeStatus({ ...c, activityAt: now - 6 * 86400000 }, 7, now),
    "warning",
  );
  equal(
    conversationArchiveActivity({ ...c, unarchivedAt: now - 86400000 }),
    now - 86400000,
  );
  equal(archiveAgeStatus(c, 14, now + 86400000), "overdue");
  equal(archiveAgeStatus(c, 14, now - 1), undefined);
  equal(archiveAgeStatus(c, 14, now, false), undefined);
  equal(archiveAgeStatus({ ...c, bot: true }, 14, now + 86400000), undefined);
  for (
    const patch of [
      { bot: true },
      { section: "pinned" },
      { section: "essential" },
      { section: "archived" },
      { folderId: "folder" },
      { running: true },
      { pendingInput: true },
      { unarchivedAt: now },
    ]
  ) {
    equal(
      archiveAgeStatus({ ...c, ...patch } as Conversation, 14, now),
      undefined,
    );
  }
  equal(archiveAgeStatus(c, 30, now), undefined);
});

Deno.test("work stays with its answer when later events or prompts arrive", () => {
  const groups = groupMessages([
    { id: "prompt", role: "user", text: "Question", createdAt: 100 },
    { id: "answer", role: "assistant", text: "Answer", createdAt: 200 },
    {
      id: "event",
      role: "event",
      text: "Background agent work finished",
      createdAt: 201,
    },
    { id: "next", role: "user", text: "Next question", createdAt: 300 },
  ]);
  equal(workGroup(groups, { text: "Answer", startedAt: 110 }), groups[0]);
  equal(workGroup(groups, { text: "", startedAt: 110 }), groups[0]);
  equal(workGroup(groups, { text: "", startedAt: 310 }), groups[2]);
});

Deno.test("a new reply never attaches its work to an older answered prompt in stale history", () => {
  const groups = groupMessages([
    { id: "old-prompt", role: "user", text: "Compare trips", createdAt: 100 },
    { id: "old-answer", role: "assistant", text: "Comparison", createdAt: 200 },
  ]);
  equal(
    workGroup(groups, { text: "October weather", startedAt: 300 }),
    undefined,
  );
  equal(
    workGroup(groups, {
      text: "Comparison",
      startedAt: 300,
      state: "complete",
    }),
    undefined,
  );
  equal(
    workGroup(
      groupMessages([
        { id: "stale", role: "user", text: "Old prompt", createdAt: 100 },
      ]),
      {
        text: "October weather",
        startedAt: 300,
        state: "complete",
      },
    ),
    undefined,
  );
});
