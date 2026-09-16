import { deepStrictEqual, rejects } from "node:assert/strict";
import { Hermes } from "../server/hermes.ts";
import type { RpcResult } from "../shared/contracts.ts";
class ProfileRuntime extends Hermes {
  calls: string[] = [];
  status = "idle";
  override call(method: string): Promise<RpcResult> {
    this.calls.push(method);
    if (method === "session.active_list") {
      return Promise.resolve({
        sessions: [{ id: "runtime", status: this.status }],
      });
    }
    return Promise.resolve({
      session_id: "runtime",
      stored_session_id: "stored",
      closed: true,
    });
  }
}
Deno.test("profile rename closes idle runtimes and blocks reattachment until migration finishes", async () => {
  const hermes = new ProfileRuntime();
  const created = await hermes.create("old");
  await hermes.releaseProfile("old");
  deepStrictEqual(hermes.calls, [
    "session.create",
    "session.active_list",
    "session.close",
  ]);
  await rejects(hermes.attach(created.key), /being renamed/);
  hermes.finishProfileChange("old");
  await hermes.attach(created.key);
  deepStrictEqual(hermes.calls.at(-1), "session.resume");
  hermes.close();
});
Deno.test("profile rename refuses to close an active runtime", async () => {
  const hermes = new ProfileRuntime();
  await hermes.create("old");
  hermes.status = "streaming";
  await rejects(hermes.releaseProfile("old"), /Stop active work/);
  deepStrictEqual(hermes.calls, ["session.create", "session.active_list"]);
  hermes.finishProfileChange("old");
  hermes.close();
});
