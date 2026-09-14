import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { device, adapter } from "./access";
export const list = query({
  args: {},
  handler: async (ctx) => {
    const self = await device(ctx);
    return (await ctx.db.query("devices").collect()).map(
      ({ secretHash, ...d }) => ({ ...d, current: d.id === self.id }),
    );
  },
});
export const rename = mutation({
  args: { id: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    const d = await ctx.db
      .query("devices")
      .withIndex("id", (q) => q.eq("id", args.id))
      .unique();
    if (d)
      await ctx.db.patch(d._id, {
        name: args.name.trim().slice(0, 80) || "Browser",
      });
  },
});
export const revoke = mutation({
  args: { id: v.optional(v.string()), others: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const self = await device(ctx);
    for (const d of await ctx.db.query("devices").collect())
      if (args.others ? d.id !== self.id : d.id === args.id)
        await ctx.db.patch(d._id, { revoked: true });
  },
});
export const authorize = mutation({
  args: {
    id: v.string(),
    secretHash: v.string(),
    name: v.string(),
    inviteHash: v.optional(v.string()),
    bootstrap: v.boolean(),
  },
  handler: async (ctx, args) => {
    await adapter(ctx);
    if (!args.bootstrap) {
      const invite = await ctx.db
        .query("invites")
        .withIndex("hash", (q) => q.eq("hash", args.inviteHash ?? ""))
        .unique();
      if (!invite || invite.used || invite.expiresAt < Date.now())
        throw new Error("Authorization code expired or invalid");
      const creator = await ctx.db
        .query("devices")
        .withIndex("id", (q) => q.eq("id", invite.createdBy))
        .unique();
      if (!creator || creator.revoked)
        throw new Error("Authorization code revoked");
      await ctx.db.patch(invite._id, { used: true });
    }
    await ctx.db.insert("devices", {
      id: args.id,
      secretHash: args.secretHash,
      name: args.name.slice(0, 80),
      createdAt: Date.now(),
      lastSeen: Date.now(),
      revoked: false,
    });
  },
});
export const resolve = query({
  args: { secretHash: v.string() },
  handler: async (ctx, args) => {
    await adapter(ctx);
    const d = await ctx.db
      .query("devices")
      .withIndex("secret", (q) => q.eq("secretHash", args.secretHash))
      .unique();
    return d && !d.revoked ? { id: d.id, name: d.name } : null;
  },
});
export const issueInvite = mutation({
  args: { hash: v.string() },
  handler: async (ctx, args) => {
    const self = await device(ctx);
    await ctx.db.insert("invites", {
      hash: args.hash,
      createdBy: self.id,
      expiresAt: Date.now() + 600_000,
      used: false,
    });
  },
});
export const touch = mutation({
  args: {},
  handler: async (ctx) => {
    const d = await device(ctx);
    if (Date.now() - d.lastSeen > 60_000)
      await ctx.db.patch(d._id, { lastSeen: Date.now() });
  },
});
