import { requireValue } from "./require_value.ts";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { Hermes } from "../server/hermes.ts";
import { operationRequest } from "../shared/resources.ts";
import { configPatch } from "../shared/resource-forms.ts";
Deno.test({
  name:
    "isolated upstream Hermes: profile, schedule, skill, memory, MCP, endpoint and webhook contracts",
  ignore: !Deno.env.get("ARURA_ISOLATED_HERMES_HOME"),
  async fn(t) {
    const home = requireValue(
      Deno.env.get("ARURA_ISOLATED_HERMES_HOME"),
      'Deno.env.get("ARURA_ISOLATED_HERMES_HOME")',
    );
    assert(
      home.startsWith("/var/tmp/"),
      "Runtime acceptance requires a disposable Hermes home",
    );
    const tokenFile = requireValue(
      Deno.env.get("ARURA_ISOLATED_HERMES_TOKEN_FILE"),
      'Deno.env.get("ARURA_ISOLATED_HERMES_TOKEN_FILE")',
    );
    Deno.env.set("HERMES_TOKEN", await Deno.readTextFile(tokenFile));
    const hermes = new Hermes();
    const roster = await hermes.rest("/api/profiles");
    assert.equal(
      roster.profiles.find(
        (profile: Record<string, unknown>) => profile.name === "default",
      )?.path,
      home,
      "Refusing writes: the dashboard is not using the disposable home",
    );
    const op = (
      name: string,
      params: Record<string, unknown> = {},
      body?: unknown,
    ) => {
      const request = operationRequest(name, params);
      return hermes.rest(request.path, request.method, body);
    };
    const suffix = crypto.randomUUID().slice(0, 8);
    await t.step(
      "advanced config patches and toolset toggles persist locally",
      async () => {
        const response = await op("config");
        const original = response.config ?? response;
        const values = structuredClone(original);
        values.compression = { ...values.compression, threshold: 0.61 };
        values.approvals = { ...values.approvals, mode: "manual" };
        const patch = configPatch(values, original, original);
        await op("saveConfig", {}, { config: patch });
        const saved = await op("config");
        assert.equal((saved.config ?? saved).compression.threshold, 0.61);
        assert.equal((saved.config ?? saved).approvals.mode, "manual");
        const tools = await op("toolsets");
        assert(Array.isArray(tools));
        const tool = tools.find(
          (row: Record<string, unknown>) => row.name === "memory",
        );
        assert(tool, "The pinned Hermes runtime exposes the memory toolset");
        await op(
          "toggleToolset",
          { id: tool.name },
          { enabled: !tool.enabled },
        );
        assert.equal(
          (await op("toolsets")).find(
            (row: Record<string, unknown>) => row.name === tool.name,
          ).enabled,
          !tool.enabled,
        );
        await op("toggleToolset", { id: tool.name }, { enabled: tool.enabled });
      },
    );
    await t.step(
      "host backup finishes before its archive is downloaded",
      async () => {
        const backup = await op("backup", {}, {});
        assert(backup.archive.startsWith(`${home}/backups/`));
        const deadline = Date.now() + 30000;
        let status: Awaited<ReturnType<Hermes["rest"]>>;
        do {
          status = await op("actionStatus", { id: "backup" });
          if (!status.running) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        } while (Date.now() < deadline);
        assert.equal(status.pid, backup.pid);
        assert.equal(status.running, false);
        assert.equal(status.exit_code, 0);
        const response = await hermes.request(
          `/api/ops/backup/download?${new URLSearchParams({
            archive: backup.archive,
          })}`,
        );
        assert.equal(response.status, 200);
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert(bytes.length > 100);
        assert.equal(new TextDecoder().decode(bytes.slice(0, 2)), "PK");
        await Deno.remove(backup.archive);
      },
    );
    await t.step(
      "profile instructions, cloning, canonical rename and deletion",
      async () => {
        const name = `arura-${suffix}`,
          clone = `${name}-clone`,
          renamed = `${name}-renamed`;
        await op("createProfile", {}, { name });
        try {
          await op(
            "saveSoul",
            { id: name },
            { content: "A disposable acceptance profile." },
          );
          await op("createProfile", {}, { name: clone, clone_from: name });
          assert.equal(
            (await op("soul", { id: clone })).content,
            "A disposable acceptance profile.",
          );
          const result = await op(
            "editProfile",
            { id: name },
            { new_name: renamed.toUpperCase() },
          );
          assert.equal(result.name, renamed);
        } finally {
          for (const id of [name, renamed, clone]) {
            await op("deleteProfile", { id }, {}).catch(() => {});
          }
        }
      },
    );
    await t.step(
      "scheduled-job create, changed-field update, pause, resume and delete",
      async () => {
        const job = await op(
          "createJob",
          {},
          {
            name: `arura-${suffix}`,
            prompt: "This test must never execute.",
            schedule: "0 8 1 1 *",
            paused: true,
            deliver: "local",
          },
        );
        assert(job.id);
        try {
          await op(
            "saveJob",
            { id: job.id },
            { updates: { name: "Renamed acceptance job" } },
          );
          assert.equal(
            (await op("job", { id: job.id })).prompt,
            "This test must never execute.",
          );
          assert.equal(
            (await op("resumeJob", { id: job.id }, {})).enabled,
            true,
          );
          assert.equal(
            (await op("pauseJob", { id: job.id }, {})).enabled,
            false,
          );
          assert(Array.isArray(await op("jobs")));
        } finally {
          await op("deleteJob", { id: job.id }, {});
        }
      },
    );
    await t.step("installed skill reading, editing and disabling", async () => {
      const name = `arura-test-${suffix}`;
      const directory = join(home, "skills", name);
      await Deno.mkdir(directory, { recursive: true });
      const content =
        `---\nname: ${name}\ndescription: Disposable acceptance skill\n---\nOnly test data.\n`;
      await Deno.writeTextFile(join(directory, "SKILL.md"), content);
      try {
        assert(
          (await op("skill", { name })).content.includes("Only test data."),
        );
        await op(
          "saveSkill",
          {},
          {
            name,
            content: content.replace("Only test data.", "Updated test data."),
          },
        );
        assert(
          (await op("skill", { name })).content.includes("Updated test data."),
        );
        await op("toggleSkill", {}, { name, enabled: false });
        assert.equal(
          (await op("skills")).find(
            (skill: Record<string, unknown>) => skill.name === name,
          ).enabled,
          false,
        );
        await op("toggleSkill", {}, { name, enabled: true });
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    });
    await t.step(
      "MCP configuration persists without requiring a remote service",
      async () => {
        const name = `arura-${suffix}`;
        await op("addMcp", {}, { name, command: "false", args: [], env: {} });
        try {
          await op("toggleMcp", { id: name }, { enabled: false });
          const servers = (await op("mcp")).servers;
          const server = Array.isArray(servers)
            ? servers.find((server) => server.name === name)
            : servers[name];
          assert.equal(server.enabled, false);
        } finally {
          await op("deleteMcp", { id: name }, {});
        }
      },
    );
    await t.step(
      "custom inference endpoint metadata and credential preservation",
      async () => {
        const endpoint = await op(
          "saveEndpoint",
          {},
          {
            name: `arura-${suffix}`,
            base_url: "http://127.0.0.1:9/v1",
            model: "acceptance-model",
            api_key: "disposable-test-key",
            discover_models: false,
          },
        );
        const list = await op("endpoints");
        const rows = Array.isArray(list) ? list : list.endpoints;
        const entry = rows.find(
          (row: Record<string, unknown>) => row.name === `arura-${suffix}`,
        );
        assert(entry?.id, JSON.stringify(Object.keys(endpoint)));
        try {
          await op(
            "saveEndpoint",
            {},
            {
              id: entry.id,
              name: entry.name,
              base_url: entry.base_url,
              model: "updated-model",
              discover_models: false,
            },
          );
          const updated = await op("endpoints");
          assert(
            (Array.isArray(updated) ? updated : updated.endpoints).some(
              (row: Record<string, unknown>) =>
                row.id === entry.id && row.model === "updated-model",
            ),
          );
        } finally {
          await op("deleteEndpoint", { id: entry.id }, {});
        }
      },
    );
    await t.step("local memory inspection and webhook lifecycle", async () => {
      const memory = await op("memory");
      assert(Array.isArray(memory.providers));
      await Deno.mkdir(join(home, "memories"), { recursive: true });
      await Deno.writeTextFile(
        join(home, "memories", "MEMORY.md"),
        "Disposable memory to reset.",
      );
      await op("resetMemory", {}, {});
      assert(
        !(await Deno.stat(join(home, "memories", "MEMORY.md")).catch(
          () => null,
        )),
      );
      await op("pauseCurator", {}, { paused: true });
      assert.equal((await op("curator")).paused, true);
      await op("pauseCurator", {}, { paused: false });
      assert.equal((await op("curator")).paused, false);
      await op("enableWebhooks", {}, {});
      const name = `arura-${suffix}`;
      const created = await op(
        "createWebhook",
        {},
        { name, prompt: "Do not trigger this disposable subscription." },
      );
      assert(typeof created.secret === "string" && created.secret.length > 20);
      try {
        await op("toggleWebhook", { id: name }, { enabled: false });
        const hooks = await op("webhooks");
        assert(
          hooks.subscriptions.every(
            (hook: Record<string, unknown>) => hook.secret === undefined,
          ),
        );
        assert(
          hooks.subscriptions.some(
            (hook: Record<string, unknown>) =>
              hook.name === name && hook.enabled === false,
          ),
        );
      } finally {
        await op("deleteWebhook", { id: name }, {});
      }
    });
    await t.step(
      "real gateway streaming and persisted public history using local inference",
      async () => {
        let calls = 0;
        const answer =
          "<think>PRIVATE_RUNTIME_REASONING</think>Runtime acceptance answer.";
        const inference = Deno.serve(
          { hostname: "127.0.0.1", port: 0, onListen() {} },
          async (request) => {
            if (
              request.method !== "POST" ||
              new URL(request.url).pathname.endsWith("/models")
            ) {
              return Response.json({
                object: "list",
                data: [{ id: "arura-acceptance", object: "model" }],
              });
            }
            const body = await request.json();
            calls++;
            const base = {
              id: `chatcmpl-${calls}`,
              created: Math.floor(Date.now() / 1000),
              model: "arura-acceptance",
            };
            if (body.stream) {
              const chunks = [
                {
                  ...base,
                  object: "chat.completion.chunk",
                  choices: [
                    {
                      index: 0,
                      delta: { role: "assistant", content: answer },
                      finish_reason: null,
                    },
                  ],
                },
                {
                  ...base,
                  object: "chat.completion.chunk",
                  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                  usage: {
                    prompt_tokens: 10,
                    completion_tokens: 10,
                    total_tokens: 20,
                  },
                },
              ];
              return new Response(
                `${
                  chunks
                    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
                    .join("")
                }data: [DONE]\n\n`,
                { headers: { "content-type": "text/event-stream" } },
              );
            }
            return Response.json({
              ...base,
              object: "chat.completion",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: answer },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 10,
                total_tokens: 20,
              },
            });
          },
        );
        let endpointId = "";
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await op(
            "saveEndpoint",
            {},
            {
              name: "Local acceptance inference",
              base_url: `http://127.0.0.1:${inference.addr.port}/v1`,
              model: "arura-acceptance",
              api_key: "disposable-local-key",
              discover_models: false,
            },
          );
          const endpoints = await op("endpoints");
          endpointId = (
            Array.isArray(endpoints) ? endpoints : endpoints.endpoints
          ).find(
            (row: Record<string, unknown>) =>
              row.name === "Local acceptance inference",
          ).id;
          await op("activateEndpoint", { id: endpointId }, {});
          await hermes.connect();
          const created = await hermes.create("default");
          const complete = new Promise<import("../shared/model.ts").Turn>(
            (resolve, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Real Hermes did not complete the local inference request",
                    ),
                  ),
                45000,
              );
              hermes.once("complete", (_key, turn) => resolve(turn));
            },
          );
          void complete.catch(() => {});
          await hermes.call("prompt.submit", {
            session_id: await hermes.attach(created.key),
            text: "Return the acceptance answer without using any tools.",
          });
          const turn = await complete;
          assert.equal(turn.state, "complete");
          assert.equal(turn.text, "Runtime acceptance answer.");
          assert(calls > 0);
          const history = await hermes.history(created.key);
          assert(
            history.messages.some((message) =>
              message.text.includes("Runtime acceptance answer.")
            ),
          );
          assert(
            !JSON.stringify(history.messages).includes(
              "PRIVATE_RUNTIME_REASONING",
            ),
          );
          const session_id = await hermes.attach(created.key);
          for (
            const [name, arg] of [
              ["goal", "Plan a garden\nverification: Five native plants"],
              ["loop", "2h Check the garden"],
              ["heartbeat", "every 2h Check the garden"],
            ]
          ) {
            try {
              await hermes.call("command.dispatch", { session_id, name, arg });
            } catch (error) {
              if (
                !(error instanceof Error) ||
                !error.message.startsWith(
                  "not a quick/plugin/bundle/skill command:",
                )
              ) {
                throw error;
              }
              await hermes.call("slash.exec", {
                session_id,
                command: `/${name} ${arg}`,
              });
            }
            const state = (
              await hermes.call("session.control.read", { session_id })
            ).control;
            assert(state?.[name], `${name} was not configured`);
            if (name === "goal") {
              assert.equal(
                state.goal.contract?.verification,
                "Five native plants",
              );
            } else assert.equal(state[name].interval_seconds, 7200);
            await hermes.call("session.control", {
              session_id,
              action: `${name}.pause`,
              args: {},
            });
            assert.equal(
              (await hermes.call("session.control.read", { session_id }))
                .control?.[name].status,
              "paused",
            );
            await hermes.call("session.control", {
              session_id,
              action: `${name}.resume`,
              args: {},
            });
            await hermes.call("session.control", {
              session_id,
              action: `${name}.${name === "loop" ? "stop" : "clear"}`,
              args: {},
            });
          }
        } finally {
          clearTimeout(timer);
          hermes.close();
          if (endpointId) {
            await op("deleteEndpoint", { id: endpointId }, {}).catch(() => {});
          }
          await inference.shutdown();
        }
      },
    );
  },
});
