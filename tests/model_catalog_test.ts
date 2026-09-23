import { deepStrictEqual } from "node:assert/strict";
import {
  addCatalogReasoning,
  catalogReasoningCapabilities,
} from "../server/model-catalog.ts";
import {
  clearsStaleEffort,
  reasoningLevels,
} from "../shared/model-reasoning.ts";

Deno.test("Go picker merges catalog models and reasoning choices", () => {
  const options = {
    providers: [
      {
        slug: "opencode-go",
        models: ["space-bunny-free", "unlisted"],
        capabilities: {
          "space-bunny-free": { reasoning: false, fast: true },
        },
      },
    ],
  };
  const catalog = {
    "opencode-go": {
      models: {
        "space-bunny-free": {
          reasoning: true,
          reasoning_options: [
            {
              type: "effort",
              values: ["low", "medium", "high", "xhigh", "max"],
            },
          ],
        },
        "catalog-only": {
          reasoning: true,
          reasoning_options: [{ type: "effort", values: ["high"] }],
        },
      },
    },
  };
  const enriched = addCatalogReasoning(options, catalog);
  const provider = (enriched.providers as typeof options.providers)[0];
  deepStrictEqual(provider.models, [
    "space-bunny-free",
    "unlisted",
    "catalog-only",
  ]);
  deepStrictEqual(provider.capabilities["space-bunny-free"], {
    reasoning: true,
    fast: true,
    supported_efforts: ["low", "medium", "high", "xhigh", "max"],
  });
  deepStrictEqual(
    reasoningLevels(
      "opencode-go",
      "space-bunny-free",
      provider.capabilities["space-bunny-free"],
    ),
    ["low", "medium", "high", "xhigh", "max"],
  );
  deepStrictEqual(
    clearsStaleEffort(
      "opencode-go",
      "space-bunny-free",
      catalogReasoningCapabilities(catalog, "opencode-go", "space-bunny-free"),
    ),
    false,
  );
});
