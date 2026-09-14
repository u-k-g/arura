import { anyApi } from "convex/server";
import { v } from "convex/values";
import { incomingOrganization } from "../shared/organization.ts";
import { shouldArchive } from "../shared/model.ts";
import { internalMutation, mutation, query } from "./_generated/server.ts";
import { adapter, device } from "./access.ts";
import { resolveKey } from "./conversationKeys.ts";

const section = v.union(
  v.literal("essential"),
  v.literal("pinned"),
  v.literal("recent"),
  v.literal("archived"),
);
export const sourceKeys = query({
  args: {},
  handler: async (ctx) => {
    await adapter(ctx);
    return (await ctx.db.query("conversations").collect())
      .filter((c) => !c.deleted && !c.pendingPersistence)
      .map((c) => c.key);
  },
});
// New gateway sessions are live before Hermes writes their first history row.
export const pendingSessions = query({
  args: {},
  handler: async (ctx) => {
    await adapter(ctx);
    return (await ctx.db.query("conversations").collect()).filter(
      (c) => c.pendingPersistence && !c.deleted,
    );
  },
});
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const self = await device(ctx);
    const pinned = await ctx.db
      .query("conversations")
      .withIndex(
        "section",
        (q) => q.gt("section", "archived").lt("section", "recent"),
      )
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const recent = await ctx.db
      .query("conversations")
      .withIndex("activity", (q) => q.eq("section", "recent"))
      .order("desc")
      .filter((q) => q.neq(q.field("deleted"), true))
      .paginate({ cursor: null, numItems: 100 });
    const settings = Object.fromEntries(
      (await ctx.db.query("settings").collect()).map((x) => [x.key, x.value]),
    );
    return {
      deviceId: self.id,
      conversations: [...pinned, ...recent.page],
      recentCursor: recent.continueCursor,
      recentHasMore: !recent.isDone,
      folders: (await ctx.db.query("folders").collect()).sort(
        (a, b) => a.rank - b.rank,
      ),
      settings,
      notices: await ctx.db
        .query("notices")
        .withIndex("created")
        .order("desc")
        .take(40),
      connection: await ctx.db
        .query("connection")
        .withIndex("key", (q) => q.eq("key", "hermes"))
        .unique(),
    };
  },
});
export const recent = query({
  args: { cursor: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    return ctx.db
      .query("conversations")
      .withIndex("activity", (q) => q.eq("section", "recent"))
      .order("desc")
      .filter((q) => q.neq(q.field("deleted"), true))
      .paginate({ cursor: args.cursor, numItems: 100 });
  },
});
export const archived = query({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await device(ctx);
    return ctx.db
      .query("conversations")
      .withIndex("archive", (q) => q.eq("section", "archived"))
      .order("desc")
      .filter((q) => q.neq(q.field("deleted"), true))
      .paginate({ cursor: args.cursor, numItems: 10 });
  },
});
export const byKey = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    await device(ctx);
    key = await resolveKey(ctx, key);
    const row = await ctx.db
      .query("conversations")
      .withIndex("key", (q) => q.eq("key", key))
      .unique();
    return row && !row.deleted ? row : null;
  },
});
export const transcript = query({
  args: { conversation: v.string(), pages: v.number() },
  handler: async (ctx, args) => {
    await device(ctx);
    args.conversation = await resolveKey(ctx, args.conversation);
    if (!Number.isSafeInteger(args.pages) || args.pages < 1) {
      throw new Error("Invalid history page count");
    }
    const recent = await ctx.db
      .query("commands")
      .withIndex("conversation", (q) => q.eq("conversation", args.conversation))
      .order("desc")
      .take(30);
    const queued = await ctx.db
      .query("commands")
      .withIndex(
        "pending",
        (q) => q.eq("conversation", args.conversation).eq("status", "queued"),
      )
      .collect();
    return {
      pages: await ctx.db
        .query("pages")
        .withIndex("page", (q) => q.eq("conversation", args.conversation))
        .take(args.pages),
      turn: (
        await ctx.db
          .query("turns")
          .withIndex(
            "conversation",
            (q) => q.eq("conversation", args.conversation),
          )
          .unique()
      )?.data ?? null,
      commands: [
        ...queued,
        ...recent.filter((command) => command.status !== "queued"),
      ],
    };
  },
});
export const move = mutation({
  args: {
    key: v.string(),
    section,
    folderId: v.optional(v.id("folders")),
    rank: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await device(ctx);
    args.key = await resolveKey(ctx, args.key);
    const c = await ctx.db
      .query("conversations")
      .withIndex("key", (q) => q.eq("key", args.key))
      .unique();
    if (!c) throw new Error("Conversation not found");
    if (args.folderId && !(await ctx.db.get(args.folderId))) {
      throw new Error("Folder not found");
    }
    if (args.folderId && args.section !== "pinned") {
      throw new Error("Folders belong in Pinned");
    }
    if (args.section === "archived" && (c.running || c.pendingInput)) {
      throw new Error("Finish the active work before archiving");
    }
    await ctx.db.patch(c._id, {
      organizationPending: true,
      organizationRevision: (c.organizationRevision ?? 0) + 1,
      section: args.section,
      folderId: args.folderId,
      rank: args.rank ?? Date.now(),
      archivedAt: args.section === "archived" ? Date.now() : undefined,
      unarchivedAt: c.section === "archived" && args.section !== "archived"
        ? Date.now()
        : c.unarchivedAt,
    });
  },
});
export const folder = mutation({
  args: {
    id: v.optional(v.id("folders")),
    name: v.optional(v.string()),
    remove: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await device(ctx);
    if (args.remove && args.id) {
      for (
        const c of await ctx.db
          .query("conversations")
          .filter((q) => q.eq(q.field("folderId"), args.id))
          .collect()
      ) {
        await ctx.db.patch(c._id, { folderId: undefined, section: "pinned" });
      }
      await ctx.db.delete(args.id);
      return;
    }
    const name = args.name?.trim().slice(0, 80);
    if (!name) throw new Error("Name the folder");
    if (args.id) await ctx.db.patch(args.id, { name });
    else await ctx.db.insert("folders", { name, rank: Date.now() });
  },
});
export const reorder = mutation({
  args: {
    kind: v.union(v.literal("conversation"), v.literal("folder")),
    id: v.string(),
    direction: v.union(v.literal(-1), v.literal(1)),
  },
  handler: async (ctx, args) => {
    await device(ctx);
    if (args.kind === "folder") {
      const rows = (await ctx.db.query("folders").collect()).sort(
        (a, b) => a.rank - b.rank,
      );
      const index = rows.findIndex((row) => row._id === args.id),
        next = index + args.direction;
      if (index < 0 || next < 0 || next >= rows.length) return;
      [rows[index], rows[next]] = [rows[next], rows[index]];
      for (const [rank, row] of rows.entries()) {
        await ctx.db.patch(row._id, { rank });
      }
    } else {
      const current = await ctx.db
        .query("conversations")
        .withIndex("key", (q) => q.eq("key", args.id))
        .unique();
      if (!current || !["essential", "pinned"].includes(current.section)) {
        throw new Error("Only saved conversations have a manual order");
      }
      const rows = (
        await ctx.db
          .query("conversations")
          .filter((q) => q.eq(q.field("section"), current.section))
          .collect()
      )
        .filter((row) => !row.deleted && row.folderId === current.folderId)
        .sort((a, b) => a.rank - b.rank);
      const index = rows.findIndex((row) => row.key === args.id),
        next = index + args.direction;
      if (index < 0 || next < 0 || next >= rows.length) return;
      [rows[index], rows[next]] = [rows[next], rows[index]];
      for (const [rank, row] of rows.entries()) {
        await ctx.db.patch(row._id, { rank });
      }
    }
  },
});
export const setting = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    await device(ctx);
    if (!["modelFavorites", "appearance"].includes(args.key)) {
      throw new Error("Unknown preference");
    }
    const old = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", args.key))
      .unique();
    if (old) await ctx.db.patch(old._id, { value: args.value });
    else await ctx.db.insert("settings", args);
  },
});
export const modelVisibility = mutation({
  args: { model: v.string(), hidden: v.boolean() },
  handler: async (ctx, args) => {
    await device(ctx);
    if (!args.model || args.model.length > 1024) {
      throw new Error("Invalid model");
    }
    const old = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", "hiddenModels"))
      .unique();
    const hidden = new Set<string>(Array.isArray(old?.value) ? old.value : []);
    if (args.hidden) hidden.add(args.model);
    else hidden.delete(args.model);
    const value = [...hidden];
    if (old) await ctx.db.patch(old._id, { value });
    else await ctx.db.insert("settings", { key: "hiddenModels", value });
  },
});
export const readNotice = mutation({
  args: { id: v.id("notices") },
  handler: async (ctx, args) => {
    await device(ctx);
    await ctx.db.patch(args.id, { read: true });
  },
});
export const sweep = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const pref = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", "archiveDays"))
      .unique();
    const policy = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", "archiveEnabled"))
      .unique();
    if (policy?.value === false) return;
    const batch = await ctx.db
      .query("conversations")
      .withIndex("section", (q) => q.eq("section", "recent"))
      .paginate({ cursor: args.cursor ?? null, numItems: 250 });
    for (const c of batch.page) {
      if (
        !c.deleted &&
        shouldArchive(c, Number(pref?.value ?? 7), Date.now())
      ) {
        await ctx.db.patch(c._id, {
          section: "archived",
          organizationPending: true,
          organizationRevision: (c.organizationRevision ?? 0) + 1,
          archivedAt: Date.now(),
        });
      }
    }
    if (!batch.isDone) {
      await ctx.scheduler.runAfter(0, anyApi.workspace.sweep, {
        cursor: batch.continueCursor,
      });
    }
  },
});
export const ingest = mutation({
  args: {
    conversations: v.optional(v.array(v.any())),
    archivePolicy: v.optional(
      v.object({ days: v.number(), enabled: v.boolean() }),
    ),
    page: v.optional(v.any()),
    turn: v.optional(v.any()),
    online: v.optional(v.boolean()),
    error: v.optional(v.string()),
    notice: v.optional(v.any()),
    changed: v.optional(v.boolean()),
    deletedKeys: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await adapter(ctx);
    if (args.archivePolicy) {
      for (
        const [key, value] of Object.entries({
          archiveDays: args.archivePolicy.days,
          archiveEnabled: args.archivePolicy.enabled,
        })
      ) {
        const previous = await ctx.db
          .query("settings")
          .withIndex("key", (q) => q.eq("key", key))
          .unique();
        if (previous && previous.value !== value) {
          await ctx.db.patch(previous._id, { value });
        } else if (!previous) await ctx.db.insert("settings", { key, value });
      }
    }
    for (const key of args.deletedKeys ?? []) {
      const old = await ctx.db
        .query("conversations")
        .withIndex("key", (q) => q.eq("key", key))
        .unique();
      if (old) await ctx.db.patch(old._id, { deleted: true });
      for (
        const scan of await ctx.db
          .query("artifactScans")
          .withIndex("conversation", (q) => q.eq("conversation", key))
          .collect()
      ) {
        await ctx.db.delete(scan._id);
      }
      for (
        const file of await ctx.db
          .query("artifacts")
          .withIndex("conversation", (q) => q.eq("conversation", key))
          .collect()
      ) {
        await ctx.db.delete(file._id);
      }
    }
    for (const input of args.conversations ?? []) {
      if ((await resolveKey(ctx, String(input.key))) !== input.key) continue;
      const old = await ctx.db
        .query("conversations")
        .withIndex("key", (q) => q.eq("key", input.key))
        .unique();
      const data = {
        key: String(input.key),
        sourceId: String(input.sourceId),
        pendingPersistence: input.pendingPersistence === true,
        profile: String(input.profile),
        bot: Boolean(input.bot),
        title: String(input.title),
        activityAt: Number(input.activityAt),
        deleted: false,
      };
      const organization = incomingOrganization(old, input, Date.now());
      if (old) await ctx.db.patch(old._id, { ...data, ...organization });
      else {
        await ctx.db.insert("conversations", {
          ...data,
          section: "recent",
          ...organization,
          rank: data.activityAt,
          running: false,
          pendingInput: false,
        });
      }
    }
    if (args.page) {
      const p = args.page;
      const old = await ctx.db
        .query("pages")
        .withIndex(
          "page",
          (q) => q.eq("conversation", p.conversation).eq("offset", p.offset),
        )
        .unique();
      if (p.offset === 0 && old?.revision !== p.revision) {
        for (
          const stale of await ctx.db
            .query("pages")
            .withIndex("page", (q) => q.eq("conversation", p.conversation))
            .collect()
        ) {
          if (stale.offset !== 0) await ctx.db.delete(stale._id);
        }
      }
      if (p.offset > 0) {
        const head = await ctx.db
          .query("pages")
          .withIndex(
            "page",
            (q) => q.eq("conversation", p.conversation).eq("offset", 0),
          )
          .unique();
        if (!head || head.revision !== p.headRevision) return;
      }
      const value = {
        revision: p.revision,
        conversation: String(p.conversation),
        offset: Number(p.offset),
        messages: p.messages,
        hasMore: Boolean(p.hasMore),
        updatedAt: Date.now(),
      };
      if (old) await ctx.db.patch(old._id, value);
      else await ctx.db.insert("pages", value);
    }
    if (args.turn) {
      const t = args.turn;
      for (const interaction of t.interactions ?? []) {
        const id = `${t.conversation}:input:${interaction.id}`;
        const existing = await ctx.db
          .query("notices")
          .withIndex("id", (q) => q.eq("id", id))
          .unique();
        if (!existing) {
          await ctx.db.insert("notices", {
            id,
            title: interaction.kind === "approval"
              ? "Approval needed"
              : interaction.kind === "clarify"
              ? "Hermes has a question"
              : "Input needed",
            conversation: t.conversation,
            createdAt: Date.now(),
            read: false,
          });
        }
      }
      const old = await ctx.db
        .query("turns")
        .withIndex("conversation", (q) => q.eq("conversation", t.conversation))
        .unique();
      if (old) await ctx.db.patch(old._id, { data: t });
      else {
        await ctx.db.insert("turns", { conversation: t.conversation, data: t });
      }
      const c = await ctx.db
        .query("conversations")
        .withIndex("key", (q) => q.eq("key", t.conversation))
        .unique();
      if (c) {
        await ctx.db.patch(c._id, {
          running: t.state === "running",
          pendingInput: t.interactions.length > 0,
          activityAt: Date.now(),
        });
      }
    }
    if (args.notice) {
      const n = args.notice;
      const existing = await ctx.db
        .query("notices")
        .withIndex("id", (q) => q.eq("id", n.id))
        .unique();
      if (!existing) {
        await ctx.db.insert("notices", {
          id: n.id,
          title: n.title,
          conversation: n.conversation,
          createdAt: Date.now(),
          read: false,
        });
      }
    }
    if (args.online !== undefined || args.changed) {
      const old = await ctx.db
        .query("connection")
        .withIndex("key", (q) => q.eq("key", "hermes"))
        .unique();
      const value = {
        key: "hermes",
        online: args.online ?? old?.online ?? false,
        error: args.error,
        updatedAt: Date.now(),
        revision: (old?.revision ?? 0) + (args.changed ? 1 : 0),
      };
      if (old) await ctx.db.patch(old._id, value);
      else await ctx.db.insert("connection", value);
    }
  },
});
export const backup = query({
  args: {},
  handler: async (ctx) => {
    await device(ctx);
    return {
      version: 1,
      createdAt: Date.now(),
      conversations: await ctx.db.query("conversations").collect(),
      folders: await ctx.db.query("folders").collect(),
      conversationAliases: await ctx.db.query("conversationAliases").collect(),
      profileRenames: await ctx.db.query("profileRenames").collect(),
      settings: await ctx.db.query("settings").collect(),
    };
  },
});

// Durable outbox: the host drains this before taking its next Hermes snapshot.
export const pendingOrganization = query({
  args: {},
  handler: async (ctx) => {
    await adapter(ctx);
    return await ctx.db
      .query("conversations")
      .withIndex(
        "organizationPending",
        (q) => q.eq("organizationPending", true),
      )
      .filter((q) => q.neq(q.field("deleted"), true))
      .take(100);
  },
});
export const organizationSaved = mutation({
  args: {
    key: v.string(),
    revision: v.number(),
    pinned: v.boolean(),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    await adapter(ctx);
    const c = await ctx.db
      .query("conversations")
      .withIndex("key", (q) => q.eq("key", args.key))
      .unique();
    if (!c || c.organizationRevision !== args.revision) return;
    await ctx.db.patch(c._id, {
      organizationPending: false,
      sourcePinned: args.pinned,
      sourceArchived: args.archived,
    });
  },
});
