import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { Hermes } from "../server/hermes.ts";
import type { RpcResult } from "../shared/contracts.ts";

class EditRuntime extends Hermes {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  attempts = 0;
  closed = false;
  rejectFirst = true;
  failure = "target user message is no longer in session history";
  override call(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<RpcResult> {
    this.calls.push({ method, params });
    if (method === "session.resume") {
      return Promise.resolve({ session_id: "live", running: false });
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
}
const key = '["default","stored"]';
const params = {
  text: "Revised prompt",
  truncate_before_row_id: "3280",
  confirm_truncate: true,
  confirm_empty_truncate: true,
};
Deno.test("an edit is one submit against the open runtime", async () => {
  const hermes = new EditRuntime();
  hermes.rejectFirst = false;
  await hermes.submitPrompt(key, params);
  deepStrictEqual(
    hermes.calls.map((call) => call.method),
    ["session.resume", "prompt.submit"],
  );
  deepStrictEqual(hermes.calls.at(-1)?.params, {
    ...params,
    session_id: "live",
  });
  equal(hermes.closed, false);
  hermes.close();
});
Deno.test("a refused edit is returned once and leaves the runtime open", async () => {
  const hermes = new EditRuntime();
  await rejects(
    hermes.submitPrompt(key, params),
    /no longer in session history/,
  );
  equal(hermes.closed, false);
  equal(hermes.attempts, 1);
  deepStrictEqual(
    hermes.calls.map((call) => call.method),
    ["session.resume", "prompt.submit"],
  );
  hermes.close();
});
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
