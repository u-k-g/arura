import { confirmAction, rejectAction } from "./ActionDialog.tsx";
type ResourceField = {
  key: string;
  label?: string;
  prompt?: string;
  value?: unknown;
  kind?: string;
  is_set?: boolean;
  required?: boolean;
};
type ResourceRow = Record<string, unknown> & {
  id?: string;
  name?: string;
  key?: string;
  title?: string;
  path?: string;
  description?: string;
  display_name?: string;
  platform?: string;
  user_id?: string;
  slug?: string;
  status?: string;
  type?: string;
  kind?: string;
  enabled?: boolean;
  is_dir?: boolean;
  is_directory?: boolean;
  has_avatar?: boolean;
  accessStatus?: string;
  scheduleHuman?: string;
  ui_meta?: Record<string, { title?: string; imageKind?: string }>;
  ui_meta_revisions?: Record<string, number>;
  fields?: ResourceField[];
  env_vars?: ResourceField[];
};
type ResourceData = Record<string, unknown> & {
  config?: Record<string, unknown>;
  enabled?: boolean;
  paused?: boolean;
  pending?: Record<string, unknown>[];
  approved?: Record<string, unknown>[];
};
type ToolConfig = {
  id: string;
  name: string;
  providers?: {
    name: string;
    requires_nous_auth?: boolean;
    is_active?: boolean;
    status?: string;
    capabilities?: string[];
    env_vars?: ResourceField[];
  }[];
};
import { record } from "../shared/contracts.ts";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  lazy,
  onCleanup,
  Show,
} from "solid-js";
import {
  inform,
  resource,
  revision,
  scheduleDraft,
  setScheduleDraft,
  workspace,
} from "./client.ts";
import { draft, preferences } from "./cache.ts";
import { type Field as FormField, operations } from "../shared/resources.ts";
import { Dialog, Empty, Field, Icon, IconButton, run } from "./ui.tsx";
import {
  configPatch,
  editableJob,
  endpointBody,
  jobPatch,
  mcpBody,
  pairingRows,
  platformBody,
} from "../shared/resource-forms.ts";
const JobHistory = lazy(() => import("./JobHistory.tsx"));
const ProfileAvatar = lazy(() => import("./ProfileAvatar.tsx"));
const RuntimeSettings = lazy(() => import("./RuntimeSettings.tsx"));
const MixtureModels = lazy(() => import("./MixtureModels.tsx"));
const MemoryGraph = lazy(() => import("./MemoryGraph.tsx"));
const FallbackModels = lazy(() => import("./FallbackModels.tsx"));
const ProviderAccess = lazy(() => import("./ProviderAccess.tsx"));
const FileEditor = lazy(() => import("./FileEditor.tsx"));
const Backups = lazy(() => import("./Backups.tsx"));
type Blueprint = {
  key: string;
  title: string;
  description: string;
  scheduleHuman: string;
  fields: {
    name: string;
    type: string;
    label: string;
    default: unknown;
    options: string[];
    optional: boolean;
    strict: boolean;
    help: string;
  }[];
};

const human = (s: string) =>
  s
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (x) => x.toUpperCase());
type Surface = {
  title: string;
  read: string;
  create?: string;
  list?: string[];
  actions?: [string, string][];
};
const surfaces: Record<string, Surface> = {
  agentPlugins: {
    title: "Agent plugins",
    read: "agentPlugins",
    create: "installPlugin",
    list: ["plugins"],
    actions: [
      ["Enable / disable", "togglePlugin"],
      ["Update", "updatePlugin"],
    ],
  },
  connectors: {
    title: "App connections",
    read: "connectors",
    list: ["connectors"],
    actions: [
      ["Connect", "connectConnector"],
      ["Reconnect", "reconnectConnector"],
    ],
  },
  profiles: {
    title: "Profiles & bots",
    read: "profileRoster",
    create: "createProfile",
    list: ["profiles"],
    actions: [
      ["Appearance", "botAppearance"],
      ["Avatar", "botAvatar"],
      ["Description", "profileDescription"],
      ["Instructions", "soul"],
      ["Model", "profileModel"],
      ["Rename", "editProfile"],
      ["Delete", "deleteProfile"],
    ],
  },
  jobs: {
    title: "Schedules",
    read: "jobs",
    create: "createJob",
    list: ["jobs"],
    actions: [
      ["Run now", "runJob"],
      ["Pause", "pauseJob"],
      ["Resume", "resumeJob"],
      ["Run history", "jobRuns"],
      ["Edit", "saveJob"],
      ["Delete", "deleteJob"],
    ],
  },
  skills: {
    title: "Installed skills",
    read: "skills",
    list: ["skills"],
    actions: [
      ["Read / edit", "skill"],
      ["Enable or disable", "toggleSkill"],
    ],
  },
  toolsets: {
    title: "Tools",
    read: "toolsets",
    list: ["toolsets"],
    actions: [
      ["Configure", "toolsetConfig"],
      ["Enable or disable", "toggleToolset"],
    ],
  },
  mcp: {
    title: "MCP servers",
    read: "mcp",
    create: "addMcp",
    list: ["servers"],
    actions: [
      ["Test connection", "testMcp"],
      ["Authorize", "authMcp"],
      ["Enable or disable", "toggleMcp"],
      ["Remove", "deleteMcp"],
    ],
  },
  platforms: {
    title: "Messaging",
    read: "platforms",
    list: ["platforms"],
    actions: [
      ["Configure", "savePlatform"],
      ["Test", "testPlatform"],
    ],
  },
  pairing: {
    title: "Messaging access",
    read: "pairing",
    list: ["pending", "approved"],
    actions: [
      ["Approve", "approvePairing"],
      ["Revoke", "revokePairing"],
    ],
  },
  webhooks: {
    title: "Incoming triggers",
    read: "webhooks",
    create: "createWebhook",
    list: ["subscriptions"],
    actions: [
      ["Enable or disable", "toggleWebhook"],
      ["Delete", "deleteWebhook"],
    ],
  },
  endpoints: {
    title: "Custom inference endpoints",
    read: "endpoints",
    create: "saveEndpoint",
    list: ["endpoints"],
    actions: [
      ["Use endpoint", "activateEndpoint"],
      ["Delete", "deleteEndpoint"],
    ],
  },
  env: {
    title: "Provider credentials",
    read: "env",
    create: "saveEnv",
    actions: [["Remove", "deleteEnv"]],
  },
  models: { title: "Models & providers", read: "modelInfo" },
  auxiliary: {
    title: "Auxiliary models",
    read: "auxiliary",
    list: ["tasks"],
    actions: [["Change model", "setAuxModel"]],
  },
  fallbacks: { title: "Fallback models", read: "modelInfo" },
  moa: { title: "Mixture of Agents", read: "moa" },
  advanced: { title: "Advanced settings", read: "config" },
  computer: { title: "Computer use", read: "computer" },
  delegation: { title: "Delegated work", read: "config" },
  resources: { title: "Backend resources", read: "config" },
  memory: {
    title: "Memory",
    read: "memory",
    list: ["providers"],
    actions: [
      ["Configure", "memoryConfig"],
      ["Use provider", "memoryProvider"],
    ],
  },
  graph: { title: "Memory graph", read: "graph" },
  curator: { title: "Skill curator", read: "curator" },
  usage: { title: "Usage", read: "usage" },
  status: { title: "Status & logs", read: "status" },
  files: { title: "Files on your host", read: "files" },
  artifacts: { title: "Generated files", read: "artifacts" },
  backup: { title: "Backups", read: "health" },
};
const dataRows = (data: unknown, keys: string[] = []): ResourceRow[] => {
  const object = record(data);
  if (Array.isArray(data)) return data as ResourceRow[];
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key] as ResourceRow[];
    if (object[key] && typeof object[key] === "object") {
      return dataRows(object[key]);
    }
  }
  if (data && typeof data === "object") {
    return Object.entries(data).map(([name, value]) =>
      typeof value === "object" && value !== null
        ? { name, ...value }
        : { name, value }
    );
  }
  return [];
};

