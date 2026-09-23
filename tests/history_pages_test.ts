import { strict as assert } from "node:assert";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { historyChunks } from "../convex/historyPages.ts";
import { identity } from "../server/identity.ts";
import type { Transcript } from "../shared/contracts.ts";
import { requireValue } from "./require_value.ts";

Deno.test("history chunks preserve Unicode across storage boundaries", () => {
  const messages = [{ text: "a".repeat(65525) + "🌄漢字".repeat(100000) }];
  const chunks = historyChunks(messages);
  assert(chunks.length > 1);
  for (const chunk of chunks) {
    assert(new TextEncoder().encode(chunk).length <= 192 * 1024);
    assert.equal(
      new TextDecoder().decode(new TextEncoder().encode(chunk)),
      chunk,
    );
  }
  assert.deepEqual(JSON.parse(chunks.join("")), messages);
});

Deno.test({
  name:
    "oversized history round-trips without losing edits or mixing page revisions",
  ignore: !Deno.env.get("CONVEX_SELF_HOSTED_URL"),
  async fn() {
    const url = requireValue(
      Deno.env.get("CONVEX_SELF_HOSTED_URL"),
      "Convex URL",
    );
    const signer = await identity();
    const adapter = new ConvexHttpClient(url);
    adapter.setAuth(await signer.sign("arura:adapter"));
    const device = crypto.randomUUID();
    await adapter.mutation(anyApi.devices.authorize, {
      id: device,
      secretHash: crypto.randomUUID(),
      name: "Large history",
      bootstrap: true,
    });
    const client = new ConvexHttpClient(url);
    client.setAuth(await signer.sign(device));
    const conversation = JSON.stringify(["default", crypto.randomUUID()]);
    const output = "Mountain 🌄 漢字 ".repeat(30000);
    const messages = [
      { id: "prompt", role: "user", text: "Compare trips" },
      { id: "tool", role: "tool", text: output, details: { output } },
      { id: "answer", role: "assistant", text: "Comparison" },
    ];
    const save = (
      offset: number,
      revision: string,
      rows: typeof messages,
      headRevision?: string,
    ) =>
      adapter.mutation(anyApi.workspace.ingest, {
        page: {
          conversation,
          offset,
          revision,
          messages: rows,
          hasMore: offset === 0,
          ...(headRevision ? { headRevision } : {}),
        },
      });
    const read = (): Promise<Transcript> =>
      client.query(anyApi.workspace.transcript, { conversation, pages: 2 });
    await save(0, "first", messages);
    assert.deepEqual((await read()).pages[0].messages, messages);
    await save(100, "older", messages, "first");
    assert.equal((await read()).pages.length, 2);
    const edited = [{ id: "edited", role: "user", text: "Revised trip" }];
    await save(0, "edited", edited);
    const result = await read();
    assert.equal(result.pages.length, 1);
    assert.deepEqual(result.pages[0].messages, edited);
    await save(100, "stale", messages, "first");
    assert.equal((await read()).pages.length, 1);
    await save(0, "large-again", messages);
    assert.deepEqual((await read()).pages[0].messages, messages);
  },
});
