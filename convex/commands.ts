import { mutation, query } from "./_generated/server.ts";
import { adapter, device } from "./access.ts";
import { resolveKey } from "./conversationKeys.ts";
import { v } from "convex/values";
const kinds = [
  "send",
  "sendNow",
  "create",
  "openBot",
  "rename",
  "delete",
  "load",
  "branch",
  "rpc",
] as const;
export const result = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    return ctx.db
      .query("commands")
      .withIndex("id", (q) => q.eq("id", args.id))
      .unique();
  },
});
export const enqueue = mutation({
  args: {
    id: v.string(),
    conversation: v.string(),
    kind: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const d = await device(ctx);
    args.conversation = await resolveKey(ctx, args.conversation);
    if (!kinds.includes(args.kind as (typeof kinds)[number])) {
      throw new Error("Unknown action");
    }
    if (
      args.kind === "rpc" &&
      /^(secret|sudo|vault)\./.test(args.payload?.method ?? "")
    ) {
      throw new Error("Sensitive input must use the private response endpoint");
    }
    const old = await ctx.db
      .query("commands")
      .withIndex("id", (q) => q.eq("id", args.id))
      .unique();
    if (old) {
      if (old.device !== d.id) {
        throw new Error("Command belongs to another device");
      }
      return old._id;
    }
    return ctx.db.insert("commands", {
      ...args,
      device: d.id,
      status: "queued",
      createdAt: Date.now(),
    });
  },
});
export const queue = query({
  args: { blocked: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    await adapter(ctx);
    const queued = ctx.db
      .query("commands")
      .withIndex("status", (q) => q.eq("status", "queued"));
    return (
      args.blocked?.length
        ? queued.filter((q) =>
            q.or(
              q.neq(q.field("kind"), "send"),
              q.not(
                q.or(
                  ...(args.blocked ?? []).map((key) =>
                    q.eq(q.field("conversation"), key),
                  ),
                ),
              ),
            ),
          )
        : queued
    ).take(100);
  },
});
export const claim = mutation({
  args: { id: v.id("commands") },
  handler: async (ctx, args) => {
    await adapter(ctx);
    const c = await ctx.db.get(args.id);
    if (c?.status !== "queued") return null;
    const d = await ctx.db
      .query("devices")
      .withIndex("id", (q) => q.eq("id", c.device))
      .unique();
    if (!d || d.revoked) {
      await ctx.db.patch(c._id, {
        status: "cancelled",
        error: "Device access revoked",
      });
      return null;
    }
    await ctx.db.patch(c._id, { status: "dispatching" });
    return c;
  },
});
export const finish = mutation({
  args: {
    id: v.id("commands"),
    status: v.union(
      v.literal("accepted"),
      v.literal("complete"),
      v.literal("error"),
      v.literal("unknown"),
    ),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await adapter(ctx);
    const { id, ...patch } = args;
    await ctx.db.patch(id, patch);
  },
});
export const recover = mutation({
  args: {},
  handler: async (ctx) => {
    await adapter(ctx);
    for (const c of await ctx.db
      .query("commands")
      .withIndex("status", (q) => q.eq("status", "dispatching"))
      .collect()) {
      await ctx.db.patch(c._id, {
        status: "unknown",
        error:
          "Connection interrupted during dispatch. Check the conversation before resending.",
      });
    }
  },
});
export const edit = mutation({
  args: {
    id: v.id("commands"),
    text: v.optional(v.string()),
    cancel: v.optional(v.boolean()),
    next: v.optional(v.boolean()),
    sendNow: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await device(ctx);
    const c = await ctx.db.get(args.id);
    if (c?.status !== "queued") {
      throw new Error("This message has already been dispatched");
    }
    if (c.kind !== "send") {
      throw new Error("Only queued messages can be edited");
    }
    if (args.text !== undefined && !args.text.trim()) {
      throw new Error("Write a message");
    }
    const first = args.next
      ? await ctx.db
          .query("commands")
          .withIndex("status", (q) => q.eq("status", "queued"))
          .first()
      : null;
    await ctx.db.patch(c._id, {
      ...(args.sendNow ? { kind: "sendNow" } : {}),
      ...(args.cancel ? { status: "cancelled" as const } : {}),
      ...(args.text !== undefined
        ? { payload: { ...c.payload, text: args.text } }
        : {}),
      ...(args.next
        ? { createdAt: Math.min(0, first?.createdAt ?? 0) - 1 }
        : {}),
    });
  },
});
export const clearQueue = mutation({
  args: { conversation: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    const key = await resolveKey(ctx, args.conversation);
    const rows = await ctx.db
      .query("commands")
      .withIndex("pending", (q) =>
        q.eq("conversation", key).eq("status", "queued"),
      )
      .collect();
    for (const row of rows) {
      if (row.kind === "send") {
        await ctx.db.patch(row._id, { status: "cancelled" });
      }
    }
  },
});
export const deferSteer = mutation({
  args: { id: v.id("commands") },
  handler: async (ctx, args) => {
    await adapter(ctx);
    const row = await ctx.db.get(args.id);
    if (row?.kind === "sendNow" && row.status === "dispatching") {
      await ctx.db.patch(row._id, {
        kind: "send",
        status: "queued",
        error: "Hermes could not steer this run. This message stays queued.",
      });
    }
  },
});
