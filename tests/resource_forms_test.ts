import { deepStrictEqual, throws } from "node:assert/strict";
import {
  endpointBody,
  configPatch,
  jobPatch,
  mcpBody,
  pairingRows,
  platformBody,
} from "../shared/resource-forms.ts";

Deno.test("advanced config writes preserve untouched credentials and changes from another device", () => {
  const original = {
    compression: { threshold: 0.5, enabled: true },
    model: { api_key: "********" },
    approvals: { mode: "ask" },
  };
  const edited = structuredClone(original);
  edited.compression.threshold = 0.6;
  const current = {
    ...original,
    model: { api_key: "updated-secret" },
    approvals: { mode: "auto" },
  };
  deepStrictEqual(configPatch(edited, original, current), {
    compression: { threshold: 0.6 },
  });
  throws(
    () =>
      configPatch(edited, original, {
        ...current,
        compression: { ...current.compression, threshold: 0.7 },
      }),
    /compression.threshold changed/,
  );
  deepStrictEqual(configPatch(original, original, current), {});
});

Deno.test("editing a schedule title preserves scheduling lifecycle and credentials", () => {
  const original = {
    name: "Morning",
    prompt: "Read news",
    schedule: { kind: "cron", cron: "0 8 * * *" },
    state: "scheduled",
    pending_slot: "claimed",
    id: "job-1",
  };
  deepStrictEqual(jobPatch({ ...original, name: "Daily news" }, original), {
    name: "Daily news",
  });
  deepStrictEqual(
    endpointBody({ id: "provider", api_key: "", model: "model" }),
    { id: "provider", model: "model" },
  );
  deepStrictEqual(
    platformBody({
      enabled: true,
      env: { EXISTING_TOKEN: "", NEW_TOKEN: "replacement" },
      clear_env: ["REMOVED_TOKEN"],
    }),
    {
      enabled: true,
      env: { NEW_TOKEN: "replacement" },
      clear_env: ["REMOVED_TOKEN"],
    },
  );
});

Deno.test("MCP setup enforces one transport and keeps command arguments separate", () => {
  deepStrictEqual(
    mcpBody({
      name: "local",
      command: "server",
      args: "--read-only\npath with spaces",
      env: '{"KEY":"value"}',
    }),
    {
      name: "local",
      command: "server",
      args: ["--read-only", "path with spaces"],
      env: { KEY: "value" },
    },
  );
  throws(
    () =>
      mcpBody({
        name: "ambiguous",
        command: "server",
        url: "https://example.com",
      }),
    /either/,
  );
  throws(
    () =>
      mcpBody({ name: "remote", url: "https://example.com", auth: "header" }),
    /bearer/,
  );
  throws(
    () => mcpBody({ name: "local", command: "server", env: '{"PORT":3000}' }),
    /string values/,
  );
});

Deno.test("messaging access keeps approved users visible with no pending requests", () => {
  deepStrictEqual(
    pairingRows({
      pending: [],
      approved: [{ platform: "telegram", user_id: "1" }],
    }),
    [{ platform: "telegram", user_id: "1", accessStatus: "approved" }],
  );
});
