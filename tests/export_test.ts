import { deepStrictEqual, equal } from "node:assert/strict";
import { exportConversation } from "../server/export.ts";

Deno.test("conversation exports page public messages without hidden reasoning", async () => {
  const offsets: number[] = [];
  const response = await exportConversation(
    "conversation",
    "profile",
    async (offset) => {
      offsets.push(offset);
      return {
        messages: offset === 0
          ? Array.from({ length: 500 }, (_, id) => ({
            id,
            role: "assistant",
            display_kind: "hidden",
            content: "PRIVATE",
          }))
          : [
            {
              id: 500,
              role: "assistant",
              content: "<think>PRIVATE</think>Final answer",
              reasoning_content: "PRIVATE",
            },
          ],
      };
    },
  );
  const text = await response.text();
  equal(text.includes("PRIVATE"), false);
  deepStrictEqual(offsets, [0, 500]);
  deepStrictEqual(JSON.parse(text).messages, [
    { id: "500", role: "assistant", text: "Final answer" },
  ]);
});
