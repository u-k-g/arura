import { For, type JSX, Show } from "solid-js";
import { Icon } from "./ui.tsx";

const groups = [
  [
    ["resources:models", "Models & providers", "brain"],
    ["settings:navigation", "Conversations & archive", "archive"],
    ["settings:appearance", "Appearance", "brightness"],
    ["capabilities", "Capabilities", "capabilities"],
    ["resources:memory", "Memory", "page"],
    ["resources:advanced", "Advanced settings", "settings"],
  ],
  [
    ["resources:profiles", "Profiles & bots", "bot"],
    ["resources:jobs", "Schedules", "clock"],
    ["resources:platforms", "Messaging", "message-text"],
    ["resources:computer", "Computer use", "computer"],
    ["resources:delegation", "Delegated work", "network"],
    ["resources:resources", "Backend resources", "cpu"],
    ["resources:connectors", "App connections", "key"],
    ["resources:agentPlugins", "Agent plugins", "capabilities"],
    ["resources:pairing", "Messaging access", "key"],
    ["resources:webhooks", "Incoming triggers", "clock"],
    ["resources:graph", "Memory graph", "star"],
    ["resources:curator", "Skill curator", "refresh"],
  ],
  [
    ["settings:devices", "Access & devices", "fingerprint-window"],
    ["settings:storage", "Storage & offline", "download-data-window"],
    ["resources:usage", "Usage", "energy-usage-window"],
    ["resources:status", "Status & logs", "computer"],
    ["settings:maintenance", "Maintenance & backups", "system-restart"],
  ],
];
const separate = new Set(["profiles", "jobs", "files", "artifacts"]);
export const inSettings = (view: string) =>
  view.startsWith("settings") ||
  view === "capabilities" ||
  (view.startsWith("resources:") &&
    !separate.has(view.slice(10).split("?")[0]));

export function SettingsNavigation(props: {
  view: string;
  navigate: (view: string) => void;
}) {
  const selected = () =>
    props.view === "settings" ? "resources:models" : props.view;
  return (
    <nav class="settings-rail nav-scroll" aria-label="Settings sections">
      <For each={groups}>
        {(group) => (
          <div class="settings-rail-group">
            <For each={group}>
              {([route, label, icon]) => (
                <button
                  type="button"
                  classList={{
                    selected:
                      selected() === route ||
                      (route === "capabilities" &&
                        [
                          "resources:skills",
                          "resources:toolsets",
                          "resources:mcp",
                        ].includes(selected())),
                  }}
                  onClick={() => {
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
}

export default function SettingsFrame(props: {
  view: string;
  children: JSX.Element;
}) {
  return (
    <Show when={inSettings(props.view)} fallback={props.children}>
      <div class="settings-content">{props.children}</div>
    </Show>
  );
}
