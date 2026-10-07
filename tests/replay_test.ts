import { equal, rejects } from "node:assert/strict";
import { Hermes } from "../server/hermes.ts";
import { hermesFixture } from "./hermes_fixture.ts";
import type { Turn } from "../shared/model.ts";

Deno.test("a startup login failure retries without a browser refresh", async () => {
  const fixture = hermesFixture(0);
  const before = Deno.env.get("HERMES_URL");
  Deno.env.set("HERMES_URL", `http://127.0.0.1:${fixture.server.addr.port}`);
  class StartingHermes extends Hermes {
    attempts = 0;
    override async login() {
      if (++this.attempts === 1) throw new Error("Dashboard is starting");
      await super.login();
    }
  }
  const hermes = new StartingHermes();
  try {
    await rejects(hermes.connect(), /Dashboard is starting/);
    const deadline = Date.now() + 6000;
    while (!hermes.online) {
      if (Date.now() > deadline) {
        throw new Error("Startup retry did not connect");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    equal(hermes.attempts, 2);
  } finally {
    hermes.close();
    await fixture.close();
    if (before === undefined) Deno.env.delete("HERMES_URL");
    else Deno.env.set("HERMES_URL", before);
  }
});

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

Deno.test("first model token precedes visible output when reasoning or a tool call streams first", async () => {
  const fixture = hermesFixture(0);
  const before = Deno.env.get("HERMES_URL");
  Deno.env.set("HERMES_URL", `http://127.0.0.1:${fixture.server.addr.port}`);
  const hermes = new Hermes();
  const turns = new Map<string, Turn>();
  hermes.on("turn", (turn: Turn) => turns.set(turn.conversation, turn));
  const until = async (check: () => boolean) => {
    const end = Date.now() + 5000;
    while (!check()) {
      if (Date.now() > end) {
        throw new Error("Timed out waiting for Hermes event");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    await hermes.connect();
    const reasoning = await hermes.create("default");
    fixture.event("message.start", reasoning.sourceId, {});
    fixture.event("reasoning.delta", reasoning.sourceId, {
      text: "private thought",
    });
    await until(() => Boolean(turns.get(reasoning.key)?.stats?.firstTokenAt));
    equal(turns.get(reasoning.key)?.text, "");
    const first = turns.get(reasoning.key)?.stats?.firstTokenAt;
    fixture.event("message.delta", reasoning.sourceId, { text: "Answer" });
    await until(() => turns.get(reasoning.key)?.text === "Answer");
    equal(turns.get(reasoning.key)?.stats?.firstTokenAt, first);
    equal(
      turns.get(reasoning.key)?.stats?.milestones.filter((m) =>
        m.label === "First model token"
      ).length,
      1,
    );

    const tool = await hermes.create("default");
    fixture.event("message.start", tool.sourceId, {});
    fixture.event("tool.generating", tool.sourceId, {
      name: "web_search",
      tool_call_id: "search-1",
    });
    await until(() => Boolean(turns.get(tool.key)?.stats?.firstTokenAt));
    equal(turns.get(tool.key)?.text, "");
    fixture.event("tool.start", tool.sourceId, {
      name: "web_search",
      tool_call_id: "search-1",
    });
    await until(() =>
      Boolean(
        turns.get(tool.key)?.stats?.milestones.some((m) =>
          m.label === "web_search started"
        ),
      )
    );
  } finally {
    hermes.close();
    await fixture.close();
    if (before === undefined) Deno.env.delete("HERMES_URL");
    else Deno.env.set("HERMES_URL", before);
  }
});

Deno.test("assistant speed excludes tool calls and uses the answer step", async () => {
  const fixture = hermesFixture(0);
  const before = Deno.env.get("HERMES_URL");
  Deno.env.set("HERMES_URL", `http://127.0.0.1:${fixture.server.addr.port}`);
  const hermes = new Hermes();
  const turns = new Map<string, Turn>();
  hermes.on("turn", (turn: Turn) => turns.set(turn.conversation, turn));
  const until = async (check: () => boolean) => {
    const end = Date.now() + 5000;
    while (!check()) {
      if (Date.now() > end) {
        throw new Error("Timed out waiting for Hermes event");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    await hermes.connect();
    const answer = await hermes.create("default");
    fixture.event("message.start", answer.sourceId, {});
    fixture.event("reasoning.delta", answer.sourceId, {
      text: "plan the search",
    });
    fixture.event("tool.start", answer.sourceId, {
      name: "web_search",
      tool_call_id: "search-1",
    });
    fixture.event("tool.complete", answer.sourceId, {
      name: "web_search",
      tool_call_id: "search-1",
    });
    fixture.event("tool.start", answer.sourceId, {
      name: "web_extract",
      tool_call_id: "search-2",
    });
    fixture.event("tool.complete", answer.sourceId, {
      name: "web_extract",
      tool_call_id: "search-2",
    });
    fixture.event("session.usage", answer.sourceId, {
      usage: { output: 5000, reasoning: 1000, model: "fixture-model" },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    fixture.event("reasoning.delta", answer.sourceId, { text: "private" });
    fixture.event("message.delta", answer.sourceId, { text: "Answer" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    fixture.event("message.complete", answer.sourceId, {
      text: "Answer",
      usage: { output: 5100, reasoning: 1040, model: "fixture-model" },
    });
    await until(() =>
      typeof turns.get(answer.key)?.stats?.tokensPerSecond === "number"
    );
    const stats = turns.get(answer.key)?.stats;
    const resumed = stats?.milestones.find((item) =>
      item.label === "Model resumed"
    )?.at;
    const finished = stats?.milestones.findLast((item) =>
      item.label === "Finished"
    )?.at;
    if (
      resumed === undefined || finished === undefined ||
      !stats?.tokensPerSecond
    ) {
      throw new Error("missing answer speed");
    }
    const expected = 100 / ((finished - resumed) / 1000);
    if (
      stats.tokensPerSecond < expected * 0.5 ||
      stats.tokensPerSecond > expected * 1.5
    ) {
      throw new Error(
        `speed ${stats.tokensPerSecond} is outside the answer step (${expected})`,
      );
    }
    equal(stats.model, "fixture-model");

    fixture.event("message.start", answer.sourceId, {});
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.event("message.delta", answer.sourceId, { text: "Next" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    fixture.event("message.complete", answer.sourceId, {
      text: "Next",
      usage: { output: 5300, reasoning: 1080, model: "fixture-model" },
    });
    await until(() => {
      const speed = turns.get(answer.key)?.stats?.tokensPerSecond;
      return typeof speed === "number" && speed > 10;
    });
    const followUp = turns.get(answer.key)?.stats;
    const followStart = followUp?.milestones.find((item) =>
      item.label === "First model token"
    )?.at;
    const followEnd = followUp?.milestones.findLast((item) =>
      item.label === "Finished"
    )?.at;
    if (
      followStart === undefined || followEnd === undefined ||
      !followUp?.tokensPerSecond
    ) {
      throw new Error("missing follow-up speed");
    }
    const followExpected = 200 / ((followEnd - followStart) / 1000);
    if (
      followUp.tokensPerSecond < followExpected * 0.5 ||
      followUp.tokensPerSecond > followExpected * 1.5
    ) {
      throw new Error(
        `follow-up speed ${followUp.tokensPerSecond} is outside ${followExpected}`,
      );
    }

    const toolsOnly = await hermes.create("default");
    fixture.event("message.start", toolsOnly.sourceId, {});
    fixture.event("tool.start", toolsOnly.sourceId, {
      name: "web_search",
      tool_call_id: "only",
    });
    fixture.event("session.usage", toolsOnly.sourceId, {
      usage: { output: 80, reasoning: 20 },
    });
    fixture.event("tool.complete", toolsOnly.sourceId, {
      name: "web_search",
      tool_call_id: "only",
    });
    fixture.event("message.complete", toolsOnly.sourceId, {
      text: "",
      usage: { output: 80, reasoning: 20, model: "fixture-model" },
    });
    await until(() => turns.get(toolsOnly.key)?.state === "complete");
    await new Promise((resolve) => setTimeout(resolve, 200));
    equal(turns.get(toolsOnly.key)?.stats?.tokensPerSecond, undefined);
  } finally {
    hermes.close();
    await fixture.close();
    if (before === undefined) Deno.env.delete("HERMES_URL");
    else Deno.env.set("HERMES_URL", before);
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

for (const restart of [false, true]) {
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
        if (Date.now() > end) {
          throw new Error("Timed out waiting for restored session");
        }
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
      equal(turn?.recovering, false);
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
}

Deno.test("new sessions load before persistence and survive adapter reconnection", async () => {
  const fixture = hermesFixture(0);
  const before = Deno.env.get("HERMES_URL");
  Deno.env.set("HERMES_URL", `http://127.0.0.1:${fixture.server.addr.port}`);
  const first = new Hermes(),
    second = new Hermes();
  try {
    await first.connect();
    const created = await first.create();
    equal(created.pendingPersistence, true);
    equal(
      (await first.list()).some((c) => c.key === created.key),
      false,
    );
    equal((await first.history(created.key)).messages.length, 0);
    first.close();
    await second.connect();
    equal((await second.history(created.key)).messages.length, 0);
    await rejects(
      second.history(JSON.stringify(["default", "missing-session"])),
      /not found/i,
    );
    const session_id = await second.attach(created.key);
    await second.call("prompt.submit", {
      session_id,
      text: "First message",
      profile: "default",
    });
    equal(
      (await second.list()).some((c) => c.key === created.key),
      true,
    );
    equal((await second.history(created.key)).messages.length > 0, true);
  } finally {
    first.close();
    second.close();
    await fixture.close();
    if (before === undefined) Deno.env.delete("HERMES_URL");
    else Deno.env.set("HERMES_URL", before);
  }
});

Deno.test("adapter startup reconciles persisted running turns against an idle gateway", async () => {
  const fixture = hermesFixture(0, { resume: () => ({ running: false }) });
  const before = Deno.env.get("HERMES_URL");
  Deno.env.set("HERMES_URL", `http://127.0.0.1:${fixture.server.addr.port}`);
  const hermes = new Hermes();
  const key = JSON.stringify(["default", "fixture-chat"]);
  let restored: { conversation: string; startedAt: number } | undefined;
  hermes.restoreRunningTurns([
    {
      conversation: key,
      state: "running",
      startedAt: Date.now() - 86400000,
      text: "Last known answer",
      activity: [{ id: "old-tool", label: "read_file", state: "complete" }],
      interactions: [],
    },
  ]);
  hermes.on("idle", (turn: { conversation: string; startedAt: number }) => {
    if (turn.conversation === key) restored = turn;
  });
  try {
    await hermes.connect();
    const deadline = Date.now() + 6000;
    while (!restored) {
      if (Date.now() > deadline) {
        throw new Error("Persisted run was not reconciled at startup");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    equal(restored.conversation, key);
    equal(typeof restored.startedAt, "number");
  } finally {
    hermes.close();
    await fixture.close();
    if (before === undefined) Deno.env.delete("HERMES_URL");
    else Deno.env.set("HERMES_URL", before);
  }
});
