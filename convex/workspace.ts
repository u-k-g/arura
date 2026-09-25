import { anyApi } from "convex/server";
import { v } from "convex/values";
import { incomingOrganization } from "../shared/organization.ts";
import { conversationReadActivity, shouldArchive } from "../shared/model.ts";
import {
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server.ts";
import { adapter, device } from "./access.ts";
import { resolveKey } from "./conversationKeys.ts";
import { essentialIcons } from "../shared/essentialIcons.ts";
import {
  deleteHistoryChunks,
  historyChunks,
  readHistoryChunks,
} from "./historyPages.ts";

const section = v.union(
  v.literal("essential"),
  v.literal("pinned"),
  v.literal("recent"),
  v.literal("archived"),
);
const sharedReadDevice = "__shared__";
export const runtimeView = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    return (
      (
        await ctx.db
          .query("runtimeViews")
          .withIndex("key", (q) => q.eq("key", args.key))
          .unique()
      )?.value ?? null
    );
  },
});
export const saveRuntimeView = mutation({
  args: { key: v.string(), conversation: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    await adapter(ctx);
    const old = await ctx.db
      .query("runtimeViews")
      .withIndex("key", (q) => q.eq("key", args.key))
      .unique();
    if (old && JSON.stringify(old.value) === JSON.stringify(args.value)) return;
    if (old) await ctx.db.patch(old._id, args);
    else await ctx.db.insert("runtimeViews", args);
  },
});
export const sourceKeys = query({
  args: {},
  handler: async (ctx) => {
    await adapter(ctx);
    return (await ctx.db.query("conversations").collect())
      .filter((c) => !c.deleted && !c.pendingPersistence)
      .map((c) => c.key);
  },
});
// Conversations that predate message-derived activity; the server backfills a
// history page so sidebar ages ignore non-message rows like model switches.
export const activityBacklog = query({
  args: {},
  handler: async (ctx) => {
    await adapter(ctx);
    return (await ctx.db.query("conversations").collect())
      .filter(
        (c) =>
          !c.deleted &&
          !c.backgroundSession &&
          c.messageActivityAt === undefined,
      )
      .map((c) => c.key);
  },
});
// New gateway sessions are live before Hermes writes their first history row.
export const runningTurns = query({
  args: {},
  handler: async (ctx) => {
    await adapter(ctx);
    return (await ctx.db.query("turns").collect())
      .map((row) => row.data)
      .filter((turn) => turn.state === "running");
  },
});
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
    const [allReads, devices] = await Promise.all([
      ctx.db.query("conversationReads").collect(),
      ctx.db.query("devices").collect(),
    ]);
    const reads = new Map<string, (typeof allReads)[number]>();
    for (const read of allReads) {
      const previous = reads.get(read.key);
      if (
        !previous ||
        read.device === sharedReadDevice ||
        (previous.device !== sharedReadDevice &&
          read.activityAt > previous.activityAt)
      ) reads.set(read.key, read);
    }
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
      .filter((q) => q.neq(q.field("backgroundSession"), true))
      .filter((q) => q.neq(q.field("deleted"), true))
      .paginate({ cursor: null, numItems: 100 });
    const settings = Object.fromEntries(
      (await ctx.db.query("settings").collect()).map((x) => [x.key, x.value]),
    );
    return {
      deviceId: self.id,
      readBaseline: Math.min(...devices.map((row) => row.createdAt)),
      reads: [...reads.values()],
      conversations: [...pinned, ...recent.page],
      recentCursor: recent.continueCursor,
      recentHasMore: !recent.isDone,
      drafts: await ctx.db.query("drafts").collect(),
      folders: (await ctx.db.query("folders").collect()).sort(
        (a, b) => a.rank - b.rank,
      ),
      settings,
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
      .filter((q) => q.neq(q.field("backgroundSession"), true))
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
      .filter((q) => q.neq(q.field("backgroundSession"), true))
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
async function transcriptPages(
  ctx: QueryCtx,
  conversation: string,
  pages: number,
) {
  if (!Number.isSafeInteger(pages) || pages < 1) {
    throw new Error("Invalid history page count");
  }
  return await Promise.all(
    (
      await ctx.db
        .query("pages")
        .withIndex("page", (q) => q.eq("conversation", conversation))
        .take(pages)
    ).map(async (page) => ({
      ...page,
      messages: page.chunked
        ? await readHistoryChunks(ctx, page._id)
        : page.messages,
    })),
  );
}
async function transcriptActivity(ctx: QueryCtx, conversation: string) {
  const recent = await ctx.db
    .query("commands")
    .withIndex("conversation", (q) => q.eq("conversation", conversation))
    .order("desc")
    .take(30);
  const queued = await ctx.db
    .query("commands")
    .withIndex(
      "pending",
      (q) => q.eq("conversation", conversation).eq("status", "queued"),
    )
    .collect();
  return {
    turn: (
      await ctx.db
        .query("turns")
        .withIndex(
          "conversation",
          (q) => q.eq("conversation", conversation),
        )
        .unique()
    )?.data ?? null,
    commands: [
      ...queued,
      ...recent.filter((command) => command.status !== "queued"),
    ],
  };
}
export const history = query({
  args: { conversation: v.string(), pages: v.number() },
  handler: async (ctx, args) => {
    await device(ctx);
    const conversation = await resolveKey(ctx, args.conversation);
    return await transcriptPages(ctx, conversation, args.pages);
  },
});
export const activity = query({
  args: { conversation: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    const conversation = await resolveKey(ctx, args.conversation);
    return await transcriptActivity(ctx, conversation);
  },
});
// Retained for clients still using the combined shape.
export const transcript = query({
  args: { conversation: v.string(), pages: v.number() },
  handler: async (ctx, args) => {
    await device(ctx);
    const conversation = await resolveKey(ctx, args.conversation);
    const [pages, activity] = await Promise.all([
      transcriptPages(ctx, conversation, args.pages),
      transcriptActivity(ctx, conversation),
    ]);
    return { pages, ...activity };
  },
});
export const markRead = mutation({
  args: { key: v.string(), unread: v.boolean() },
  handler: async (ctx, args) => {
    await device(ctx);
    const key = await resolveKey(ctx, args.key);
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("key", (q) => q.eq("key", key))
      .unique();
    if (!conversation) return;
    const old = await ctx.db
      .query("conversationReads")
      .withIndex(
        "device",
        (q) => q.eq("device", sharedReadDevice).eq("key", key),
      )
      .unique();
    const value = {
      device: sharedReadDevice,
      key,
      activityAt: conversationReadActivity(conversation),
      unread: args.unread,
    };
    if (
      old &&
      old.activityAt === value.activityAt &&
      old.unread === value.unread
    ) {
      return;
    }
    if (old) await ctx.db.patch(old._id, value);
    else await ctx.db.insert("conversationReads", value);
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
export const setEssentialIcon = mutation({
  args: { key: v.string(), icon: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    if (!essentialIcons.some(([icon]) => icon === args.icon)) {
      throw new Error("Choose an icon from the picker");
    }
    const key = await resolveKey(ctx, args.key);
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("key", (q) => q.eq("key", key))
      .unique();
    if (!conversation || conversation.deleted) {
      throw new Error("Conversation not found");
    }
    await ctx.db.patch(conversation._id, { essentialIcon: args.icon });
  },
});
export const saveDraft = mutation({
  args: { profile: v.string(), key: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    const existing = await ctx.db
      .query("drafts")
      .withIndex(
        "profile",
        (q) => q.eq("profile", args.profile).eq("key", args.key),
      )
      .unique();
    if (!args.text.trim()) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    if (existing) {
      if (existing.text === args.text) return;
      await ctx.db.patch(existing._id, {
        text: args.text,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("drafts", {
        profile: args.profile,
        key: args.key,
        text: args.text,
        updatedAt: Date.now(),
      });
    }
  },
});
export const folder = mutation({
  args: {
    id: v.optional(v.id("folders")),
    name: v.optional(v.string()),
    remove: v.optional(v.boolean()),
    conversationKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await device(ctx);
    if (args.conversationKey && (args.id || args.remove)) {
      throw new Error("Create a new folder to move a conversation");
    }
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
    if (args.id) {
      await ctx.db.patch(args.id, { name });
      return args.id;
    }
    const key = args.conversationKey
      ? await resolveKey(ctx, args.conversationKey)
      : undefined;
    const conversation = key
      ? await ctx.db.query("conversations")
        .withIndex("key", (q) => q.eq("key", key)).unique()
      : undefined;
    if (key && (!conversation || conversation.deleted)) {
      throw new Error("Conversation not found");
    }
    const id = await ctx.db.insert("folders", { name, rank: Date.now() });
    if (conversation) {
      await ctx.db.patch(conversation._id, {
        organizationPending: true,
        organizationRevision: (conversation.organizationRevision ?? 0) + 1,
        section: "pinned",
        folderId: id,
        rank: Date.now(),
        archivedAt: undefined,
        unarchivedAt: conversation.section === "archived"
          ? Date.now()
          : conversation.unarchivedAt,
      });
    }
    return id;
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
export const dismissError = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    if (!args.id || args.id.length > 512) throw new Error("Invalid error ID");
    const key = "dismissedErrors";
    const old = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", key))
      .unique();
    const ids: string[] = Array.isArray(old?.value) ? old.value : [];
    if (ids.includes(args.id)) return;
    const value = [...ids, args.id];
    if (old) await ctx.db.patch(old._id, { value });
    else await ctx.db.insert("settings", { key, value });
  },
});
export const setting = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    await device(ctx);
    if (!["modelFavorites", "appearance", "chatModel"].includes(args.key)) {
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
export const modelFavorite = mutation({
  args: { model: v.string(), starred: v.boolean() },
  handler: async (ctx, args) => {
    await device(ctx);
    if (!args.model || args.model.length > 1024) {
      throw new Error("Invalid model");
    }
    const old = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", "modelFavorites"))
      .unique();
    const starred = new Set<string>(Array.isArray(old?.value) ? old.value : []);
    if (args.starred) starred.add(args.model);
    else starred.delete(args.model);
    const value = [...starred];
    if (old) await ctx.db.patch(old._id, { value });
    else await ctx.db.insert("settings", { key: "modelFavorites", value });
  },
});
export const modelEffort = mutation({
  args: { model: v.string(), effort: v.string() },
  handler: async (ctx, args) => {
    await device(ctx);
    if (!args.model || args.model.length > 1024) {
      throw new Error("Invalid model");
    }
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(args.effort)) {
      throw new Error("Invalid reasoning effort");
    }
    const key = "modelEfforts";
    const old = await ctx.db
      .query("settings")
      .withIndex("key", (q) => q.eq("key", key))
      .unique();
    const current = old?.value && typeof old.value === "object" &&
        !Array.isArray(old.value)
      ? old.value as Record<string, string>
      : {};
    if (current[args.model] === args.effort) return;
    const value = { ...current, [args.model]: args.effort };
    if (old) await ctx.db.patch(old._id, { value });
    else await ctx.db.insert("settings", { key, value });
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
        shouldArchive(c, Number(pref?.value ?? 14), Date.now())
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
    idleTurn: v.optional(
      v.object({ conversation: v.string(), startedAt: v.number() }),
    ),
    online: v.optional(v.boolean()),
    error: v.optional(v.string()),
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
        source: String(input.source ?? old?.source ?? ""),
        backgroundSession: ["cron", "kanban", "subagent", "tool"].includes(
          String(input.source ?? old?.source ?? "")
            .trim()
            .toLowerCase(),
        ),
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
          if (stale.offset !== 0) {
            await deleteHistoryChunks(ctx, stale._id);
            await ctx.db.delete(stale._id);
          }
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
      // Reconnects and background reconciliation often read the same page.
      // Avoid rewriting megabytes of unchanged tool output on every refresh.
      if (
        !old ||
        !p.revision ||
        old.revision !== p.revision ||
        old.hasMore !== Boolean(p.hasMore)
      ) {
        const chunks = historyChunks(p.messages);
        const chunked = chunks.length > 1;
        const value = {
          revision: p.revision,
          conversation: String(p.conversation),
          offset: Number(p.offset),
          messages: chunked ? [] : p.messages,
          chunked,
          hasMore: Boolean(p.hasMore),
          updatedAt: Date.now(),
        };
        if (old) {
          await deleteHistoryChunks(ctx, old._id);
          await ctx.db.patch(old._id, value);
        }
        const pageId = old?._id ?? (await ctx.db.insert("pages", value));
        if (chunked) {
          for (const [index, content] of chunks.entries()) {
            await ctx.db.insert("pageChunks", { page: pageId, index, content });
          }
        }
      }
      if (p.offset === 0) {
        const messages: { createdAt?: unknown }[] = Array.isArray(p.messages)
          ? p.messages
          : [];
        const newest = messages.reduce(
          (max, message) => Math.max(max, Number(message?.createdAt) || 0),
          0,
        );
        const conversation = await ctx.db
          .query("conversations")
          .withIndex("key", (q) => q.eq("key", String(p.conversation)))
          .unique();
        const resolved = newest || conversation?.activityAt;
        if (conversation && resolved !== conversation.messageActivityAt) {
          await ctx.db.patch(conversation._id, {
            messageActivityAt: resolved,
          });
        }
      }
    }
    if (args.idleTurn) {
      const { conversation, startedAt } = args.idleTurn;
      const old = await ctx.db
        .query("turns")
        .withIndex("conversation", (q) => q.eq("conversation", conversation))
        .unique();
      // Do not erase a newer run that arrived while the idle snapshot was saving.
      if (old?.data.state === "running" && old.data.startedAt === startedAt) {
        await ctx.db.delete(old._id);
        const row = await ctx.db
          .query("conversations")
          .withIndex("key", (q) => q.eq("key", conversation))
          .unique();
        if (row) {
          await ctx.db.patch(row._id, { running: false, pendingInput: false });
        }
      }
    }
    if (args.turn) {
      const t = args.turn;
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
      drafts: await ctx.db.query("drafts").collect(),
      folders: await ctx.db.query("folders").collect(),
      conversationReads: await ctx.db.query("conversationReads").collect(),
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
