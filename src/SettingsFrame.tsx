import { createSignal, For, type JSX, Show } from "solid-js";
import { Dialog, Icon, IconButton } from "./ui.tsx";
import { preferences } from "./cache.ts";

const groups = [
  [
    ["resources:models", "Models & providers", "chat-bubble"],
    ["settings:navigation", "Conversations & archive", "archive"],
    ["settings:appearance", "Appearance", "settings"],
    ["capabilities", "Capabilities", "capabilities"],
    ["resources:memory", "Memory", "page"],
    ["resources:advanced", "Advanced settings", "settings"],
  ],
  [
    ["resources:profiles", "Profiles & bots", "chat-bubble"],
    ["resources:jobs", "Schedules", "clock"],
    ["resources:platforms", "Messaging", "chat-bubble"],
    ["resources:computer", "Computer use", "computer"],
    ["resources:delegation", "Delegated work", "chat-bubble"],
    ["resources:resources", "Backend resources", "settings"],
    ["resources:connectors", "App connections", "key"],
    ["resources:agentPlugins", "Agent plugins", "capabilities"],
    ["resources:pairing", "Messaging access", "key"],
    ["resources:webhooks", "Incoming triggers", "clock"],
    ["resources:graph", "Memory graph", "star"],
    ["resources:curator", "Skill curator", "refresh"],
  ],
  [
    ["settings:devices", "Access & devices", "computer"],
    ["settings:storage", "Storage & offline", "download"],
    ["resources:usage", "Usage", "clock"],
    ["resources:status", "Status & logs", "computer"],
    ["settings:maintenance", "Maintenance & backups", "refresh"],
  ],
];
const separate = new Set(["profiles", "jobs", "files", "artifacts"]);
export const inSettings = (view: string) =>
  view.startsWith("settings") ||
  view === "capabilities" ||
  (view.startsWith("resources:") &&
    !separate.has(view.slice(10).split("?")[0]));

export default function SettingsFrame(props: {
  view: string;
  navigate: (view: string) => void;
  children: JSX.Element;
}) {
  const [menu, setMenu] = createSignal(false);
  const selected = () =>
    props.view === "settings" ? "resources:models" : props.view;
  const navigation = () => (
    <nav class="settings-rail" aria-label="Settings sections">
      <For each={groups}>
        {(group) => (
          <div class="settings-rail-group">
            <For each={group}>
              {([route, label, icon]) => (
                <button
                  type="button"
                  classList={{
                    selected: selected() === route ||
                      (route === "capabilities" &&
                        [
                          "resources:skills",
                          "resources:toolsets",
                          "resources:mcp",
                        ].includes(selected())),
                  }}
                  onClick={() => {
                    setMenu(false);
                    props.navigate(route);
                  }}
                >
                  <Icon name={icon} />
                  <span>{label}</span>
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </nav>
  );
  return (
    <Show
      when={inSettings(props.view)}
      fallback={
        <Show
          when={["resources:profiles", "resources:jobs"].includes(props.view)}
          fallback={props.children}
        >
          <Dialog
            title={props.view === "resources:profiles"
              ? "Profiles & bots"
              : "Schedules"}
            class="resource-dialog"
            close={() =>
              props.navigate(
                preferences.getItem("arura.lastConversation") ?? "",
              )}
          >
            {props.children}
          </Dialog>
        </Show>
      }
    >
      <Dialog
        title="Settings"
        class="settings-dialog"
        close={() =>
          props.navigate(preferences.getItem("arura.lastConversation") ?? "")}
      >
        <div class="settings-layout">
          <div class="settings-desktop-rail">{navigation()}</div>
          <div class="settings-content">
            <IconButton
              class="mobile-only settings-section-picker"
              icon="menu"
              label="Settings sections"
              onClick={() => setMenu(true)}
            />
            {props.children}
          </div>
        </div>
      </Dialog>
      <Show when={menu()}>
        <Dialog
          title="Settings sections"
          class="navigation-sheet"
          close={() => setMenu(false)}
        >
          {navigation()}
        </Dialog>
      </Show>
    </Show>
  );
}
