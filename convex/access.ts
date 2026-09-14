import type { MutationCtx, QueryCtx } from "./_generated/server";
export async function device(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authorization required");
  const record = await ctx.db
    .query("devices")
    .withIndex("id", (q) => q.eq("id", identity.subject))
    .unique();
  if (!record || record.revoked) throw new Error("Device access revoked");
  return record;
}
export async function adapter(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.subject !== "arura:adapter") {
    throw new Error("Host authorization required");
  }
}
