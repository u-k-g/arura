import { deepStrictEqual, equal } from "node:assert/strict";
import {
  clearsStaleEffort,
  reasoningLevels,
} from "../shared/model-reasoning.ts";

Deno.test("reasoning choices follow model and route instead of the generic effort ladder", () => {
  deepStrictEqual(reasoningLevels("opencode-go", "glm-5.2"), ["high", "max"]);
  deepStrictEqual(reasoningLevels("opencode-go", "kimi-k2.5"), [
    "none",
    "low",
    "medium",
    "high",
  ]);
  deepStrictEqual(reasoningLevels("opencode-go", "deepseek-v4.1-flash"), [
    "none",
    "low",
    "medium",
    "high",
    "max",
  ]);
  equal(reasoningLevels("unknown", "glm-5.2"), undefined);
  equal(reasoningLevels("opencode-go", "unreported"), undefined);
  deepStrictEqual(
    reasoningLevels("fixture", "model", {
      supported_efforts: ["high", "low"],
      can_disable_reasoning: false,
    }),
    ["low", "high"],
  );
  deepStrictEqual(
    reasoningLevels("fixture", "model", {
      supported_efforts: ["none", "high"],
      mandatory: true,
    }),
    ["high"],
  );
  deepStrictEqual(
    reasoningLevels("opencode-go", "kimi-k2.5", { reasoning: false }),
    [],
  );
});

Deno.test("models without a reported Go level clear the stale effort", () => {
  equal(clearsStaleEffort("opencode-go-sub", "unreported"), true);
  equal(clearsStaleEffort("opencode-go", "mimo-v2.5-pro"), true);
  equal(
    clearsStaleEffort("opencode-go", "kimi-k2.5", { reasoning: false }),
    true,
  );
  equal(clearsStaleEffort("opencode-go-sub", "glm-5.2"), false);
  equal(clearsStaleEffort("opencode-go-sub", "kimi-k2.5"), false);
  equal(clearsStaleEffort("opencode-go-sub", "deepseek-v4.1-flash"), false);
  equal(clearsStaleEffort("unknown", "unreported"), false);
  equal(clearsStaleEffort("openai", "gpt-5.6"), false);
});
