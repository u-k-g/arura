import type { Doc } from "../shared/contracts.ts";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import {
  inform,
  logout,
  mutate,
  request,
  resource,
  subscribe,
  workspace,
} from "./client.ts";
import {
  cacheIssue,
  caching,
  clearCache,
  preferences,
  storageInfo,
} from "./cache.ts";
import { Dialog, Field, Icon, IconButton, run } from "./ui.tsx";
const groups = [
  {
    title: "Your workspace",
    items: [
      ["devices", "Access & devices", "computer"],
      ["storage", "Storage & offline", "download"],
      ["navigation", "Conversations & archive", "archive"],
      ["notifications", "Notifications", "bell"],
      ["appearance", "Appearance", "settings"],
    ],
  },
  {
    title: "Hermes",
    items: [
      ["capabilities", "Capabilities", "capabilities"],
      ["models", "Models & providers", "chat-bubble"],
      ["profiles", "Profiles & bots", "chat-bubble"],
      ["jobs", "Schedules", "clock"],
      ["skills", "Skills", "page"],
      ["toolsets", "Tools", "settings"],
      ["computer", "Computer use", "computer"],
      ["delegation", "Delegated work", "chat-bubble"],
      ["resources", "Backend resources", "settings"],
      ["mcp", "MCP servers", "computer"],
      ["connectors", "App connections", "key"],
      ["agentPlugins", "Agent plugins", "settings"],
      ["platforms", "Messaging", "chat-bubble"],
      ["pairing", "Messaging access", "key"],
      ["webhooks", "Incoming triggers", "clock"],
      ["memory", "Memory", "page"],
      ["graph", "Memory graph", "star"],
      ["curator", "Skill curator", "refresh"],
    ],
  },
  {
    title: "Administration",
    items: [
      ["usage", "Usage", "clock"],
      ["status", "Status & logs", "computer"],
      ["maintenance", "Maintenance & backups", "refresh"],
      ["advanced", "Advanced settings", "settings"],
    ],
  },
];
export default function Settings(props: {
  section?: string;
  navigate: (view: string) => void;
}) {
  async function saveArchivePolicy(days: number, enabled: boolean) {
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new Error("Choose 1–3650 days");
    }
    const raw = await resource("config");
    const config = (raw.config ?? raw) as Record<string, unknown>;
    const sessions = (config.sessions ?? {}) as Record<string, unknown>;
    await resource(
      "saveConfig",
      {},
      {
        config: {
          ...config,
          sessions: {
            ...sessions,
            auto_archive: enabled,
            auto_archive_days: days,
          },
        },
      },
    );
  }
  const [devices, setDevices] = createSignal<
      (Omit<Doc<"devices">, "secretHash"> & { current?: boolean })[]
    >([]),
    [invite, setInvite] = createSignal<{ code: string; expiresAt: number }>(),
    [cache, setCache] = createSignal(caching()),
    [storage, setStorage] = createSignal<StorageEstimate>({}),
    [actions, setActions] = createSignal<{ id: string; label: string }[]>([]);
  createEffect(() => {
    if (props.section === "devices") {
      const stop = subscribe("devices", "list", {}, setDevices);
      onCleanup(stop);
    }
  });
  createEffect(() => {
    if (props.section === "storage") void storageInfo().then(setStorage);
    if (props.section === "maintenance") {
      void request("/api/maintenance")
        .then(setActions)
        .catch((e) => inform(e.message));
    }
  });
  const route = (id: string) =>
    props.navigate(
      id === "capabilities" ? "capabilities" : [
          "devices",
          "storage",
          "navigation",
          "notifications",
          "appearance",
          "maintenance",
        ].includes(id)
        ? "settings:" + id
        : "resources:" + id,
    );
  const title = () =>
    groups.flatMap((g) => g.items).find((x) => x[0] === props.section)?.[1] ??
      "Settings";
  return (
    <div class="settings-page">
      <Show
        when={props.section}
        fallback={
          <>
            <h1>Make it yours.</h1>
            <p class="subtitle">Your devices, your preferences, your Hermes.</p>
            <For each={groups}>
              {(group) => (
                <section class="settings-group">
                  <h2>{group.title}</h2>
                  <div class="settings-grid">
                    <For each={group.items}>
                      {([id, label, icon]) => (
                        <button
                          type="button"
                          onClick={() => route(id)}
                        >
                          <Icon name={icon} />
                          <span>{label}</span>
                          <span aria-hidden="true">›</span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </>
        }
      >
        <button
          type="button"
          class="text-button"
          onClick={() => props.navigate("settings")}
        >
          <Icon name="arrow-left" />
          All settings
        </button>
        <h1>{title()}</h1>
        <Show when={props.section === "devices"}>
          <p class="subtitle">
            Every browser that can access this workspace. Revoke one without
            signing out the others.
          </p>
          <For each={devices()}>
            {(d) => (
              <div class="device-card">
                <Icon
                  name={/phone|mobile/i.test(d.name)
                    ? "smartphone-device"
                    : "computer"}
                />
                <div>
                  <h3>
                    {d.name}{" "}
                    <Show when={d.current}>
                      <span class="badge">This device</span>
                    </Show>
                  </h3>
                  <p>
                    {d.revoked
                      ? "Access revoked"
                      : `Last active ${new Date(d.lastSeen).toLocaleString()}`}
                  </p>
                  <small>
                    Authorized {new Date(d.createdAt).toLocaleDateString()}
                  </small>
                </div>
                <Show when={!d.revoked}>
                  <IconButton
                    icon="edit-pencil"
                    label={`Rename ${d.name}`}
                    onClick={() => {
                      const name = prompt("Device name", d.name);
                      if (name) {
                        void run(() =>
                          mutate("devices.rename", { id: d.id, name })
                        );
                      }
                    }}
                  />
                  <button
                    type="button"
                    class="danger"
                    onClick={() => {
                      if (confirm(`Revoke access for ${d.name}?`)) {
                        void run(() => mutate("devices.revoke", { id: d.id }));
                      }
                    }}
                  >
                    Revoke
                  </button>
                </Show>
              </div>
            )}
          </For>
          <div class="button-row">
            <button
              type="button"
              class="primary"
              onClick={() =>
                void run(async () =>
                  setInvite(await request("/api/invite", {}))
                )}
            >
              Authorize another device
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm("Revoke all other devices?")) {
                  void run(() => mutate("devices.revoke", { others: true }));
                }
              }}
            >
              Revoke other devices
            </button>
            <button type="button" onClick={() => void run(logout)}>
              Sign out
            </button>
          </div>
        </Show>
        <Show when={props.section === "storage"}>
          <Show when={cacheIssue()}>
            <p role="status">{cacheIssue()}</p>
          </Show>
          <Field
            label="Keep data on this device"
            hint="Save recent conversations and drafts for quick reopening. Your browser may reclaim storage."
          >
            <input
              type="checkbox"
              checked={cache()}
              onChange={(e) => {
                const value = e.currentTarget.checked;
                preferences.setItem("arura.keepData", String(value));
                setCache(value);
                if (value) void navigator.storage?.persist();
                else void clearCache();
              }}
            />
          </Field>
          <p>
            {((storage().usage ?? 0) / 1024 / 1024).toFixed(1)}{" "}
            MB stored on this device
          </p>
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                await clearCache();
                setStorage(await storageInfo());
                inform(
                  "Saved conversations and drafts cleared from this device",
                );
              })}
          >
            Clear local data
          </button>
        </Show>
        <Show when={props.section === "navigation"}>
          <Field label="Automatically archive inactive conversations">
            <input
              type="checkbox"
              checked={workspace()?.settings?.archiveEnabled !== false}
              onChange={(e) =>
                void run(() =>
                  saveArchivePolicy(
                    Number(workspace()?.settings?.archiveDays ?? 7),
                    e.currentTarget.checked,
                  )
                )}
            />
          </Field>
          <Field
            label="Archive inactive conversations after"
            hint="Essentials, pinned chats, and everything inside folders are kept. Active work and pending questions are protected."
          >
            <div class="inline-field">
              <input
                type="number"
                min="1"
                max="3650"
                value={workspace()?.settings?.archiveDays ?? 7}
                onChange={(e) =>
                  void run(() =>
                    saveArchivePolicy(
                      Number(e.currentTarget.value),
                      workspace()?.settings?.archiveEnabled !== false,
                    )
                  )}
              />
              <span>days</span>
            </div>
          </Field>
          <p>
            Archived conversations remain available at the bottom of your
            conversation list. Restoring one starts a new inactivity window.
          </p>
        </Show>
        <Show when={props.section === "notifications"}>
          <p class="subtitle">
            Silent updates from Hermes. No sounds or external push service.
          </p>
          <For each={workspace()?.notices ?? []}>
            {(n) => (
              <button
                type="button"
                class="notification-card"
                data-notice-id={n._id}
                classList={{ unread: !n.read }}
                onClick={() => {
                  void run(() => mutate("workspace.readNotice", { id: n._id }));
                  if (n.conversation) props.navigate(n.conversation);
                }}
              >
                <Icon name="bell" />
                <span>
                  {n.title}
                  <small>{new Date(n.createdAt).toLocaleString()}</small>
                </span>
              </button>
            )}
          </For>
          <Show when={!workspace()?.notices?.length}>
            <p>Completion and input alerts will appear here.</p>
          </Show>
        </Show>
        <Show when={props.section === "appearance"}>
          <Field label="Theme">
            <select
              aria-label="Theme"
              value={preferences.getItem("arura.theme") ?? "system"}
              onChange={(e) => {
                const value = e.currentTarget.value;
                preferences.setItem("arura.theme", value);
                document.documentElement.dataset.theme = value;
              }}
            >
              <option value="system">Macro · System</option>
              <option value="light">Macro · Light</option>
              <option value="dark">Macro · Dark</option>
              <option value="grove">Grove</option>
              <option value="jade">Jade</option>
              <option value="black-rose">Black Rose</option>
              <option value="gruvbox-dark-hard">Gruvbox Dark Hard</option>
              <option value="rose-pine">Rosé Pine</option>
            </select>
          </Field>
          <Field label="Message text size">
            <input
              type="range"
              min="12"
              max="20"
              value={preferences.getItem("arura.textSize") ?? 13}
              onInput={(e) => {
                preferences.setItem("arura.textSize", e.currentTarget.value);
                document.documentElement.style.setProperty(
                  "--message-size",
                  e.currentTarget.value + "px",
                );
              }}
            />
          </Field>
        </Show>
        <Show when={props.section === "maintenance"}>
          <p class="subtitle">
            Maintenance actions are configured on your host, so they can match
            Nix or a conventional installation.
          </p>
          <For each={actions()}>
            {(a) => (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`${a.label}?`)) {
                    void run(async () => {
                      await request("/api/maintenance", { id: a.id });
                      inform("Action completed");
                    });
                  }
                }}
              >
                {a.label}
              </button>
            )}
          </For>
          <Show when={!actions().length}>
            <p>No restart or update actions configured.</p>
          </Show>
          <h2>Backups and diagnostics</h2>
          <button
            type="button"
            onClick={() => props.navigate("resources:backup")}
          >
            Create Hermes backup
          </button>
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                const result = await new Promise<unknown>((resolve) => {
                  let stop = () => {};
                  stop = subscribe("workspace", "backup", {}, (value) => {
                    resolve(value);
                    queueMicrotask(stop);
                  });
                });
                download("arura-workspace.json", result);
              })}
          >
            Download workspace backup
          </button>
          <a class="button" href="/api/diagnostics" download="">
            Download diagnostic report
          </a>
        </Show>
      </Show>
      <Show when={invite()}>
        <Dialog
          title="Authorize another device"
          close={() => setInvite(undefined)}
        >
          <p>
            Open this website on the other device and enter this single-use
            code. It expires in ten minutes.
          </p>
          <output class="invite-code">{invite()!.code}</output>
          <button
            type="button"
            class="primary"
            onClick={() =>
              void run(() => navigator.clipboard.writeText(invite()!.code))}
          >
            Copy code
          </button>
        </Dialog>
      </Show>
    </div>
  );
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
