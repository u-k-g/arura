import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { adapter, device } from "./access";

export const latest = query({
  args: {},
  handler: async (ctx) => {
    await device(ctx);
    return ctx.db.query("backups").order("desc").first();
  },
});
export const pending = query({
  args: {},
  handler: async (ctx) => {
    await adapter(ctx);
    const row = await ctx.db.query("backups").order("desc").first();
    return row && ["starting", "running"].includes(row.status) ? row : null;
  },
});
export const begin = mutation({
  args: {},
  handler: async (ctx) => {
    await adapter(ctx);
    const previous = await ctx.db.query("backups").order("desc").first();
    if (previous && ["starting", "running"].includes(previous.status))
      throw new Error("A backup is already in progress");
    return ctx.db.insert("backups", { status: "starting" });
  },
});
export const update = mutation({
  args: {
    id: v.id("backups"),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("error"),
    ),
    archive: v.optional(v.string()),
    pid: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...value }) => {
    await adapter(ctx);
    await ctx.db.patch(id, value);
  },
});
