import "./provider-logo.css";
import { Show } from "solid-js";
const logos = import.meta.glob("./provider-logos/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
export default function ProviderLogo(props: {
  provider: string;
  label: string;
}) {
  const brand = () => {
    const id = props.provider.toLowerCase();
    if (/opencode/.test(id)) return "opencode";
    if (/openrouter/.test(id)) return "openrouter";
    if (/openai|codex/.test(id)) return "openai";
    if (/anthropic|claude/.test(id)) return "anthropic";
    if (/google|gemini/.test(id)) return "gemini";
    if (/zai|z-ai|zhipu|^glm$/.test(id)) return "zai";
    return [
      "deepseek",
      "mistral",
      "xai",
      "ollama",
      "groq",
      "minimax",
      "moonshot",
    ].find((name) => id.includes(name));
  };
  return (
    <Show
      when={logos[`./provider-logos/${brand()}.svg`]}
      fallback={<span class="provider-label">{props.label}</span>}
    >
      {(svg) => (
        <span class="provider-logo" aria-hidden="true" innerHTML={svg()} />
      )}
    </Show>
  );
}
