import { normalizeMessages } from "../shared/model.ts";

export async function exportConversation(
  id: string,
  profile: string,
  readPage: (offset: number) => Promise<{ messages?: unknown[] }>,
) {
  const first = await readPage(0);
  async function* chunks() {
    yield `${JSON.stringify({
      format: "arura-conversation",
      version: 1,
      id,
      profile,
    }).slice(0, -1)},"messages":[`;
    let page = first,
      offset = 0,
      written = false;
    while (true) {
      const messages = normalizeMessages(
        (page.messages ?? []).filter(
          (value): value is Record<string, unknown> =>
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value),
        ),
      );
      if (messages.length) {
        yield (written ? "," : "") + JSON.stringify(messages).slice(1, -1);
        written = true;
      }
      if ((page.messages?.length ?? 0) < 500) break;
      offset += 500;
      page = await readPage(offset);
    }
    yield "]}";
  }
  const iterator = chunks(),
    encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    async cancel() {
      await iterator.return();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="conversation.json"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
