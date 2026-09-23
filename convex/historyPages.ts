import type { GenericId } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server.ts";

// At most 192 KiB of UTF-8 per chunk, leaving ample document overhead.
// Keep surrogate pairs together so storing a chunk cannot alter its text.
export function historyChunks(messages: unknown[]): string[] {
  const json = JSON.stringify(messages);
  const chunks: string[] = [];
  for (let start = 0; start < json.length;) {
    let end = Math.min(start + 64 * 1024, json.length);
    const last = json.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--;
    chunks.push(json.slice(start, end));
    start = end;
  }
  return chunks;
}

export async function readHistoryChunks(
  ctx: QueryCtx,
  page: GenericId<"pages">,
) {
  const chunks = await ctx.db
    .query("pageChunks")
    .withIndex("page", (q) => q.eq("page", page))
    .collect();
  return JSON.parse(chunks.map((chunk) => chunk.content).join(""));
}

export async function deleteHistoryChunks(
  ctx: MutationCtx,
  page: GenericId<"pages">,
) {
  for (
    const chunk of await ctx.db
      .query("pageChunks")
      .withIndex("page", (q) => q.eq("page", page))
      .collect()
  ) {
    await ctx.db.delete(chunk._id);
  }
}
