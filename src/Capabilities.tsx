import { For } from "solid-js";
import Resources from "./Resources.tsx";
import { command } from "./client.ts";

export default function Capabilities(props: {
  navigate: (view: string) => void;
  section?: string;
}) {
  return (
    <section class="capabilities-browser">
      <nav class="capabilities-navigation" aria-label="Capabilities">
        <For
          each={[
            ["skills", "Skills"],
            ["toolsets", "Tools"],
            ["mcp", "MCP"],
          ]}
        >
          {([id, label]) => (
            <button
              type="button"
              classList={{ selected: (props.section ?? "skills") === id }}
              onClick={() => props.navigate(`resources:${id}`)}
            >
              {label}
            </button>
          )}
        </For>
      </nav>
      <Resources
        name={props.section ?? "skills"}
        navigate={props.navigate}
        newChat={async (profile) => {
          const result = await command("openBot", "", { profile });
          props.navigate(String(result.key));
        }}
      />
    </section>
  );
}