function Scalar(props: { value: unknown }) {
  const link = () => {
    if (typeof props.value !== "string") return undefined;
    try {
      const url = new URL(props.value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
    } catch {
      return undefined;
    }
  };
  return (
    <Show when={link()} fallback={<span>{String(props.value ?? "—")}</span>}>
      {(href) => (
        <a href={href()} target="_blank" rel="noreferrer">
          {String(props.value)}
        </a>
      )}
    </Show>
  );
}
function Value(props: { value: unknown }) {
  return (
    <Show
      when={typeof props.value === "object" && props.value !== null}
      fallback={<Scalar value={props.value} />}
    >
      <dl class="data-details">
        <For each={Object.entries(props.value ?? {})}>
          {([key, value]) => (
            <Show
              when={!/^(?:token|access_token|refresh_token|secret|password|api_key|reasoning(?:_text|_content|_delta)?|thinking)$/i
                .test(
                  key,
                )}
            >
              <div>
                <dt>{human(key)}</dt>
                <dd>
                  <Show
                    when={typeof value === "object"}
                    fallback={<Scalar value={value} />}
                  >
                    <details>
                      <summary>
                        {Array.isArray(value)
                          ? `${value.length} items`
                          : "Details"}
                      </summary>
                      <Value value={value} />
                    </details>
                  </Show>
                </dd>
              </div>
            </Show>
          )}
        </For>
      </dl>
    </Show>
  );
}
function Editor(props: {
  value: Record<string, unknown>;
  change: (value: Record<string, unknown>) => void;
  prefix?: string;
}) {
  return (
    <div class="form-fields">
      <For each={Object.keys(props.value ?? {})}>
        {(key) => {
          const value = () => props.value[key];
          const update = (next: unknown) =>
            props.change({ ...props.value, [key]: next });
          const hidden = [
            "terminal",
            "browser",
            "wake_word",
            "voice",
            "local_models",
            "ssh",
            "cloud",
            "billing",
            "image_gen",
            "image_generation",
            "tts",
            "stt",
            "hud",
            "pets",
            "radio",
            "checkpoints",
            "docker",
            "modal",
            "daytona",
            "browser_profiles",
          ].includes(key);
          return (
            <Show when={!hidden}>
              <Show
                when={value() !== null &&
                  typeof value() === "object" &&
                  !Array.isArray(value())}
                fallback={
                  <Field label={human(key)}>
                    <Show
                      when={Array.isArray(value())}
                      fallback={
                        <Show
                          when={typeof value() === "boolean"}
                          fallback={
                            <input
                              type={/key|secret|password|token/i.test(key)
                                ? "password"
                                : typeof value() === "number"
                                ? "number"
                                : "text"}
                              value={String(value() ?? "")}
                              onInput={(e) =>
                                update(
                                  typeof value() === "number"
                                    ? Number(e.currentTarget.value)
                                    : e.currentTarget.value,
                                )}
                            />
                          }
                        >
                          <input
                            type="checkbox"
                            checked={value() === true}
                            onChange={(e) => update(e.currentTarget.checked)}
                          />
                        </Show>
                      }
                    >
                      <div class="structured-list">
                        <For each={value() as unknown[]}>
                          {(item, index) => (
                            <div class="structured-list-item">
                              <Show
                                when={item !== null && typeof item === "object"}
                                fallback={
                                  <input
                                    aria-label={`${human(key)} item ${
                                      index() + 1
                                    }`}
                                    type={typeof item === "number"
                                      ? "number"
                                      : "text"}
                                    value={String(item ?? "")}
                                    onChange={(event) => {
                                      const next = [...(value() as unknown[])];
                                      next[index()] = typeof item === "number"
                                        ? Number(event.currentTarget.value)
                                        : typeof item === "boolean"
                                        ? event.currentTarget.value ===
                                          "true"
                                        : event.currentTarget.value;
                                      update(next);
                                    }}
                                  />
                                }
                              >
                                <Editor
                                  value={Array.isArray(item)
                                    ? { items: item }
                                    : record(item)}
                                  change={(entry) => {
                                    const next = [...(value() as unknown[])];
                                    next[index()] = Array.isArray(item)
                                      ? entry.items
                                      : entry;
                                    update(next);
                                  }}
                                />
                              </Show>
                              <button
                                type="button"
                                onClick={() =>
                                  update(
                                    (value() as unknown[]).filter(
                                      (_, i) => i !== index(),
                                    ),
                                  )}
                              >
                                Remove item
                              </button>
                            </div>
                          )}
                        </For>
                        <button
                          type="button"
                          onClick={() => {
                            const rows = value() as unknown[],
                              first = rows[0];
                            const empty = (item: unknown): unknown =>
                              Array.isArray(item)
                                ? []
                                : item !== null && typeof item === "object"
                                ? Object.fromEntries(
                                  Object.entries(item).map(
                                    ([key, value]) => [key, empty(value)],
                                  ),
                                )
                                : typeof item === "number"
                                ? 0
                                : typeof item === "boolean"
                                ? false
                                : "";
                            const entry = empty(first);
                            update([...rows, entry]);
                          }}
                        >
                          Add item
                        </button>
                      </div>
                    </Show>
                  </Field>
                }
              >
                <details class="config-section">
                  <summary>{human(key)}</summary>
                  <Editor
                    value={record(value())}
                    change={update}
                    prefix={(props.prefix ? props.prefix + "." : "") + key}
                  />
                </details>
              </Show>
            </Show>
          );
        }}
      </For>
    </div>
  );
}
export default function Resources(props: {
  name: string;
  initialPath?: string;
  navigate: (view: string) => void;
  newChat: (profile?: string) => Promise<void>;
}) {
  const scoped = () =>
    ["skills", "toolsets", "mcp", "jobs"].includes(props.name);
  const [resourceProfile, setResourceProfile] = createSignal("default");
  const [profiles, setProfiles] = createSignal<string[]>(["default"]);
  createEffect(() => {
    if (!scoped()) return;
    let disposed = false;
    void resource("profileRoster")
      .then((value) => {
        if (!disposed) {
          setProfiles(
            (value.profiles ?? []).map((p: { name: string }) => p.name),
          );
        }
      })
      .catch(() => {
        /* The default profile remains usable if the roster is unavailable. */
      });
    onCleanup(() => {
      disposed = true;
    });
  });
  const [blueprints, setBlueprints] = createSignal<Blueprint[] | undefined>();
  const [blueprint, setBlueprint] = createSignal<Blueprint>();
  const [blueprintValues, setBlueprintValues] = createSignal<
    Record<string, unknown>
  >({});
  const [creatingBlueprint, setCreatingBlueprint] = createSignal(false);
  const surface = () =>
    surfaces[props.name] ?? { title: human(props.name), read: props.name };
  const [data, setData] = createSignal<ResourceData>(),
    [loading, setLoading] = createSignal(false),
    [error, setError] = createSignal(""),
    [filter, setFilter] = createSignal("");
  const [connectionConversation, setConnectionConversation] = createSignal(
    preferences.getItem("arura.lastConversation") ?? "",
  );
  const [path, setPath] = createSignal(props.initialPath ?? ""),
    [file, setFile] = createSignal<
      {
        path: string;
        content: string;
        readOnly?: boolean;
      } | null
    >(null),
    [dirty, setDirty] = createSignal(false);
  const [original, setOriginal] = createSignal("");
  const [webhookSecret, setWebhookSecret] = createSignal<{
    name: string;
    url: string;
    secret: string;
  }>();
  const [fileChanged, setFileChanged] = createSignal(false);
  const filePath = createMemo(() => file()?.path);
  createEffect(() => {
    const target = filePath();
    revision();
    if (!target) return;
    void resource("file", { path: target })
      .then((result) => {
        if (file()?.path !== target) return;
        if (result.binary) {
          throw new Error(
            "This is now a binary file. Use Open with browser or Download.",
          );
        }
        const content = result.content ?? result.text ?? "";
        const readOnly = Boolean(
          result.truncated || content.includes("\uFFFD"),
        );
        if (dirty()) setFileChanged(content !== original());
        else {
          setFile({ path: target, content, readOnly });
          setOriginal(content);
          setFileChanged(false);
        }
      })
      .catch((error) => inform(error.message));
  });
  const [mcpFlow, setMcpFlow] = createSignal<{
    flow_id: string;
    server_name: string;
    status: string;
    authorization_url?: string;
    error?: string;
  }>();
  createEffect(() => {
    const flow = mcpFlow();
    if (!flow || ["approved", "error"].includes(flow.status)) return;
    let disposed = false,
      busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await resource("mcpAuthFlow", { id: flow.flow_id });
        if (!disposed) setMcpFlow(next);
      } catch (error) {
        if (!disposed) {
          setMcpFlow({
            ...flow,
            status: "error",
            error: (error as Error).message,
          });
        }
      } finally {
        busy = false;
      }
    }, 2000);
    onCleanup(() => {
      disposed = true;
      clearInterval(timer);
    });
  });
  async function closeMcpFlow() {
    const flow = mcpFlow();
    if (flow && !["approved", "error"].includes(flow.status)) {
      await resource("cancelMcpAuth", { id: flow.flow_id }, {});
    }
    setMcpFlow(undefined);
  }
  const [toolConfig, setToolConfig] = createSignal<ToolConfig>();
  const [avatarEditor, setAvatarEditor] = createSignal<{
    name: string;
    data?: string;
  }>();
  async function avatarKind(name: string, imageKind: "photo" | "shape") {
    const roster = await resource("profileRoster");
    const profile = roster.profiles?.find(
      (profile: { name: string }) => profile.name === name,
    );
    if (!profile) throw new Error("Profile is no longer available");
    const result = await resource(
      "profileAppearance",
      {},
      {
        name,
        ui_meta: {
          "hermes-bots": {
            ...profile.ui_meta?.["hermes-bots"],
            imageKind,
            custom: true,
          },
        },
        ui_meta_expected_revisions: {
          "hermes-bots": profile.ui_meta_revisions?.["hermes-bots"] ?? 0,
        },
      },
    );
    if (result.applied?.ui_meta !== true) {
      throw new Error(
        "Appearance changed elsewhere. Reopen the avatar editor and try again.",
      );
    }
  }
  async function avatarUpload(file?: File) {
    const profile = avatarEditor();
    if (!file || !profile) return;
    if (
      file.size > 2_000_000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      throw new Error("Choose a PNG, JPEG, or WebP image smaller than 2 MB.");
    }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read this image"));
      reader.readAsDataURL(file);
    });
    const result = await resource(
      "saveProfileAvatar",
      {},
      { name: profile.name, data },
    );
    if (result.ok === false) throw new Error("Could not save the avatar");
    await avatarKind(profile.name, "photo");
    if (avatarEditor()?.name === profile.name) {
      setAvatarEditor({ name: profile.name, data });
    }
    inform("Avatar saved");
    await refresh();
  }
  const [selection, setSelection] = createSignal({ text: "", from: 1, to: 1 });
  const [attachSelection, setAttachSelection] = createSignal(false);
  const [form, setForm] = createSignal<
      {
        operation: string;
        params: Record<string, unknown>;
        values: Record<string, unknown>;
        original?: Record<string, unknown>;
        fields?: FormField[];
        title: string;
      } | null
    >(null),
    [detail, setDetail] = createSignal<unknown>();
  let refreshVersion = 0;
  onCleanup(() => {
    refreshVersion++;
  });
  async function refresh() {
    const version = ++refreshVersion;
    setLoading(true);
    setError("");
    if (
      [
        "graph",
        "fallbacks",
        "moa",
        "computer",
        "delegation",
        "resources",
      ].includes(props.name)
    ) {
      setLoading(false);
      return;
    }
    try {
      const value = await resource(
        surface().read,
        props.name === "files"
          ? { path: path() }
          : props.name === "connectors"
          ? { conversation: connectionConversation() }
          : scoped()
          ? { profile: resourceProfile() }
          : {},
      );
      if (version === refreshVersion) setData(value);
    } catch (e) {
      if (version === refreshVersion) setError((e as Error).message);
    } finally {
      if (version === refreshVersion) setLoading(false);
    }
  }
  let previousSurface = "";
  createEffect(() => {
    const surfaceKey = `${props.name}:${resourceProfile()}`;
    if (surfaceKey !== previousSurface) {
      previousSurface = surfaceKey;
      setData(undefined);
      setForm(null);
      setDetail(undefined);
      setToolConfig(undefined);
      if (props.name === "jobs" && scheduleDraft()) {
        const fields = operations.createJob.fields!;
        setForm({
          operation: "createJob",
          params: {},
          title: "Create schedule",
          fields,
          values: {
            ...Object.fromEntries(fields.map((field) => [field.key, ""])),
            prompt: scheduleDraft(),
          },
        });
        setScheduleDraft(undefined);
      }
    }
    surface().read;
    revision();
    path();
    void refresh();
  });
  const [skillSort, setSkillSort] = createSignal("usage");
  const rows = (): ResourceRow[] =>
    (props.name === "pairing"
      ? (pairingRows(data() ?? {}) as ResourceRow[])
      : dataRows(data(), surface().list))
      .filter(
        (r) =>
          !(
            props.name === "toolsets" &&
            /^(image_gen|image_generation|tts|stt|voice)$/.test(
              String(r.name ?? r.id ?? ""),
            )
          ),
      )
      .filter((r) =>
        String(r.name ?? r.title ?? r.id ?? "")
          .toLowerCase()
          .includes(filter().toLowerCase())
      )
      .sort((a, b) =>
        props.name !== "skills"
          ? 0
          : (skillSort() === "usage"
            ? Number(b.usage ?? 0) - Number(a.usage ?? 0)
            : 0) || String(a.name).localeCompare(String(b.name))
      );
  const masterDetail = () =>
    [
      "profiles",
      "jobs",
      "skills",
      "toolsets",
      "mcp",
      "webhooks",
      "connectors",
      "agentPlugins",
      "memory",
    ].includes(props.name);
  const [selectedId, setSelectedId] = createSignal("");
  const [picker, setPicker] = createSignal(false);
  const rowId = (item: ResourceRow) =>
    String(item.id ?? item.name ?? item.key ?? "");
  const rowTitle = (item: ResourceRow) =>
    item.ui_meta?.["hermes-bots"]?.title ||
    item.display_name ||
    item.name ||
    item.title ||
    item.id ||
    "Item";
  const selectedRow = createMemo(
    () => rows().find((item) => rowId(item) === selectedId()) ?? rows()[0],
  );
  const [preview, setPreview] = createSignal("");
  const [previewError, setPreviewError] = createSignal("");
  const [previewLoading, setPreviewLoading] = createSignal(false);
  createEffect(() => {
    const name = props.name,
      item = selectedRow();
    setPreview("");
    setPreviewError("");
    setPreviewLoading(false);
    if (!item || !["profiles", "skills"].includes(name)) return;
    let disposed = false;
    setPreviewLoading(true);
    void resource(name === "profiles" ? "soul" : "skill", {
      id: rowId(item),
      name: rowId(item),
      ...(scoped() ? { profile: resourceProfile() } : {}),
    })
      .then((value) => {
        if (!disposed) setPreview(String(value.content ?? value.soul ?? ""));
      })
      .catch((error) => {
        if (!disposed) setPreviewError(error.message);
      })
      .finally(() => {
        if (!disposed) setPreviewLoading(false);
      });
    onCleanup(() => {
      disposed = true;
    });
  });
  const [changingRows, setChangingRows] = createSignal<Set<string>>(new Set());
  const rowToggle = () =>
    ({ skills: "toggleSkill", toolsets: "toggleToolset", mcp: "toggleMcp" })[
      props.name as "skills" | "toolsets" | "mcp"
    ];
  const itemList = () => (
    <nav class="resource-rail" aria-label={`${surface().title} list`}>
      <Show when={props.name === "skills"}>
        <select
          aria-label="Sort skills"
          value={skillSort()}
          onChange={(e) =>
            setSkillSort(e.currentTarget.value)}
        >
          <option value="usage">↓ Most used</option>
          <option value="name">Name</option>
        </select>
      </Show>
      <For each={rows()}>
        {(item) => (
          <div
            class="resource-rail-row"
            classList={{ selected: rowId(item) === rowId(selectedRow() ?? {}) }}
          >
            <button
              type="button"
              aria-label={rowTitle(item)}
              onClick={() => {
                setSelectedId(rowId(item));
                setPicker(false);
              }}
            >
              <Show when={!rowToggle() && item.enabled !== undefined}>
                <span
                  class="resource-state-dot"
                  classList={{ enabled: item.enabled }}
                />
              </Show>
              <span>
                <strong>{rowTitle(item)}</strong>
                <Show when={item.category}>
                  <small>
                    {String(item.category)}{" "}
                    <Show
                      when={item.provenance && item.provenance !== "bundled"}
                    >
                      <em>{String(item.provenance)}</em>
                    </Show>
                  </small>
                </Show>
              </span>
            </button>
            <Show when={Number(item.usage) > 0}>
              <small class="resource-usage">×{Number(item.usage)}</small>
            </Show>
            <Show when={rowToggle() && item.enabled !== undefined}>
              <input
                class="resource-toggle"
                type="checkbox"
                role="switch"
                aria-checked={Boolean(item.enabled)}
                aria-label={`${item.enabled ? "Disable" : "Enable"} ${
                  rowTitle(item)
                }`}
                checked={Boolean(item.enabled)}
                disabled={changingRows().has(rowId(item))}
                onChange={() =>
                  void run(async () => {
                    const id = rowId(item);
                    setChangingRows((rows) => new Set([...rows, id]));
                    try {
                      await action(rowToggle(), item);
                    } finally {
                      setChangingRows((rows) => {
                        const next = new Set(rows);
                        next.delete(id);
                        return next;
                      });
                    }
                  })}
              />
            </Show>
          </div>
        )}
      </For>
    </nav>
  );
  async function action(operation: string, item: ResourceRow = {}) {
    const id = String(
      (props.name === "webhooks" ? item.name : item.id) ??
        item.name ??
        item.key ??
        "",
    );
    const params = {
      id,
      ...(scoped() ? { profile: resourceProfile() } : {}),
      ...(props.name === "skills" ? { name: id } : {}),
      ...(props.name === "connectors"
        ? { conversation: connectionConversation() }
        : {}),
    };
    if (
      operation === "connectConnector" ||
      operation === "reconnectConnector"
    ) {
      setDetail(
        await resource(operation, params, {
          connectors: [item.slug ?? item.id ?? item.name],
        }),
      );
      await refresh();
      return;
    }
    if (operation === "authMcp") {
      setMcpFlow(await resource(operation, params, {}));
      return;
    }
    if (operation === "togglePlugin" || operation === "updatePlugin") {
      setDetail(
        await resource(operation, params, {
          key: item.key,
          name: item.name,
          enable: item.status !== "enabled",
        }),
      );
      await refresh();
      return;
    }
    if (["soul", "skill", "toolsetConfig", "jobRuns"].includes(operation)) {
      const result = await resource(operation, params);
      if (operation === "toolsetConfig") {
        setToolConfig({ ...result, id });
        return;
      }
      if (operation === "jobRuns") {
        setDetail(result);
        return;
      }
      setForm({
        operation: operation === "soul" ? "saveSoul" : "saveSkill",
        params,
        values: {
          content: result.content ?? result.soul ?? "",
          ...(operation === "skill" ? { name: id } : {}),
        },
        fields: [
          {
            key: "content",
            label: operation === "soul"
              ? "Personality & instructions"
              : "Skill content",
            type: "textarea",
          },
        ],
        title: human(operation),
      });
      return;
    }
    if (operation.startsWith("delete") || operation.startsWith("revoke")) {
      if (await rejectAction(`${human(operation)} ${id}?`)) return;
      await resource(
        operation,
        params,
        operation === "deleteEnv"
          ? { key: item.name }
          : operation === "revokePairing"
          ? { platform: item.platform, user_id: item.user_id }
          : { ...item },
      );
      await refresh();
      return;
    }
    if (operation.startsWith("toggle")) {
      await resource(operation, params, { name: id, enabled: !item.enabled });
      await refresh();
      return;
    }
    if (
      [
        "runJob",
        "pauseJob",
        "resumeJob",
        "testMcp",
        "testPlatform",
        "authMcp",
        "activateEndpoint",
        "approvePairing",
      ].includes(operation)
    ) {
      setDetail(await resource(operation, params, { ...item }));
      await refresh();
      return;
    }
    if (operation === "botAvatar") {
      const asset = await resource("profileAvatar", { name: id });
      setAvatarEditor({ name: id, data: asset.found ? asset.data : undefined });
      return;
    }
    if (operation === "botAppearance") {
      const meta = item.ui_meta?.["hermes-bots"] ?? {};
      setForm({
        operation: "profileAppearance",
        params: { name: id },
        title: "Bot display name",
        values: { title: meta.title || item.display_name || id },
        fields: [{ key: "title", label: "Display name", required: true }],
        original: {
          metadata: meta,
          revision: item.ui_meta_revisions?.["hermes-bots"] ?? 0,
        },
      });
      return;
    }
    if (operation === "memoryProvider") {
      await resource(operation, {}, { provider: id });
      await refresh();
      return;
    }
    if (operation === "memoryConfig") {
      const config = await resource(operation, params);
      setForm({
        operation: "saveMemoryConfig",
        params,
        title: `Configure ${config.label ?? id}`,
        values: Object.fromEntries(
          ((config.fields ?? []) as ResourceField[]).map((field) => [
            field.key,
            field.value ?? "",
          ]),
        ),
        fields: ((config.fields ?? []) as ResourceField[]).map((field) => ({
          key: field.key,
          label: `${field.label}${
            field.kind === "secret" && field.is_set
              ? " (saved; blank keeps current)"
              : ""
          }`,
          type: field.kind === "secret"
            ? "password"
            : field.kind === "boolean"
            ? "boolean"
            : ["integer", "number"].includes(field.kind ?? "")
            ? "number"
            : "text",
          required: field.required && !field.is_set,
        })),
      });
      return;
    }
    if (operation === "savePlatform") {
      setForm({
        operation,
        params,
        title: "Configure messaging",
        values: {
          enabled: Boolean(item.enabled),
          env: Object.fromEntries(
            (item.env_vars ?? []).map((entry: { key: string }) => [
              entry.key,
              "",
            ]),
          ),
          clear_env: [],
        },
      });
      return;
    }
    if (operation === "saveJob") {
      const values = editableJob(item);
      setForm({
        operation,
        params,
        title: "Edit schedule",
        values,
        original: structuredClone(values),
      });
      return;
    }
    const fields = operations[operation]?.fields;
    setForm({
      operation,
      params,
      values: fields
        ? Object.fromEntries(fields.map((f) => [f.key, item[f.key] ?? ""]))
        : { ...item },
      fields,
      title: human(operation),
    });
  }
  async function save() {
    const f = form();
    if (!f) return;
    const currentConfig = f.operation === "saveConfig"
      ? await resource("config")
      : undefined;
    const body = f.operation === "profileAppearance"
      ? {
        name: f.params.name,
        ui_meta: {
          "hermes-bots": {
            ...((f.original?.metadata as Record<string, unknown>) ?? {}),
            ...f.values,
          },
        },
        ui_meta_expected_revisions: {
          "hermes-bots": f.original?.revision ?? 0,
        },
      }
      : f.operation === "saveConfig"
      ? {
        config: configPatch(
          f.values,
          f.original ?? {},
          currentConfig?.config ?? currentConfig ?? {},
        ),
      }
      : f.operation === "saveJob"
      ? { updates: jobPatch(f.values, f.original ?? {}) }
      : f.operation === "saveEndpoint"
      ? endpointBody(f.values)
      : f.operation === "savePlatform"
      ? platformBody(f.values)
      : f.operation === "addMcp"
      ? mcpBody(f.values)
      : f.operation === "saveMemoryConfig"
      ? { values: f.values }
      : f.operation === "toolsetEnv"
      ? {
        env: Object.fromEntries(
          Object.entries(f.values).filter(
            ([, value]) => value !== "",
          ),
        ),
      }
      : f.operation === "setAuxModel"
      ? { scope: "auxiliary", ...f.values }
      : f.operation === "setModel"
      ? { scope: "main", ...f.values }
      : f.values;
    let result = await resource(f.operation, f.params, body);
    if (result?.confirm_required) {
      if (
        await rejectAction(
          result.confirm_message ?? "Confirm this model selection?",
        )
      ) {
        return;
      }
      result = await resource(f.operation, f.params, {
        ...body,
        confirm_expensive_model: true,
      });
    }
    if (result?.applied?.ui_meta === false) {
      throw new Error(
        "Bot appearance changed elsewhere. Close and reopen this form before saving.",
      );
    }
    if (result?.ok === false) {
      throw new Error(
        result.error ?? result.confirm_message ?? "The change was not accepted",
      );
    }
    setForm(null);
    if (f.operation === "createWebhook" && result.secret) {
      setWebhookSecret(result);
    }
    inform("Saved");
    await refresh();
    if (
      ["createJob", "createProfile", "createWebhook", "addMcp"].includes(
        f.operation,
      )
    ) {
      const created = rows().find(
        (item) =>
          rowId(item) === String(result.id ?? result.name ?? "") ||
          item.name === f.values.name,
      );
      if (created) setSelectedId(rowId(created));
    }
  }
  async function saveTextFile() {
    const current = file();
    if (!current) return;
    const latest = await resource("file", { path: current.path });
    if (
      current.readOnly ||
      latest.binary ||
      latest.truncated ||
      String(latest.content ?? latest.text ?? "").includes("\uFFFD")
    ) {
      throw new Error(
        "Only a complete UTF-8 text file can be edited. Use Open with browser or Download for this file.",
      );
    }
    if (
      (latest.content ?? latest.text ?? "") !== original() &&
      (await rejectAction(
        "This file changed on the host. Overwrite it with your edits?",
      ))
    ) {
      return;
    }
    await resource(
      "saveFile",
      {},
      { ...current, expectedContent: latest.content ?? latest.text ?? "" },
    );
    setOriginal(current.content);
    setDirty(file()?.content !== current.content);
    setFileChanged(false);
    inform("File saved");
  }
  async function openFile(item: ResourceRow) {
    const p = item.path ?? [path(), item.name].filter(Boolean).join("/");
    if (
      item.is_directory ||
      item.is_dir ||
      item.type === "directory" ||
      item.kind === "directory"
    ) {
      setPath(p);
      return;
    }
    const result = await resource("file", { path: p });
    if (result.binary) {
      throw new Error(
        "This is a binary file. Use Open with browser or Download.",
      );
    }
    const content = result.content ?? result.text ?? "";
    setFile({
      path: p,
      content,
      readOnly: Boolean(result.truncated || content.includes("\uFFFD")),
    });
    setOriginal(result.content ?? result.text ?? "");
    setDirty(false);
  }
  const download = (p: string) => `/api/download?path=${encodeURIComponent(p)}`;
  return (
    <div
      class="resource-page"
      classList={{ "resource-master-detail": masterDetail() }}
    >
      <Show when={props.name === "webhooks" && data()?.enabled === false}>
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              await resource("enableWebhooks", {}, {});
              await refresh();
            })}
        >
          Enable incoming webhooks
        </button>
      </Show>
      <Show when={props.name === "connectors"}>
        <Field label="Conversation">
          <select
            value={connectionConversation()}
            onChange={(e) => setConnectionConversation(e.currentTarget.value)}
          >
            <option value="">Choose a conversation</option>
            <For each={workspace()?.conversations ?? []}>
              {(c) => <option value={c.key}>{c.title}</option>}
            </For>
          </select>
        </Field>
      </Show>
      <div class="page-heading">
        <h1>{surface().title}</h1>
        <div>
          <IconButton
            icon="refresh"
            label="Refresh"
            onClick={() => void refresh()}
          />
          <Show when={surface().create}>
            <button
              type="button"
              class="primary"
              onClick={() => void run(() => action(surface().create!))}
            >
              <Icon name="plus" />
              Add
            </button>
          </Show>
        </div>
      </div>
      <Show when={scoped()}>
        <label class="resource-profile">
          Configuring:
          <select
            aria-label="Configuring profile"
            value={resourceProfile()}
            onChange={(e) => setResourceProfile(e.currentTarget.value)}
          >
            <For each={profiles()}>
              {(name) => (
                <option value={name}>
                  {name === "default" ? "Hermes (default)" : name}
                </option>
              )}
            </For>
          </select>
        </label>
      </Show>
      <Show when={error()}>
        <div class="error" role="alert">
          {error()}
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </Show>
      <Show when={loading() && !data()}>
        <p>Loading from Hermes…</p>
      </Show>
      <Show when={props.name === "models"}>
        <div class="settings-grid">
          <For
            each={[
              ["endpoints", "Custom inference endpoints"],
              ["env", "Provider credentials"],
              ["auxiliary", "Auxiliary models"],
              ["fallbacks", "Fallback models"],
              ["moa", "Mixture of Agents"],
              ["advanced", "Advanced settings"],
            ]}
          >
            {([id, label]) => (
              <button
                type="button"
                onClick={() => props.navigate("resources:" + id)}
              >
                {label}
              </button>
            )}
          </For>
        </div>
        <button
          type="button"
          class="primary"
          onClick={() => void run(() => action("setModel"))}
        >
          Choose default model
        </button>
        <ProviderAccess />
      </Show>
      <Show when={props.name === "fallbacks"}>
        <FallbackModels />
      </Show>
      <Show
        keyed
        when={["computer", "delegation", "resources"].includes(props.name) &&
          props.name}
      >
        {(kind) => <RuntimeSettings kind={kind} />}
      </Show>
      <Show when={props.name === "moa"}>
        <MixtureModels />
      </Show>
      <Show when={props.name === "advanced"}>
        <p class="subtitle">
          Runtime preferences. Values managed by your host may be read-only.
        </p>
        <button
          type="button"
          class="primary"
          onClick={() =>
            setForm({
              operation: "saveConfig",
              params: {},
              values: structuredClone(data()?.config ?? data() ?? {}),
              original: structuredClone(data()?.config ?? data() ?? {}),
              title: "Hermes settings",
            })}
        >
          Edit settings
        </button>
      </Show>
      <Show when={props.name === "graph"}>
        <MemoryGraph />
      </Show>
      <Show when={props.name === "memory"}>
        <button
          type="button"
          onClick={async () => {
            if (await confirmAction("Reset Hermes memory?")) {
              void run(async () => {
                await resource("resetMemory", {}, {});
                await refresh();
              });
            }
          }}
        >
          Reset memory
        </button>
        <button
          type="button"
          onClick={() => props.navigate("resources:advanced")}
        >
          Memory settings
        </button>
        <button type="button" onClick={() => props.navigate("resources:graph")}>
          Open memory graph
        </button>
      </Show>
      <Show when={props.name === "curator"}>
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              await resource("pauseCurator", {}, { paused: !data()?.paused });
              await refresh();
            })}
        >
          {data()?.paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              setDetail(await resource("runCurator", {}, {}));
            })}
        >
          Review skills now
        </button>
      </Show>
      <Show when={props.name === "status"}>
        <button
          type="button"
          onClick={() =>
            void run(async () =>
              setDetail(await resource("logs", { lines: 200 }))
            )}
        >
          Open logs
        </button>
        <button
          type="button"
          onClick={() =>
            void run(async () => setDetail(await resource("stats")))}
        >
          Host resources
        </button>
      </Show>
      <Show when={props.name === "jobs"}>
        <button
          type="button"
          onClick={() =>
            void run(async () =>
              setBlueprints((await resource("blueprints")).blueprints ?? [])
            )}
        >
          Automation blueprints
        </button>
      </Show>
      <Show when={props.name === "backup"}>
        <Backups />
      </Show>
      <Show when={props.name === "files"}>
        <div class="file-location">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void refresh();
            }}
          >
            <input
              aria-label="Host directory"
              placeholder="Host directory"
              value={path()}
              onChange={(e) => setPath(e.currentTarget.value)}
            />
            <button type="submit">Open</button>
          </form>
          <button
            type="button"
            onClick={() => props.navigate("resources:artifacts")}
          >
            Generated files
          </button>
        </div>
      </Show>
      <Show
        when={![
          "graph",
          "fallbacks",
          "moa",
          "computer",
          "delegation",
          "resources",
        ].includes(props.name)}
      >
        <Show
          when={surface().list ||
            ["files", "artifacts", "env", "graph"].includes(props.name)}
          fallback={<Value value={data()} />}
        >
          <input
            class="filter"
            type="search"
            aria-label="Filter items"
            placeholder="Filter…"
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
          />
          <div class="resource-browser">
            <Show when={masterDetail()}>
              <div class="resource-desktop-rail">{itemList()}</div>
              <button
                type="button"
                class="mobile-only resource-picker"
                onClick={() => setPicker(true)}
              >
                {selectedRow() ? rowTitle(selectedRow()!) : surface().title}
                <Icon name="nav-arrow-down" />
              </button>
            </Show>
            <div class="resource-list">
              <For
                each={props.name === "files"
                  ? dataRows(data(), ["entries", "files"]).filter((item) =>
                    String(item.name ?? "")
                      .toLowerCase()
                      .includes(filter().toLowerCase())
                  )
                  : masterDetail()
                  ? selectedRow() ? [selectedRow()!] : []
                  : rows()}
              >
                {(item) => (
                  <article class="resource-card">
                    <div class="resource-card-heading">
                      <Show
                        when={props.name === "profiles" &&
                          item.has_avatar &&
                          item.ui_meta?.["hermes-bots"]?.imageKind !== "shape"}
                      >
                        <ProfileAvatar
                          name={item.name ?? ""}
                          version={item.ui_meta_revisions?.["hermes-bots"] ?? 0}
                        />
                      </Show>
                      <Show
                        when={props.name === "files" ||
                          props.name === "artifacts"}
                      >
                        <Icon
                          name={item.is_dir || item.type === "directory"
                            ? "folder"
                            : "page"}
                        />
                      </Show>
                      <div>
                        <h3>
                          {item.ui_meta?.["hermes-bots"]?.title ||
                            item.display_name ||
                            item.name ||
                            item.title ||
                            item.id ||
                            "Item"}
                        </h3>
                        <Show when={item.description}>
                          <p>{item.description}</p>
                        </Show>
                      </div>
                      <Show when={item.enabled !== undefined}>
                        <span
                          class="badge"
                          classList={{ "is-disabled": !item.enabled }}
                        >
                          {item.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </Show>
                    </div>
                    <Show when={props.name === "jobs"}>
                      <dl class="job-metadata">
                        <div>
                          <dt>Frequency</dt>
                          <dd>
                            {String(
                              item.scheduleHuman ??
                                item.schedule_display ??
                                item.schedule ??
                                "—",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Last</dt>
                          <dd>
                            {String(
                              item.last_run_at ??
                                item.last_run ??
                                "Not run yet",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Next</dt>
                          <dd>
                            {String(item.next_run_at ?? item.next_run ?? "—")}
                          </dd>
                        </div>
                        <div>
                          <dt>Deliver to</dt>
                          <dd>
                            {String(item.deliver ?? item.delivery ?? "origin")}
                          </dd>
                        </div>
                      </dl>
                      <Show when={item.last_error}>
                        <p class="error">{String(item.last_error)}</p>
                      </Show>
                      <h4>Prompt</h4>
                      <pre class="resource-document">
                        {String(item.prompt ?? "")}
                      </pre>
                    </Show>
                    <Show when={["profiles", "skills"].includes(props.name)}>
                      <h4>
                        {props.name === "profiles" ? "SOUL.md" : "Instructions"}
                      </h4>
                      <Show when={previewLoading()}>
                        <p role="status">Loading instructions…</p>
                      </Show>
                      <Show when={previewError()}>
                        <p role="alert" class="error">
                          {previewError()}
                        </p>
                      </Show>
                      <Show when={!previewLoading() && !previewError()}>
                        <pre class="resource-document">
                          {preview() || "No instructions yet."}
                        </pre>
                      </Show>
                    </Show>
                    <div class="resource-actions">
                      <Show when={props.name === "profiles"}>
                        <button
                          type="button"
                          class="primary"
                          onClick={() =>
                            void props.newChat(item.name ?? item.id)}
                        >
                          Chat
                        </button>
                      </Show>
                      <Show
                        when={props.name === "files" ||
                          props.name === "artifacts"}
                      >
                        <button
                          type="button"
                          onClick={() => void run(() => openFile(item))}
                        >
                          Open
                        </button>
                        <a
                          href={download(item.path ?? item.name ?? "")}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open with browser
                        </a>
                        <a
                          href={download(item.path ?? item.name ?? "")}
                          download=""
                        >
                          Download
                        </a>
                      </Show>
                      <For
                        each={(surface().actions ?? []).filter(
                          ([, op]) =>
                            (props.name !== "jobs" ||
                              ((op !== "pauseJob" || item.enabled !== false) &&
                                (op !== "resumeJob" ||
                                  item.enabled === false))) &&
                            (props.name !== "pairing" ||
                              (op === "approvePairing"
                                ? item.accessStatus === "pending"
                                : item.accessStatus === "approved")),
                        )}
                      >
                        {([label, op]) => (
                          <button
                            type="button"
                            onClick={() => void run(() => action(op, item))}
                          >
                            {label}
                          </button>
                        )}
                      </For>
                      <button type="button" onClick={() => setDetail(item)}>
                        Details
                      </button>
                    </div>
                    <Show when={props.name === "jobs"}>
                      <JobHistory
                        id={rowId(item)}
                        profile={resourceProfile()}
                        navigate={props.navigate}
                      />
                    </Show>
                  </article>
                )}
              </For>
              <Show when={!rows().length && !loading() && !error()}>
                <Empty title="Nothing here yet" />
              </Show>
            </div>
          </div>
          <Show when={picker()}>
            <Dialog
              title={surface().title}
              class="navigation-sheet"
              close={() => setPicker(false)}
            >
              {itemList()}
            </Dialog>
          </Show>
        </Show>
      </Show>
      <Show when={form()}>
        {(f) => (
          <Dialog title={f().title} close={() => setForm(null)}>
            <Show when={f().operation === "savePlatform"}>
              <p>
                Leave a credential blank to keep its saved value. To remove one,
                add its variable name to Clear env.
              </p>
            </Show>
            <Show when={f().operation === "saveEndpoint"}>
              <p>
                Leave the API key blank to preserve a saved key for this
                identifier.
              </p>
            </Show>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(save);
              }}
            >
              <Show
                when={f().fields}
                fallback={
                  <Editor
                    value={f().values}
                    change={(values) => setForm({ ...f(), values })}
                  />
                }
              >
                <For each={f().fields}>
                  {(field) => (
                    <Field label={field.label}>
                      <Show
                        when={field.type === "textarea"}
                        fallback={
                          <input
                            required={field.required}
                            type={field.type === "boolean"
                              ? "checkbox"
                              : (field.type ?? "text")}
                            checked={field.type === "boolean"
                              ? Boolean(f().values[field.key])
                              : undefined}
                            value={String(f().values[field.key] ?? "")}
                            onInput={(e) =>
                              setForm({
                                ...f(),
                                values: {
                                  ...f().values,
                                  [field.key]: field.type === "boolean"
                                    ? e.currentTarget.checked
                                    : field.type === "number"
                                    ? Number(e.currentTarget.value)
                                    : e.currentTarget.value,
                                },
                              })}
                          />
                        }
                      >
                        <textarea
                          required={field.required}
                          value={String(f().values[field.key] ?? "")}
                          onInput={(e) =>
                            setForm({
                              ...f(),
                              values: {
                                ...f().values,
                                [field.key]: e.currentTarget.value,
                              },
                            })}
                        />
                      </Show>
                    </Field>
                  )}
                </For>
              </Show>
              <button type="submit" class="primary">
                Save
              </button>
            </form>
          </Dialog>
        )}
      </Show>
      <Show when={avatarEditor()}>
        {(profile) => (
          <Dialog
            title={`Avatar for ${profile().name}`}
            close={() => setAvatarEditor(undefined)}
          >
            <Show
              when={/^data:image\/(png|jpeg|webp);base64,/.test(
                profile().data ?? "",
              )}
            >
              <img
                class="bot-avatar-preview"
                src={profile().data}
                alt={`Avatar for ${profile().name}`}
              />
            </Show>
            <Field label="Upload avatar">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) =>
                  void run(() => avatarUpload(event.currentTarget.files?.[0]))}
              />
            </Field>
            <Show when={profile().data}>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    const name = profile().name;
                    const result = await resource(
                      "saveProfileAvatar",
                      {},
                      { name, clear: true },
                    );
                    if (result.ok === false) {
                      throw new Error("Could not remove the avatar");
                    }
                    await avatarKind(name, "shape");
                    setAvatarEditor({ name });
                    await refresh();
                  })}
              >
                Remove avatar
              </button>
            </Show>
          </Dialog>
        )}
      </Show>
      <Show when={mcpFlow()}>
        {(flow) => (
          <Dialog
            title={`Authorize ${flow().server_name}`}
            close={() => void run(closeMcpFlow)}
          >
            <p role="status">
              {flow().error ??
                (flow().status === "approved"
                  ? "Connected"
                  : "Waiting for authorization…")}
            </p>
            <Show
              when={flow().status === "authorization_required" &&
                /^https?:\/\//i.test(flow().authorization_url ?? "")}
            >
              <a
                href={flow().authorization_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open authorization page
              </a>
              <p>
                The MCP server's OAuth redirect must point to this site's
                callback route. Your host administrator configures that when
                connecting the server.
              </p>
            </Show>
            <button type="button" onClick={() => void run(closeMcpFlow)}>
              Close
            </button>
          </Dialog>
        )}
      </Show>
      <Show when={toolConfig()}>
        {(config) => (
          <Dialog
            title={`Configure ${human(config().name)}`}
            close={() => setToolConfig(undefined)}
          >
            <For
              each={(config().providers ?? []).filter(
                (provider) => !provider.requires_nous_auth,
              )}
            >
              {(provider) => (
                <article class="resource-card">
                  <h3>{provider.name}</h3>
                  <p>{provider.is_active ? "Active" : provider.status}</p>
                  <div class="row-actions">
                    <For
                      each={config().name === "web"
                        ? (provider.capabilities ?? ["search", "extract"])
                        : [undefined]}
                    >
                      {(capability) => (
                        <button
                          type="button"
                          onClick={() =>
                            void run(async () => {
                              await resource(
                                "toolsetProvider",
                                { id: config().id },
                                {
                                  provider: provider.name,
                                  ...(capability ? { capability } : {}),
                                },
                              );
                              setToolConfig({
                                ...(await resource("toolsetConfig", {
                                  id: config().id,
                                })),
                                id: config().id,
                              });
                              inform("Provider selected");
                            })}
                        >
                          Use{capability ? ` for ${capability}` : " provider"}
                        </button>
                      )}
                    </For>
                    <Show when={provider.env_vars?.length}>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            operation: "toolsetEnv",
                            params: { id: config().id },
                            title: `${provider.name} credentials`,
                            values: Object.fromEntries(
                              (provider.env_vars ?? []).map((field) => [
                                field.key,
                                "",
                              ]),
                            ),
                            fields: (provider.env_vars ?? []).map((field) => ({
                              key: field.key,
                              label: `${field.prompt ?? field.key}${
                                field.is_set
                                  ? " (saved; blank keeps current)"
                                  : ""
                              }`,
                              type: "password",
                            })),
                          })}
                      >
                        Credentials
                      </button>
                    </Show>
                  </div>
                </article>
              )}
            </For>
            <Show when={!config().providers?.length}>
              <p>This toolset has no provider configuration.</p>
            </Show>
          </Dialog>
        )}
      </Show>
      <Show when={webhookSecret()}>
        {(hook) => (
          <Dialog
            title="Webhook created"
            close={() => setWebhookSecret(undefined)}
          >
            <p>
              Save this secret now. Hermes only returns it when the webhook is
              created.
            </p>
            <Field label="Webhook URL">
              <input readOnly value={hook().url} />
            </Field>
            <Field label="Webhook secret">
              <input readOnly type="password" value={hook().secret} />
            </Field>
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(hook().secret);
                  inform("Secret copied");
                })}
            >
              Copy secret
            </button>
          </Dialog>
        )}
      </Show>
      <Show when={detail() !== undefined}>
        <Dialog title="Details" close={() => setDetail(undefined)}>
          <Show
            when={typeof detail() === "string"}
            fallback={<Value value={detail()} />}
          >
            <pre>{String(detail())}</pre>
          </Show>
        </Dialog>
      </Show>
      <Show when={file()}>
        {(f) => (
          <Dialog
            title={f().path.split("/").at(-1) ?? "File"}
            class="file-editor"
            close={async () => {
              if (
                !dirty() ||
                (await confirmAction("Discard unsaved changes?"))
              ) {
                setFile(null);
              }
            }}
          >
            <div class="editor-toolbar">
              <span>
                {f().content.split("\n").length} lines
                {dirty() ? " · Unsaved changes" : ""}
              </span>
              <a
                href={download(f().path)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open with browser
              </a>
              <button
                type="button"
                class="primary"
                disabled={f().readOnly}
                onClick={() => void run(saveTextFile)}
              >
                Save
              </button>
              <button
                type="button"
                disabled={!selection().text}
                onClick={() => setAttachSelection(true)}
              >
                Attach selection
              </button>
            </div>
            <Show when={fileChanged()}>
              <p role="status">
                This file changed on the host. Your unsaved edits are preserved;
                saving will ask before replacing the newer version.
              </p>
            </Show>
            <Show when={f().readOnly}>
              <p role="status">
                Read-only preview. Download the complete file to edit it.
              </p>
            </Show>
            <FileEditor
              readOnly={f().readOnly}
              path={f().path}
              content={f().content}
              change={(content) => {
                setFile({ ...f(), content });
                setDirty(content !== original());
              }}
              select={(text, from, to) => setSelection({ text, from, to })}
            />
            <p>Select lines to add context to a conversation.</p>
          </Dialog>
        )}
      </Show>
      <Show when={attachSelection()}>
        <Dialog
          title="Add selection to a conversation"
          close={() => setAttachSelection(false)}
        >
          <For each={workspace()?.conversations ?? []}>
            {(c) => (
              <button
                type="button"
                class="list-button"
                onClick={() =>
                  void run(async () => {
                    if (
                      dirty() &&
                      (await rejectAction(
                        "Leave this file and discard unsaved edits?",
                      ))
                    ) {
                      return;
                    }
                    const old = (await draft(c.key)) ?? "";
                    await draft(
                      c.key,
                      `${old}\n[${file()?.path}, lines ${selection().from}–${selection().to}]\n${selection().text}\n`,
                    );
                    props.navigate(c.key);
                  })}
              >
                {c.title}
              </button>
            )}
          </For>
        </Dialog>
      </Show>
      <Show when={blueprints()}>
        <Dialog
          title="Automation blueprints"
          close={() => setBlueprints(undefined)}
        >
          <For each={blueprints()}>
            {(item) => (
              <button
                type="button"
                class="list-button"
                onClick={() => {
                  setBlueprint(item);
                  setBlueprintValues(
                    Object.fromEntries(
                      item.fields.map((field) => [
                        field.name,
                        field.default ?? "",
                      ]),
                    ),
                  );
                  setBlueprints(undefined);
                }}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
                <small>{item.scheduleHuman}</small>
              </button>
            )}
          </For>
        </Dialog>
      </Show>
      <Show when={blueprint()}>
        {(item) => (
          <Dialog
            title={item().title}
            close={() => setBlueprint(undefined)}
          >
            <p>{item().description}</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setCreatingBlueprint(true);
                void run(async () => {
                  await resource(
                    "useBlueprint",
                    { profile: resourceProfile() },
                    { blueprint: item().key, values: blueprintValues() },
                  );
                  setBlueprint(undefined);
                  inform("Scheduled automation created");
                  await refresh();
                }).finally(() => setCreatingBlueprint(false));
              }}
            >
              <For each={item().fields}>
                {(field) => (
                  <Field label={field.label} hint={field.help}>
                    <Show
                      when={field.options.length && field.strict}
                      fallback={
                        <input
                          type={field.type === "time" ? "time" : "text"}
                          required={!field.optional}
                          value={String(blueprintValues()[field.name] ?? "")}
                          onInput={(event) =>
                            setBlueprintValues((value) => ({
                              ...value,
                              [field.name]: event.currentTarget.value,
                            }))}
                        />
                      }
                    >
                      <select
                        required={!field.optional}
                        value={String(blueprintValues()[field.name] ?? "")}
                        onChange={(event) =>
                          setBlueprintValues((value) => ({
                            ...value,
                            [field.name]: event.currentTarget.value,
                          }))}
                      >
                        <option value="">Choose…</option>
                        <For each={field.options}>
                          {(option) => (
                            <option value={option}>{human(option)}</option>
                          )}
                        </For>
                      </select>
                    </Show>
                  </Field>
                )}
              </For>
              <button
                type="submit"
                class="primary"
                disabled={creatingBlueprint()}
              >
                Create schedule
              </button>
            </form>
          </Dialog>
        )}
      </Show>
    </div>
  );
}
