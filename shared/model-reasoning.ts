export type ReasoningCapabilities = {
  reasoning?: boolean;
  supports_reasoning?: boolean;
  can_disable_reasoning?: boolean;
  mandatory?: boolean;
  supported_efforts?: string[];
};
const order = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

// Hermes 0.21.3 inventory omits supported_efforts. Compatibility sets below
// follow its route-specific translations, not the wider internal effort scale.
// https://github.com/NousResearch/hermes-agent/blob/3c3ab69abb9b08683b5eb15b4e2b8be1198c875f/agent/reasoning_effort.py
// https://github.com/NousResearch/hermes-agent/blob/3c3ab69abb9b08683b5eb15b4e2b8be1198c875f/plugins/model-providers/opencode-zen/__init__.py
export function reasoningLevels(
  provider: string,
  model: string,
  caps?: ReasoningCapabilities,
): string[] | undefined {
  if (caps?.reasoning === false || caps?.supports_reasoning === false) {
    return [];
  }
  let levels = caps?.supported_efforts;
  const p = provider.toLowerCase().replaceAll("_", "-");
  const m = model.toLowerCase().split("/").pop() ?? "";
  if (!levels) {
    if (["opencode-go", "opencode-go-sub", "go"].includes(p)) {
      if (/glm-5(?:[.-]2|p2)/.test(m)) levels = ["high", "max"];
      else if (m.startsWith("kimi-k2")) {
        levels = ["none", "low", "medium", "high"];
      } else if (
        (m.startsWith("deepseek-v") && !m.startsWith("deepseek-v3")) ||
        ["deepseek-reasoner", "deepseek-flash"].includes(m)
      ) {
        levels = ["none", "low", "medium", "high", "max"];
      }
    } else if (["zai", "glm", "z-ai", "z.ai", "zhipu"].includes(p)) {
      if (/glm-5(?:[.-]3|p3)/.test(m)) {
        levels = ["none", "low", "medium", "high", "max"];
      } else if (/glm-5(?:[.-]2|p2)/.test(m)) levels = ["none", "high", "max"];
    } else if (p === "deepseek" && m.startsWith("deepseek-v4")) {
      levels = ["none", "low", "medium", "high", "max"];
    } else if (
      ["openai-codex", "codex", "openai"].includes(p) &&
      /^gpt-(?:5|6|daybreak)/.test(m)
    ) {
      levels = m.startsWith("gpt-6-astra")
        ? ["low", "medium", "high", "xhigh", "max"]
        : /gpt-5\.6|gpt-daybreak-blue-latest/.test(m)
          ? ["none", "low", "medium", "high", "xhigh", "max"]
          : ["none", "low", "medium", "high", "xhigh"];
    }
  }
  if (!levels) return undefined;
  const values = new Set(levels);
  if (caps?.mandatory || caps?.can_disable_reasoning === false) {
    values.delete("none");
  }
  return [...values].sort(
    (a, b) =>
      (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) -
      (order.indexOf(b) < 0 ? 99 : order.indexOf(b)),
  );
}

// The Go relay rejects a stale reasoning_effort on models without a reported
// level (HTTP 500). "none" parses to disabled, which omits the wire field, so
// switching to such a model must clear the session effort instead of leaving
// the previous model's level in place. Scoped to the Go route: other providers
// handle a generic effort without erroring, and their inventory reports real
// capabilities through model.options.
export function clearsStaleEffort(
  provider: string,
  model: string,
  caps?: ReasoningCapabilities,
): boolean {
  const p = provider.toLowerCase().replaceAll("_", "-");
  if (!["opencode-go", "opencode-go-sub", "go"].includes(p)) return false;
  return !reasoningLevels(provider, model, caps)?.length;
}
