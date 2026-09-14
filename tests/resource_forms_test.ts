import { deepStrictEqual, throws } from "node:assert/strict";
import {
  endpointBody,
  jobPatch,
  mcpBody,
  pairingRows,
  platformBody,
} from "../shared/resource-forms.ts";

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
