import { v } from "convex/values";
import { conversationKey } from "../shared/model";
import { mutation, query } from "./_generated/server";
import { adapter } from "./access";

export const prepareRename = mutation({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    await adapter(ctx);
    const old = await ctx.db
      .query("profileRenames")
      .withIndex("from", (q) => q.eq("from", args.from))
      .unique();
    if (old && old.to !== args.to)
      throw new Error("An earlier profile rename still needs reconciliation");
    if (!old) await ctx.db.insert("profileRenames", args);
  },
});
export const pendingRenames = query({
  args: {},
  handler: async (ctx) => {
    await adapter(ctx);
    return ctx.db.query("profileRenames").collect();
  },
});
export const finishRename = mutation({
  args: { from: v.string() },
  handler: async (ctx, args) => {
    await adapter(ctx);
    const old = await ctx.db
      .query("profileRenames")
      .withIndex("from", (q) => q.eq("from", args.from))
      .unique();
    if (old) await ctx.db.delete(old._id);
  },
});

// Called only after Hermes confirms the canonical new profile name. A clone
// never enters this path: identical source IDs do not establish identity.
export const renamed = mutation({
  args: { from: v.string(), to: v.string(), sourceIds: v.array(v.string()) },
  handler: async (ctx, { from, to, sourceIds }) => {
    await adapter(ctx);
    if (from === to) return;
    for (const sourceId of sourceIds) {
      const row = await ctx.db
        .query("conversations")
        .withIndex("key", (q) => q.eq("key", conversationKey(from, sourceId)))
        .unique();
      if (!row) continue;
      const target = conversationKey(to, row.sourceId);
      const existing = await ctx.db
        .query("conversations")
        .withIndex("key", (q) => q.eq("key", target))
        .unique();
      const { _id, _creationTime, ...data } = row;
      const migrated = {
        ...data,
        key: target,
        profile: to,
        deleted: false,
        running: false,
        pendingInput: false,
      };
      if (existing) {
        await ctx.db.patch(existing._id, migrated);
        await ctx.db.delete(_id);
      } else await ctx.db.patch(_id, migrated);
      const targetAlias = await ctx.db
        .query("conversationAliases")
        .withIndex("key", (q) => q.eq("key", target))
        .unique();
      if (targetAlias) await ctx.db.delete(targetAlias._id);
      for (const alias of await ctx.db
        .query("conversationAliases")
        .withIndex("target", (q) => q.eq("target", row.key))
        .collect()) {
        await ctx.db.patch(alias._id, { target });
      }
      const oldAlias = await ctx.db
        .query("conversationAliases")
        .withIndex("key", (q) => q.eq("key", row.key))
        .unique();
      if (oldAlias) await ctx.db.patch(oldAlias._id, { target });
      else await ctx.db.insert("conversationAliases", { key: row.key, target });
      // Public projections are rebuilt from Hermes; web-owned organization and
      // queued actions retain their identity.
      for (const page of await ctx.db
        .query("pages")
        .withIndex("page", (q) => q.eq("conversation", row.key))
        .collect())
        await ctx.db.delete(page._id);
      for (const turn of await ctx.db
        .query("turns")
        .withIndex("conversation", (q) => q.eq("conversation", row.key))
        .collect())
        await ctx.db.delete(turn._id);
      for (const file of await ctx.db
        .query("artifacts")
        .withIndex("conversation", (q) => q.eq("conversation", row.key))
        .collect())
        await ctx.db.delete(file._id);
      for (const scan of await ctx.db
        .query("artifactScans")
        .withIndex("conversation", (q) => q.eq("conversation", row.key))
        .collect())
        await ctx.db.delete(scan._id);
      for (const command of await ctx.db
        .query("commands")
        .withIndex("conversation", (q) => q.eq("conversation", row.key))
        .collect()) {
        await ctx.db.patch(command._id, { conversation: target });
      }
      for (const notice of await ctx.db
        .query("notices")
        .withIndex("conversation", (q) => q.eq("conversation", row.key))
        .collect()) {
        await ctx.db.patch(notice._id, { conversation: target });
      }
    }
  },
});
