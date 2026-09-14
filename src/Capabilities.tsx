import { For } from "solid-js";
import { Icon } from "./ui.tsx";

const items = [
  ["skills", "Skills", "page", "Installed instructions and workflows"],
  ["toolsets", "Tools", "capabilities", "Tools available to Hermes"],
  ["mcp", "MCP servers", "computer", "Connected tool servers"],
  ["connectors", "App connections", "key", "Connected services"],
  ["agentPlugins", "Agent plugins", "capabilities", "Runtime extensions"],
  ["memory", "Memory", "page", "What Hermes remembers"],
  ["curator", "Skill curator", "refresh", "Review and maintain skills"],
];

export default function Capabilities(props: {
  navigate: (view: string) => void;
}) {
  return (
    <section class="capabilities-view">
      <h1>Capabilities</h1>
      <For each={items}>
        {([id, title, icon, description]) => (
          <button
            type="button"
            class="capability-row"
            onClick={() => props.navigate(`resources:${id}`)}
          >
            <Icon name={icon} />
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <Icon name="nav-arrow-down" />
          </button>
        )}
      </For>
    </section>
  );
}
