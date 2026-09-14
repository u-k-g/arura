import type { MutationCtx, QueryCtx } from "./_generated/server.ts";

export async function resolveKey(ctx: QueryCtx | MutationCtx, key: string) {
  const seen = new Set<string>();
  while (!seen.has(key)) {
    seen.add(key);
    const alias = await ctx.db
      .query("conversationAliases")
      .withIndex("key", (q) => q.eq("key", key))
      .unique();
    if (!alias) return key;
    key = alias.target;
  }
  throw new Error("Conversation redirect contains a cycle");
}
