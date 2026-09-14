import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { adapter, device } from "./access";

export const schedule = mutation({
  args: {
    conversations: v.array(
      v.object({ key: v.string(), activityAt: v.number() }),
    ),
  },
  handler: async (ctx, { conversations }) => {
    await adapter(ctx);
    for (const conversation of conversations) {
      const old = await ctx.db
        .query("artifactScans")
        .withIndex("conversation", (q) =>
          q.eq("conversation", conversation.key),
        )
        .unique();
      if (old && old.activityAt === conversation.activityAt) continue;
      const data = {
        conversation: conversation.key,
        activityAt: conversation.activityAt,
        scan: Math.max(Date.now(), (old?.scan ?? 0) + 1),
        offset: 0,
        complete: false,
        retryAt: 0,
        error: undefined,
      };
      if (old) await ctx.db.patch(old._id, data);
      else await ctx.db.insert("artifactScans", data);
    }
  },
});
export const next = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    await adapter(ctx);
    return ctx.db
      .query("artifactScans")
      .withIndex("pending", (q) => q.eq("complete", false).lte("retryAt", now))
      .first();
  },
});
export const record = mutation({
  args: {
    id: v.id("artifactScans"),
    scan: v.number(),
    offset: v.number(),
    hasMore: v.boolean(),
    error: v.optional(v.string()),
    files: v.array(
      v.object({ path: v.string(), name: v.string(), messageId: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    await adapter(ctx);
    const scan = await ctx.db.get(args.id);
    if (!scan || scan.scan !== args.scan || scan.offset !== args.offset) return;
    if (args.error) {
      await ctx.db.patch(scan._id, {
        error: args.error,
        retryAt: Date.now() + 60000,
      });
      return;
    }
    for (const file of args.files) {
      const old = await ctx.db
        .query("artifacts")
        .withIndex("file", (q) =>
          q.eq("conversation", scan.conversation).eq("path", file.path),
        )
        .unique();
      const value = {
        ...file,
        conversation: scan.conversation,
        scan: scan.scan,
        activityAt: scan.activityAt,
      };
      if (old) await ctx.db.patch(old._id, value);
      else await ctx.db.insert("artifacts", value);
    }
    if (!args.hasMore) {
      for (const old of await ctx.db
        .query("artifacts")
        .withIndex("conversation", (q) =>
          q.eq("conversation", scan.conversation),
        )
        .collect())
        if (old.scan !== scan.scan) await ctx.db.delete(old._id);
    }
    await ctx.db.patch(scan._id, {
      offset: args.offset + 100,
      complete: !args.hasMore,
      error: undefined,
      retryAt: args.hasMore ? Date.now() : 0,
    });
  },
});
export const list = query({
  args: { limit: v.number(), search: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    const table = ctx.db.query("artifacts");
    const query = args.search.trim()
      ? table.withSearchIndex("search", (q) =>
          q.search("name", args.search.trim()),
        )
      : table.withIndex("recent").order("desc");
    const rows = await query.take(Math.min(1000, Math.max(30, args.limit)));
    const items = [];
    for (const row of rows) {
      const conversation = await ctx.db
        .query("conversations")
        .withIndex("key", (q) => q.eq("key", row.conversation))
        .unique();
      if (conversation && !conversation.deleted)
        items.push({ ...row, title: conversation.title });
    }
    const scans = await ctx.db
      .query("artifactScans")
      .withIndex("pending", (q) => q.eq("complete", false))
      .collect();
    return {
      items,
      pending: scans.length,
      failures: scans.filter((scan) => scan.error).length,
      hasMore: rows.length >= args.limit,
    };
  },
});
