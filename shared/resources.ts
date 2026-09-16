export type Field = {
  key: string;
  label: string;
  type?: "text" | "password" | "number" | "boolean" | "textarea";
  required?: boolean;
};
export type Operation = {
  timeoutMs?: number;
  path: string;
  rpc?: string;
  rpcParams?: Record<string, unknown>;
  needsConversation?: boolean;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  fields?: Field[];
};
const text = (key: string, label: string, required = false): Field => ({
  key,
  label,
  required,
});
export const operations: Record<string, Operation> = {
  agentPlugins: {
    path: "",
    rpc: "plugins.manage",
    rpcParams: { action: "list" },
  },
  installPlugin: {
    path: "",
    method: "POST",
    rpc: "plugins.manage",
    rpcParams: { action: "install" },
    fields: [
      text("identifier", "Repository URL or plugin identifier", true),
      text("ref", "Revision (optional)"),
    ],
  },
  togglePlugin: {
    path: "",
    method: "POST",
    rpc: "plugins.manage",
    rpcParams: { action: "toggle" },
  },
  updatePlugin: {
    path: "",
    method: "POST",
    rpc: "plugins.manage",
    rpcParams: { action: "update" },
  },
  connectors: { path: "", rpc: "connectors.list", needsConversation: true },
  connectConnector: {
    path: "",
    method: "POST",
    rpc: "connectors.connect",
    needsConversation: true,
  },
  reconnectConnector: {
    path: "",
    method: "POST",
    rpc: "connectors.connect",
    needsConversation: true,
    rpcParams: { reconnect: true },
  },
  status: { path: "/api/status" },
  health: { path: "/api/health" },
  logs: { path: "/api/logs" },
  stats: { path: "/api/system/stats" },
  usage: { path: "/api/analytics/usage" },
  modelUsage: { path: "/api/analytics/models" },
  models: { path: "/api/model/options" },
  modelInfo: { path: "/api/model/info" },
  auxiliary: { path: "/api/model/auxiliary" },
  setModel: {
    path: "/api/model/set",
    method: "POST",
    fields: [text("model", "Model", true), text("provider", "Provider", true)],
  },
  setAuxModel: {
    path: "/api/model/set",
    method: "POST",
    fields: [
      text("task", "Helper task", true),
      text("provider", "Provider"),
      text("model", "Model"),
      text("base_url", "Inference URL (optional)"),
    ],
  },
  config: { path: "/api/config" },
  schema: { path: "/api/config/schema" },
  saveConfig: { path: "/api/config", method: "PUT" },
  moa: { path: "/api/model/moa" },
  saveMoa: { path: "/api/model/moa", method: "PUT" },
  endpoints: { path: "/api/providers/custom-endpoints" },
  saveEndpoint: {
    path: "/api/providers/custom-endpoints",
    method: "POST",
    fields: [
      text("id", "Identifier"),
      text("name", "Name", true),
      text("base_url", "Inference URL", true),
      text("model", "Model", true),
      { key: "api_key", label: "API key", type: "password" },
    ],
  },
  activateEndpoint: {
    path: "/api/providers/custom-endpoints/:id/activate",
    method: "POST",
  },
  deleteEndpoint: {
    path: "/api/providers/custom-endpoints/:id",
    method: "DELETE",
  },
  env: { path: "/api/env" },
  saveEnv: {
    path: "/api/env",
    method: "PUT",
    fields: [
      text("key", "Variable", true),
      { key: "value", label: "Value", type: "password", required: true },
    ],
  },
  deleteEnv: { path: "/api/env", method: "DELETE" },
  providers: { path: "/api/providers/oauth" },
  providerStart: { path: "/api/providers/oauth/:id/start", method: "POST" },
  providerCancel: {
    path: "/api/providers/oauth/sessions/:session",
    method: "DELETE",
  },
  providerPoll: { path: "/api/providers/oauth/:id/poll/:session" },
  providerDisconnect: { path: "/api/providers/oauth/:id", method: "DELETE" },
  profiles: { path: "/api/profiles" },
  profileRoster: {
    path: "",
    rpc: "profiles.list",
    rpcParams: { include_sessions: true },
  },
  profileAppearance: { path: "", rpc: "profiles.configure", method: "POST" },
  profileAvatar: {
    path: "",
    rpc: "profiles.get_asset",
    rpcParams: { asset: "avatar" },
  },
  saveProfileAvatar: {
    path: "",
    rpc: "profiles.set_asset",
    rpcParams: { asset: "avatar" },
    method: "POST",
  },
  createProfile: {
    path: "/api/profiles",
    method: "POST",
    fields: [
      text("name", "Name", true),
      text("clone_from", "Copy from profile"),
    ],
  },
  editProfile: {
    path: "/api/profiles/:id",
    method: "PATCH",
    fields: [text("new_name", "Name", true)],
  },
  deleteProfile: { path: "/api/profiles/:id", method: "DELETE" },
  soul: { path: "/api/profiles/:id/soul" },
  saveSoul: {
    path: "/api/profiles/:id/soul",
    method: "PUT",
    fields: [{ key: "content", label: "Instructions", type: "textarea" }],
  },
  profileModel: {
    path: "/api/profiles/:id/model",
    method: "PUT",
    fields: [text("model", "Model"), text("provider", "Provider")],
  },
  profileDescription: {
    path: "/api/profiles/:id/description",
    method: "PUT",
    fields: [text("description", "Description")],
  },
  jobs: { path: "/api/cron/jobs" },
  job: { path: "/api/cron/jobs/:id" },
  createJob: {
    path: "/api/cron/jobs",
    method: "POST",
    fields: [
      text("name", "Name", true),
      {
        key: "prompt",
        label: "Instructions",
        type: "textarea",
        required: true,
      },
      text("schedule", "Schedule", true),
      text("model", "Model"),
      text("deliver", "Delivery destination"),
    ],
  },
  saveJob: { path: "/api/cron/jobs/:id", method: "PUT" },
  pauseJob: { path: "/api/cron/jobs/:id/pause", method: "POST" },
  resumeJob: { path: "/api/cron/jobs/:id/resume", method: "POST" },
  runJob: { path: "/api/cron/jobs/:id/trigger", method: "POST" },
  deleteJob: { path: "/api/cron/jobs/:id", method: "DELETE" },
  jobRuns: { path: "/api/cron/jobs/:id/runs" },
  deliveryTargets: { path: "/api/cron/delivery-targets" },
  blueprints: { path: "/api/cron/blueprints" },
  useBlueprint: { path: "/api/cron/blueprints/instantiate", method: "POST" },
  skills: { path: "/api/skills" },
  skill: { path: "/api/skills/content" },
  saveSkill: { path: "/api/skills/content", method: "PUT" },
  toggleSkill: { path: "/api/skills/toggle", method: "PUT" },
  toolsets: { path: "/api/tools/toolsets" },
  toggleToolset: { path: "/api/tools/toolsets/:id", method: "PUT" },
  toolsetEnv: { path: "/api/tools/toolsets/:id/env", method: "PUT" },
  toolsetConfig: { path: "/api/tools/toolsets/:id/config" },
  toolsetModels: { path: "/api/tools/toolsets/:id/models" },
  toolsetModel: { path: "/api/tools/toolsets/:id/model", method: "PUT" },
  toolsetProvider: { path: "/api/tools/toolsets/:id/provider", method: "PUT" },
  mcp: { path: "/api/mcp/servers" },
  addMcp: {
    path: "/api/mcp/servers",
    method: "POST",
    fields: [
      text("name", "Name", true),
      text("command", "Host command"),
      text("url", "Server URL"),
      {
        key: "args",
        label: "Command arguments (one per line)",
        type: "textarea",
      },
      {
        key: "env",
        label: "Command environment (JSON object)",
        type: "textarea",
      },
      text("auth", "URL authentication: none, oauth, or header"),
      { key: "bearer_token", label: "Header bearer token", type: "password" },
    ],
  },
  reloadMcp: {
    path: "",
    method: "POST",
    rpc: "reload.mcp",
    timeoutMs: 60000,
    rpcParams: { confirm: true },
  },
  saveMcp: { path: "/api/mcp/servers", method: "PUT" },
  deleteMcp: { path: "/api/mcp/servers/:id", method: "DELETE" },
  testMcp: { path: "/api/mcp/servers/:id/test", method: "POST" },
  authMcp: { path: "/api/mcp/servers/:id/auth", method: "POST" },
  mcpAuthFlow: { path: "/api/mcp/oauth/flows/:id" },
  cancelMcpAuth: { path: "/api/mcp/oauth/flows/:id", method: "DELETE" },
  toggleMcp: { path: "/api/mcp/servers/:id/enabled", method: "PUT" },
  memory: { path: "/api/memory" },
  resetMemory: { path: "/api/memory/reset", method: "POST" },
  memoryProvider: { path: "/api/memory/provider", method: "PUT" },
  memoryConfig: { path: "/api/memory/providers/:id/config" },
  saveMemoryConfig: { path: "/api/memory/providers/:id/config", method: "PUT" },
  graph: { path: "/api/learning/graph" },
  graphNode: { path: "/api/learning/node" },
  deleteGraphNode: { path: "/api/learning/node", method: "DELETE" },
  saveGraphNode: { path: "/api/learning/node", method: "PUT" },
  curator: { path: "/api/curator" },
  pauseCurator: { path: "/api/curator/paused", method: "PUT" },
  runCurator: { path: "/api/curator/run", method: "POST" },
  platforms: { path: "/api/messaging/platforms" },
  savePlatform: { path: "/api/messaging/platforms/:id", method: "PUT" },
  testPlatform: { path: "/api/messaging/platforms/:id/test", method: "POST" },
  pairing: { path: "/api/pairing" },
  approvePairing: { path: "/api/pairing/approve", method: "POST" },
  revokePairing: { path: "/api/pairing/revoke", method: "POST" },
  webhooks: { path: "/api/webhooks" },
  createWebhook: {
    path: "/api/webhooks",
    method: "POST",
    fields: [
      text("name", "Name", true),
      { key: "prompt", label: "Instructions", type: "textarea" },
    ],
  },
  deleteWebhook: { path: "/api/webhooks/:id", method: "DELETE" },
  toggleWebhook: { path: "/api/webhooks/:id/enabled", method: "PUT" },
  enableWebhooks: { path: "/api/webhooks/enable", method: "POST" },
  media: { path: "/api/media" },
  backup: { path: "/api/ops/backup", method: "POST" },
  actionStatus: { path: "/api/actions/:id/status" },
  computer: { path: "/api/tools/computer-use/status" },
};
export const rpcAllowlist = new Set([
  "session.interrupt",
  "session.steer",
  "session.redirect",
  "session.branch",
  "session.control",
  "session.control.read",
  "session.usage",
  "session.context_breakdown",
  "approval.pending",
  "approval.received",
  "approval.respond",
  "clarify.respond",
  "connectors.list",
  "connectors.connect",
  "commands.catalog",
  "complete.slash",
  "command.dispatch",
  "slash.exec",
  "subagent.list",
  "subagent.tail",
  "subagent.steer",
  "subagent.interrupt",
  "model.options",
  "config.set",
  "config.get",
]);
export const rpcQueries = new Set([
  "commands.catalog",
  "complete.slash",
  "model.options",
  "session.usage",
  "session.context_breakdown",
  "session.control.read",
  "subagent.list",
  "subagent.tail",
  "approval.pending",
  "config.get",
]);
export function operationRequest(
  name: string,
  params: Record<string, unknown> = {},
) {
  const op = operations[name];
  if (!op) throw new Error("Unsupported action");
  let path = op.path.replace(/:([a-z_]+)/g, (_, key: string) => {
    const value = params[key];
    if (typeof value !== "string" || !value) throw new Error(`Missing ${key}`);
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!op.path.includes(`:${key}`) && value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  }
  if (query.size) path += `?${query}`;
  return { ...op, path, method: op.method ?? "GET" };
}
