import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { Hermes } from "../server/hermes.ts";
import type { RpcResult } from "../shared/contracts.ts";

class EditRuntime extends Hermes {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  attempts = 0;
  closed = false;
  targetPresent = true;
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
    if (method === "session.history") {
      return Promise.resolve({
        messages: this.targetPresent ? [{ row_id: 3280, role: "user" }] : [],
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
    if (method === "prompt.submit" && ++this.attempts === 1) {
      return Promise.reject(new Error(this.failure));
    }
    return Promise.resolve({ status: "complete" });
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
      "session.history",
      "session.active_list",
      "session.close",
      "session.resume",
      "image.attach",
      "prompt.submit",
    ],
  );
  deepStrictEqual(hermes.calls.at(-1)?.params, {
    ...params,
    session_id: "fresh",
  });
  equal(hermes.attempts, 2);
  hermes.close();
});
for (const scenario of ["missing", "busy", "unknown"] as const) {
  Deno.test(`editing does not retry or close a runtime when the target is ${scenario}`, async () => {
    const hermes = new EditRuntime();
    if (scenario === "missing") hermes.targetPresent = false;
    if (scenario === "busy") hermes.status = "working";
    if (scenario === "unknown") {
      hermes.failure = "Connection lost; outcome unknown";
    }
    await rejects(hermes.submitPrompt(key, params));
    equal(hermes.closed, false);
    equal(hermes.attempts, 1);
    hermes.close();
  });
}
