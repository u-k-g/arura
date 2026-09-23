const catalogUrl = "https://models.dev/api.json";
const refreshAfter = 4 * 60 * 60 * 1000;
const retryAfter = 5 * 60 * 1000;

type CatalogModel = {
  reasoning?: boolean;
  reasoning_options?: {
    type?: string;
    values?: (string | null)[];
  }[];
};
type Catalog = Record<string, { models?: Record<string, CatalogModel> }>;
type ModelProvider = {
  slug?: string;
  models?: string[];
  capabilities?: Record<string, Record<string, unknown>>;
};

let catalog: Catalog = {};
let expiresAt = 0;
let pending: Promise<Catalog> | undefined;

function refreshCatalog(): Promise<Catalog> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch(catalogUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Model catalog: ${response.status}`);
      catalog = (await response.json()) as Catalog;
      expiresAt = Date.now() + refreshAfter;
    } catch {
      // The Hermes inventory and any previous catalog remain available offline.
      expiresAt = Date.now() + retryAfter;
    } finally {
      pending = undefined;
    }
    return catalog;
  })();
  return pending;
}

async function loadCatalog(): Promise<Catalog> {
  if (Date.now() < expiresAt) return catalog;
  if (Object.keys(catalog).length) {
    // Keep the picker instant while refreshing a stale snapshot in background.
    void refreshCatalog();
    return catalog;
  }
  return refreshCatalog();
}

const normalizeProvider = (slug: string) =>
  slug.toLowerCase().replaceAll("_", "-");
const catalogProvider = (slug: string) => {
  const normalized = normalizeProvider(slug);
  return normalized === "opencode-go-sub" || normalized === "go"
    ? "opencode-go"
    : normalized;
};
const isGoProvider = (slug: string) =>
  ["opencode-go", "opencode-go-sub", "go"].includes(normalizeProvider(slug));

export function catalogReasoningCapabilities(
  data: Catalog,
  provider: string,
  model: string,
): { reasoning: boolean; supported_efforts: string[] } | undefined {
  if (!isGoProvider(provider)) return undefined;
  const models = data[catalogProvider(provider)]?.models;
  const entry = models?.[model] ?? models?.[model.split("/").pop() ?? ""];
  const effort = entry?.reasoning_options?.find(
    (option) => option.type === "effort",
  );
  if (!entry || !effort?.values) return undefined;
  return {
    reasoning: entry.reasoning !== false,
    supported_efforts: effort.values.map((value) => value ?? "none"),
  };
}

export async function currentCatalogReasoningCapabilities(
  provider: string,
  model: string,
) {
  if (!isGoProvider(provider)) return undefined;
  return catalogReasoningCapabilities(await loadCatalog(), provider, model);
}

export function addCatalogReasoning(
  options: Record<string, unknown>,
  data: Catalog,
): Record<string, unknown> {
  const providers = options.providers;
  if (!Array.isArray(providers)) return options;
  return {
    ...options,
    providers: providers.map((provider: ModelProvider) => {
      if (!isGoProvider(provider.slug ?? "") || !provider.models) {
        return provider;
      }
      const catalogModels = data[catalogProvider(provider.slug ?? "")]?.models;
      if (!catalogModels) return provider;
      const modelIds = [
        ...new Set([...provider.models, ...Object.keys(catalogModels)]),
      ];
      const capabilities = { ...provider.capabilities };
      for (const id of modelIds) {
        const reasoning = catalogReasoningCapabilities(
          data,
          provider.slug ?? "",
          id,
        );
        if (!reasoning) continue;
        capabilities[id] = {
          ...capabilities[id],
          ...reasoning,
        };
      }
      return { ...provider, models: modelIds, capabilities };
    }),
  };
}

export async function withCatalogReasoning(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (
    !Array.isArray(options.providers) ||
    !options.providers.some((provider: ModelProvider) =>
      isGoProvider(provider.slug ?? "")
    )
  ) {
    return options;
  }
  return addCatalogReasoning(options, await loadCatalog());
}
