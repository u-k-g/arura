import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  conversationReads: defineTable({
    device: v.string(),
    key: v.string(),
    activityAt: v.number(),
    unread: v.boolean(),
  })
    .index("device", ["device", "key"])
    .index("key", ["key"]),
  runtimeViews: defineTable({
    key: v.string(),
    conversation: v.string(),
    value: v.any(),
  }).index("key", ["key"]),
  backups: defineTable({
    status: v.union(
      v.literal("starting"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("error"),
    ),
    archive: v.optional(v.string()),
    pid: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  devices: defineTable({
    id: v.string(),
    secretHash: v.string(),
    name: v.string(),
    createdAt: v.number(),
    lastSeen: v.number(),
    revoked: v.boolean(),
  })
    .index("id", ["id"])
    .index("secret", ["secretHash"]),
  invites: defineTable({
    hash: v.string(),
    expiresAt: v.number(),
    createdBy: v.string(),
    used: v.boolean(),
  }).index("hash", ["hash"]),
  profileRenames: defineTable({ from: v.string(), to: v.string() }).index(
    "from",
    ["from"],
  ),
  conversationAliases: defineTable({ key: v.string(), target: v.string() })
    .index("key", ["key"])
    .index("target", ["target"]),
  drafts: defineTable({
    profile: v.string(),
    key: v.string(),
    text: v.string(),
    updatedAt: v.number(),
  }).index("profile", ["profile", "key"]),
  conversations: defineTable({
    key: v.string(),
    profile: v.string(),
    bot: v.optional(v.boolean()),
    essentialIcon: v.optional(v.string()),
    sourceId: v.string(),
    source: v.optional(v.string()),
    backgroundSession: v.optional(v.boolean()),
    pendingPersistence: v.optional(v.boolean()),
    title: v.string(),
    activityAt: v.number(),
    messageActivityAt: v.optional(v.number()),
    section: v.union(
      v.literal("essential"),
      v.literal("pinned"),
      v.literal("recent"),
      v.literal("archived"),
    ),
    folderId: v.optional(v.id("folders")),
    rank: v.number(),
    sourcePinned: v.optional(v.boolean()),
    sourceArchived: v.optional(v.boolean()),
    organizationRevision: v.optional(v.number()),
    organizationPending: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    unarchivedAt: v.optional(v.number()),
    running: v.boolean(),
    pendingInput: v.boolean(),
    deleted: v.optional(v.boolean()),
  })
    .index("key", ["key"])
    .index("organizationPending", ["organizationPending"])
    .index("section", ["section", "rank"])
    .index("profile", ["profile"])
    .index("activity", ["section", "activityAt"])
    .index("archive", ["section", "archivedAt"]),
  folders: defineTable({ name: v.string(), rank: v.number() }),
  artifacts: defineTable({
    conversation: v.string(),
    path: v.string(),
    name: v.string(),
    messageId: v.string(),
    scan: v.number(),
    activityAt: v.number(),
  })
    .index("file", ["conversation", "path"])
    .index("conversation", ["conversation"])
    .index("recent", ["activityAt"])
    .searchIndex("search", { searchField: "name" }),
  artifactScans: defineTable({
    conversation: v.string(),
    activityAt: v.number(),
    scan: v.number(),
    offset: v.number(),
    complete: v.boolean(),
    retryAt: v.number(),
    error: v.optional(v.string()),
  })
    .index("conversation", ["conversation"])
    .index("pending", ["complete", "retryAt"]),
  pages: defineTable({
    conversation: v.string(),
    offset: v.number(),
    messages: v.array(v.any()),
    revision: v.optional(v.string()),
    hasMore: v.boolean(),
    updatedAt: v.number(),
  }).index("page", ["conversation", "offset"]),
  turns: defineTable({ conversation: v.string(), data: v.any() }).index(
    "conversation",
    ["conversation"],
  ),
  commands: defineTable({
    id: v.string(),
    device: v.string(),
    conversation: v.string(),
    kind: v.string(),
    payload: v.any(),
    status: v.union(
      v.literal("queued"),
      v.literal("dispatching"),
      v.literal("accepted"),
      v.literal("complete"),
      v.literal("error"),
      v.literal("unknown"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    error: v.optional(v.string()),
    result: v.optional(v.any()),
  })
    .index("id", ["id"])
    .index("status", ["status", "createdAt"])
    .index("pending", ["conversation", "status", "createdAt"])
    .index("conversation", ["conversation", "createdAt"]),
  settings: defineTable({ key: v.string(), value: v.any() }).index("key", [
    "key",
  ]),
  connection: defineTable({
    key: v.string(),
    online: v.boolean(),
    error: v.optional(v.string()),
    updatedAt: v.number(),
    revision: v.number(),
  }).index("key", ["key"]),
});
