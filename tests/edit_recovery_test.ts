import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { Hermes } from "../server/hermes.ts";
import type { RpcResult } from "../shared/contracts.ts";

class EditRuntime extends Hermes {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  restPaths: string[] = [];
  attempts = 0;
  closed = false;
  targetPresent = true;
  rejectFirst = true;
  status = "idle";
  failure = "target user message is no longer in session history";
  override call(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<RpcResult> {
    this.calls.push({ method, params });
    if (method === "session.resume") {
      return Promise.resolve({
        session_id: this.closed ? "fresh" : "stale",
        running: false,
      });
    }
    if (method === "session.active_list") {
      return Promise.resolve({
        sessions: [{ id: "stale", status: this.status }],
      });
    }
    if (method === "session.close") {
      this.closed = true;
      return Promise.resolve({ closed: true });
    }
    if (
      method === "prompt.submit" &&
      this.rejectFirst &&
      ++this.attempts === 1
    ) {
      return Promise.reject(new Error(this.failure));
    }
    return Promise.resolve({ status: "complete" });
  }
  // The durable store answers independently of the warm runtime; its default
  // read excludes compaction-archived rows.
  override rest(path: string): Promise<Record<string, unknown>> {
    this.restPaths.push(path);
    return Promise.resolve({
      messages: this.targetPresent ? [{ id: 3280, role: "user" }] : [],
    });
  }
}
const key = '["default","stored"]';
const params = {
  text: "Revised prompt",
  truncate_before_row_id: "3280",
  confirm_truncate: true,
  confirm_empty_truncate: true,
};
Deno.test("editing recovers a stale idle runtime and retries the same durable target with images", async () => {
  const hermes = new EditRuntime();
  await hermes.submitPrompt(key, params, ["/image.png"]);
  deepStrictEqual(
    hermes.calls.map((c) => c.method),
    [
      "session.resume",
      "prompt.submit",
      "session.active_list",
      "session.close",
      "session.resume",
      "image.attach",
      "prompt.submit",
    ],
  );
  equal(hermes.restPaths.length, 1);
  equal(hermes.restPaths[0].startsWith("/api/sessions/stored/messages?"), true);
  deepStrictEqual(hermes.calls.at(-1)?.params, {
    ...params,
    session_id: "fresh",
  });
  equal(hermes.attempts, 2);
  hermes.close();
});
Deno.test("editing a target the durable store no longer carries fails plainly without closing the runtime", async () => {
  const hermes = new EditRuntime();
  hermes.targetPresent = false;
  await rejects(
    hermes.submitPrompt(key, params),
    /no longer be edited.*compacted/,
  );
  equal(hermes.closed, false);
  equal(hermes.attempts, 1);
  hermes.close();
});
for (const scenario of ["busy", "unknown"] as const) {
  Deno.test(`editing does not retry or close a runtime when the target is ${scenario}`, async () => {
    const hermes = new EditRuntime();
    if (scenario === "busy") hermes.status = "working";
    if (scenario === "unknown") {
      hermes.failure = "Connection lost; outcome unknown";
    }
    await rejects(hermes.submitPrompt(key, params));
    equal(hermes.closed, false);
    equal(hermes.attempts, 1);
    if (scenario === "unknown") equal(hermes.restPaths.length, 0);
    hermes.close();
  });
}
Deno.test("a failed submit settles the dispatch-time projection instead of leaving a phantom run", async () => {
  const hermes = new EditRuntime();
  hermes.failure = "Connection lost; outcome unknown";
  const states: string[] = [];
  const idles: number[] = [];
  hermes.on("turn", (turn: { state: string }) => states.push(turn.state));
  hermes.on("idle", (turn: { startedAt: number }) =>
    idles.push(turn.startedAt),
  );
  await rejects(hermes.submitPrompt(key, { text: "Hello" }));
  deepStrictEqual(states, ["running"]);
  equal(idles.length, 1);
  hermes.close();
});
Deno.test("an accepted submit keeps the dispatch-time projection running", async () => {
  const hermes = new EditRuntime();
  hermes.rejectFirst = false;
  const states: string[] = [];
  const idles: number[] = [];
  hermes.on("turn", (turn: { state: string }) => states.push(turn.state));
  hermes.on("idle", (turn: { startedAt: number }) =>
    idles.push(turn.startedAt),
  );
  await hermes.submitPrompt(key, { text: "Hello" });
  deepStrictEqual(states, ["running"]);
  equal(idles.length, 0);
  hermes.close();
});
