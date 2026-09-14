import { equal } from "node:assert/strict";
import { Hermes } from "../server/hermes.ts";
import { hermesFixture } from "./hermes_fixture.ts";
import type { Turn } from "../shared/model.ts";

Deno.test("password login discovers its provider and authorizes REST and WebSocket requests", async () => {
  const fixture = hermesFixture(0, { requirePassword: true });
  const settings = {
    HERMES_URL: `http://127.0.0.1:${fixture.server.addr.port}`,
    HERMES_USERNAME: "fixture",
    HERMES_PASSWORD: "fixture-only",
    HERMES_AUTH_PROVIDER: "",
    HERMES_TOKEN: "",
  };
  const before = Object.fromEntries(
    Object.keys(settings).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(settings)) Deno.env.set(key, value);
  const hermes = new Hermes();
  try {
    await hermes.connect();
    equal(hermes.online, true);
    equal((await hermes.list()).length, 1);
  } finally {
    hermes.close();
    await fixture.close();
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});

Deno.test("live deltas arriving during replay do not overtake missing deltas", async () => {
  let sid = "",
    turn: Turn | undefined;
  const fixture = hermesFixture(0, {
    beforeReplay: () => fixture.event("message.delta", sid, { text: "third" }),
  });
  const before = Deno.env.get("HERMES_URL");
  Deno.env.set("HERMES_URL", `http://127.0.0.1:${fixture.server.addr.port}`);
  const hermes = new Hermes();
  hermes.on("turn", (value) => {
    turn = value;
  });
  async function until(check: () => boolean) {
    const end = Date.now() + 5000;
    while (!check()) {
      if (Date.now() > end) throw new Error("Timed out waiting for replay");
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  try {
    await hermes.connect();
    const created = await hermes.create("default");
    sid = created.sourceId;
    fixture.event("message.start", sid, {});
    await until(() => Boolean(turn));
    for (const socket of fixture.sockets) socket.close();
    await until(() => !hermes.online);
    fixture.event("message.delta", sid, { text: "second " });
    await until(() => turn?.text === "second third");
    equal(turn?.text, "second third");
    fixture.event("message.delta", sid, { text: " fourth" });
    await until(() => turn?.text === "second third fourth");
  } finally {
    hermes.close();
    await fixture.close();
    if (before === undefined) Deno.env.delete("HERMES_URL");
    else Deno.env.set("HERMES_URL", before);
  }
});

for (const restart of [false, true])
  Deno.test(`${restart ? "a restarted gateway" : "a truncated replay"} restores snapshots without duplicating deltas`, async () => {
    let assistant = "<think>private</think>Recovered progress";
    const fixture = hermesFixture(0, {
      truncatedReplay: !restart,
      resume: () => ({
        running: true,
        inflight: {
          assistant,
          started_at: 1700000000,
        },
      }),
    });
    const before = Deno.env.get("HERMES_URL");
    Deno.env.set("HERMES_URL", `http://127.0.0.1:${fixture.server.addr.port}`);
    const hermes = new Hermes();
    let turn: Turn | undefined;
    hermes.on("turn", (value) => {
      turn = value;
    });
    const until = async (check: () => boolean) => {
      const end = Date.now() + 6000;
      while (!check()) {
        if (Date.now() > end)
          throw new Error("Timed out waiting for restored session");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    try {
      await hermes.connect();
      const created = await hermes.create();
      fixture.event("message.start", created.sourceId, {});
      await until(() => Boolean(turn));
      if (restart) fixture.restart();
      else for (const socket of fixture.sockets) socket.close();
      await until(() => turn?.text === "Recovered progress");
      equal(turn?.startedAt, 1700000000000);
      assistant = "Recovered progress continues";
      fixture.event("message.delta", created.sourceId, { text: " continues" });
      await until(() => turn?.text === "Recovered progress continues");
      equal(turn?.recovering, true);
      fixture.event("message.complete", created.sourceId, {
        text: "Final answer",
      });
      await until(() => turn?.text === "Final answer");
      equal(turn?.recovering, false);
    } finally {
      hermes.close();
      await fixture.close();
      if (before === undefined) Deno.env.delete("HERMES_URL");
      else Deno.env.set("HERMES_URL", before);
    }
  });
