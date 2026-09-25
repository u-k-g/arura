import { toolPresentation } from "../shared/tool-presentation.ts";
import {
  type HistoryIndexItem,
  record,
  type RpcFrame,
  type RpcResult,
} from "../shared/contracts.ts";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { fileReferences } from "../shared/artifacts.ts";
import {
  conversationKey,
  interactionFromEvent,
  normalizeMessages,
  plainText,
  streamedInterimText,
  type Turn,
  visibleText,
} from "../shared/model.ts";

type Pending = {
  resolve: (value: RpcResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
function assertSession(
  result: RpcResult,
): asserts result is RpcResult & { session_id: string } {
  if (typeof result.session_id !== "string" || !result.session_id) {
    throw new Error("Hermes did not return a session identifier");
  }
}
function epochMillis(value: unknown, fallbackSeconds = 0): number {
  const raw = Number(value ?? fallbackSeconds);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 1e12 ? raw * 1000 : raw;
}
export class HermesHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export class Hermes extends EventEmitter {
  readonly base = new URL(process.env.HERMES_URL || "http://127.0.0.1:9119");
  private cookies = new Map<string, string>();
  private socket?: WebSocket;
  private stopped = false;
  private counter = 0;
  private pending = new Map<number, Pending>();
  private epoch = "";
  private seq = new Map<string, number>();
  private runtime = new Map<string, string>();
  private attaching = new Map<string, Promise<string>>();
  private reverse = new Map<string, string>();
  private turns = new Map<string, Turn>();
  private interimStreams = new Map<string, { interim: string; stream: string }>();
  private persistedTurns = new Set<string>();
  private connecting?: Promise<void>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private authPromise?: Promise<void>;
  private replaying = new Set<string>();
  private held = new Map<string, RpcFrame[]>();
  private recovering = new Map<
    string,
    { timer?: ReturnType<typeof setTimeout> }
  >();
  online = false;
  private changingProfiles = new Set<string>();
  // Restore only unfinished projections; gateway snapshots remain authoritative.
  restoreRunningTurns(turns: Turn[]) {
    for (const turn of turns) {
      if (turn.state === "running" && !this.turns.has(turn.conversation)) {
        this.turns.set(turn.conversation, turn);
        this.persistedTurns.add(turn.conversation);
      }
    }
  }
  async passwordLogin(username: string, password: string): Promise<Response> {
    let provider = process.env.HERMES_AUTH_PROVIDER;
    if (!provider) {
      const response = await fetch(new URL("/api/auth/providers", this.base), {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new Error("Could not discover Hermes authentication providers");
      }
      const available = ((await response.json()).providers ?? []).filter(
        (item: { supports_password?: boolean }) => item.supports_password,
      );
      if (available.length !== 1) {
        throw new Error(
          "Configure HERMES_AUTH_PROVIDER for this Hermes installation",
        );
      }
      provider = available[0].name;
    }
    return fetch(new URL("/auth/password-login", this.base), {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, username, password }),
      signal: AbortSignal.timeout(15000),
    });
  }
  async login() {
    const username = process.env.HERMES_USERNAME;
    if (!username) return;
    if (this.authPromise) return await this.authPromise;
    this.authPromise = (async () => {
      const r = await this.passwordLogin(
        username,
        process.env.HERMES_PASSWORD ?? "",
      );
      if (!r.ok) throw new Error(`Hermes authorization failed (${r.status})`);
      this.captureCookies(r);
      if (!this.cookies.size) {
        throw new Error(
          "Hermes accepted the login without issuing a session cookie",
        );
      }
    })().finally(() => {
      this.authPromise = undefined;
    });
    return await this.authPromise;
  }
  private captureCookies(r: Response) {
    for (const cookie of r.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  private headers() {
    return {
      ...(process.env.HERMES_TOKEN
        ? { "X-Hermes-Session-Token": process.env.HERMES_TOKEN }
        : {}),
      ...(this.cookies.size
        ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
        : {}),
    };
  }
  async request(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<Response> {
    const r = await fetch(new URL(path, this.base), {
      ...init,
      redirect: "manual",
      headers: { ...this.headers(), ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(60000),
    });
    this.captureCookies(r);
    if (
      [401, 403, 302, 307].includes(r.status) &&
      retry &&
      process.env.HERMES_USERNAME
    ) {
      await this.login();
      return this.request(path, init, false);
    }
    return r;
  }
  async rest(path: string, method = "GET", body?: unknown) {
    const r = await this.request(path, {
      method,
      ...(body === undefined ? {} : {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      let message = `Hermes request failed (${r.status})`;
      try {
        message = JSON.parse(text).detail ?? message;
      } catch {
        /* Preserve HTTP status when the error body is not JSON. */
      }
      throw new HermesHttpError(
        typeof message === "string" ? message : JSON.stringify(message),
        r.status,
      );
    }
    if (r.status === 204) return { ok: true };
    return r.json();
  }
  async connect(): Promise<void> {
    if (this.stopped) return;
    if (this.online) return;
    if (this.connecting) return await this.connecting;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.connecting = this.open()
      .catch((error) => {
        this.scheduleReconnect();
        throw error;
      })
      .finally(() => {
        this.connecting = undefined;
      });
    return await this.connecting;
  }
  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer !== undefined) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) => this.emit("fault", error));
    }, 2000);
  }
  private async open() {
    await this.login();
    const url = new URL("/api/ws", this.base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (process.env.HERMES_USERNAME) {
      const { ticket } = await this.rest("/api/auth/ws-ticket", "POST", {});
      url.searchParams.set("ticket", ticket);
    } else if (process.env.HERMES_TOKEN) {
      url.searchParams.set("token", process.env.HERMES_TOKEN);
    }
    if (this.stopped) return;
    const socket = new WebSocket(url, { headers: this.headers() });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error("Hermes connection timed out"));
      }, 15000);
      socket.once("open", () => {
        clearTimeout(timer);
        this.online = true;
        this.emit("connection", true);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("message", (raw) => {
        try {
          this.receive(JSON.parse(raw.toString()));
        } catch (error) {
          this.emit("fault", error);
        }
      });
      socket.on("close", () => {
        clearTimeout(timer);
        this.online = false;
        this.emit("connection", false);
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(
            new Error("Hermes disconnected; command outcome may be unknown"),
          );
        }
        this.pending.clear();
        this.scheduleReconnect();
      });
    });
  }
  close() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    for (const sid of this.recovering.keys()) this.stopRecovery(sid);
    this.socket?.close();
  }
  call(
    method: string,
    params: Record<string, unknown> = {},
    timeout = 30000,
  ): Promise<RpcResult> {
    const socket = this.socket;
    if (!this.online || socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Hermes is disconnected"));
    }
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "Hermes response timed out; command outcome may be unknown",
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }
  private receive(frame: RpcFrame) {
    if (frame.id !== undefined) {
      const p = this.pending.get(frame.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(frame.id);
        frame.error
          ? p.reject(
            Object.assign(new Error(frame.error.message), {
              code: frame.error.code,
            }),
          )
          : p.resolve(frame.result ?? {});
      }
      return;
    }
    if (frame.method !== "event") return;
    const event = frame.params ?? {};
    const payload = event.payload ?? {};
    if (event.type === "gateway.ready") {
      const changed = this.epoch !== payload.replay_epoch;
      this.epoch = String(payload.replay_epoch ?? "");
      if (changed) {
        for (const sid of this.recovering.keys()) this.stopRecovery(sid);
        const keys = [
          ...new Set([...this.runtime.keys(), ...this.turns.keys()]),
        ];
        this.seq.clear();
        this.runtime.clear();
        this.reverse.clear();
        this.replaying.clear();
        this.held.clear();
        this.emit("reconcile");
        void this.restore(keys);
      } else void this.replay();
      return;
    }
    if (event.type === "sessions.changed") {
      this.emit("reconcile");
      return;
    }
    if (event.type === "profiles.changed") this.emit("reconcile");
    if (String(event.type).endsWith(".changed")) this.emit("changed");
    if (
      event.type === "session.control.update" ||
      String(event.type).startsWith("subagent.")
    ) {
      this.emit("changed");
    }
    const sid = event.session_id;
    if (!sid) return;
    if (this.replaying.has(sid)) {
      const held = this.held.get(sid) ?? [];
      held.push(frame);
      this.held.set(sid, held);
      return;
    }
    const key = this.reverse.get(sid);
    if (!key) return;
    if (typeof event.seq === "number") {
      const previous = this.seq.get(sid);
      if (event.seq <= (previous ?? 0)) return;
      if (
        previous !== undefined &&
        event.seq > previous + 1 &&
        !["message.start", "message.complete"].includes(event.type ?? "")
      ) {
        this.startRecovery(sid, key);
        this.emit("resync", key);
      }
      this.seq.set(sid, event.seq);
    }
    const type = String(event.type);
    if (type === "message.start" || type === "message.complete") {
      this.stopRecovery(sid);
    }
    if (type === "message.delta" && this.recovering.has(sid)) return;
    if (/reasoning|thinking/.test(type)) return;
    let turn = this.turns.get(key);
    if (type === "message.start" || (!turn && type === "message.delta")) {
      this.interimStreams.delete(key);
      turn = {
        conversation: key,
        text: "",
        activity: [],
        // A dispatch-time projection already started the clock; keeping it
        // stops the elapsed time from visibly resetting on the first event.
        startedAt: turn?.state === "running" ? turn.startedAt : Date.now(),
        state: "running",
        interactions: [],
      };
      this.turns.set(key, turn);
      this.emit("started", key);
    }
    if (!turn) return;
    if (type.endsWith(".expire")) {
      turn.interactions = turn.interactions.filter(
        (x) => x.id !== payload.request_id,
      );
    }
    if (type === "message.delta") {
      const delta = typeof payload.text === "string" ? payload.text : "";
      const interim = this.interimStreams.get(key);
      if (interim) {
        interim.stream += delta;
        turn.text = streamedInterimText(interim.interim, interim.stream);
      } else turn.text += delta;
    }
    if (type === "message.interim") {
      turn.text = visibleText(payload.text);
      this.interimStreams.set(key, { interim: turn.text, stream: "" });
    }
    if (type === "tool.start" || type === "tool.generating") {
      const id = String(
        payload.tool_call_id ??
          payload.id ??
          payload.name ??
          payload.tool ??
          turn.activity.length,
      );
      const entry = turn.activity.find((x) => x.id === id);
      if (!entry) {
        turn.activity.push({
          id,
          label: toolPresentation(
            String(
              payload.name ?? payload.tool ?? payload.tool_name ?? "Working",
            ),
            payload.arguments ?? payload.input ?? payload.args,
          ).label,
          state: "running",
        });
      }
    }
    if (type === "tool.complete") {
      const entry = turn.activity.find(
        (x) => x.id === String(payload.tool_call_id ?? payload.id),
      ) ?? turn.activity.findLast((x) => x.state === "running");
      if (entry) entry.state = payload.error ? "error" : "complete";
    }
    if (
      ["approval.request", "clarify.request", "secret.request"].includes(type)
    ) {
      const next = interactionFromEvent(type, payload);
      const index = turn.interactions.findIndex((old) => old.id === next.id);
      if (index < 0) turn.interactions.push(next);
      else {
        const previous = turn.interactions[index];
        if (next.questions) {
          next.questions = next.questions.map((question) => {
            const answer = question.answer ??
              previous.questions?.find((old) => old.id === question.id)?.answer;
            return answer === undefined ? question : { ...question, answer };
          });
        }
        turn.interactions[index] = next;
      }
    }
    if (type === "message.complete") {
      this.interimStreams.delete(key);
      turn.recovering = false;
      turn.text = visibleText(payload.text ?? turn.text);
      turn.state = payload.status === "error"
        ? "error"
        : payload.status === "interrupted"
        ? "interrupted"
        : "complete";
      turn.finishedAt = Date.now();
      turn.interactions = [];
      if (payload.error) turn.error = visibleText(payload.error);
      for (const a of turn.activity) {
        if (a.state === "running") a.state = "complete";
      }
      this.emit("complete", key, turn);
    }
    if (type === "error") {
      turn.error = visibleText(payload.message ?? "The request failed");
    }
    // Never send an unfinished think block or embedded reasoning to the projection.
    this.emit("turn", {
      ...turn,
      text: visibleText(turn.text),
      activity: [...turn.activity],
      interactions: [...turn.interactions],
    });
  }
  private async replay() {
    const sessions = [...this.reverse.keys()];
    for (const sid of sessions) this.replaying.add(sid);
    for (const sid of sessions) {
      const last_seen = this.seq.get(sid) ?? 0;
      let events: RpcFrame[] = [];
      try {
        const key = this.reverse.get(sid);
        if (!key) continue;
        const [profile, sourceId] = JSON.parse(key);
        // Rebinding is required: a surviving Hermes run still owns the old socket.
        const resumed = await this.call("session.resume", {
          session_id: sourceId,
          profile,
          omit_messages: true,
        });
        assertSession(resumed);
        if (resumed.session_id !== sid) {
          this.runtime.set(key, resumed.session_id);
          this.reverse.delete(sid);
          this.reverse.set(resumed.session_id, key);
          this.restoreTurn(key, resumed);
          if (resumed.running) this.startRecovery(resumed.session_id, key);
          this.emit("resync", key);
          continue;
        }
        const result = await this.call("session.events.since", {
          session_id: sid,
          last_seen,
        });
        if (result.truncated || result.epoch !== this.epoch) {
          this.restoreTurn(key, resumed);
          if (resumed.running) this.startRecovery(sid, key);
          this.emit("reconcile");
          this.emit("resync", this.reverse.get(sid));
        } else {
          events = (result.events ?? []).map((event) =>
            event.method ? event : { method: "event", params: event }
          );
        }
      } catch {
        this.emit("reconcile");
        this.emit("resync", this.reverse.get(sid));
        const key = this.reverse.get(sid);
        if (key) this.startRecovery(sid, key);
      } finally {
        events.push(...(this.held.get(sid) ?? []));
        this.held.delete(sid);
        this.replaying.delete(sid);
        events.sort((a, b) => (a.params?.seq ?? 0) - (b.params?.seq ?? 0));
        for (const event of events) this.receive(event);
      }
    }
  }
  private async restore(keys: string[]) {
    for (const key of keys) {
      try {
        await this.attach(key);
        this.emit("resync", key);
      } catch (error) {
        this.emit("fault", error);
      }
    }
  }
  private stopRecovery(sid: string) {
    const recovery = this.recovering.get(sid);
    if (recovery?.timer) clearTimeout(recovery.timer);
    this.recovering.delete(sid);
  }
  private startRecovery(sid: string, key: string) {
    if (this.recovering.has(sid)) return;
    const recovery: { timer?: ReturnType<typeof setTimeout> } = {};
    this.recovering.set(sid, recovery);
    const turn = this.turns.get(key);
    if (turn) {
      turn.recovering = true;
      this.emit("turn", { ...turn });
    }
    const poll = async () => {
      if (this.stopped || this.recovering.get(sid) !== recovery) return;
      try {
        if (this.online) {
          const [profile, sourceId] = JSON.parse(key);
          const result = await this.call("session.resume", {
            session_id: sourceId,
            profile,
            omit_messages: true,
          });
          if (this.recovering.get(sid) !== recovery) return;
          this.restoreTurn(key, result, true);
          if (!result.running) {
            this.stopRecovery(sid);
            const current = this.turns.get(key);
            if (current) {
              current.text = "";
              current.recovering = false;
              this.emit("turn", { ...current });
            }
            this.emit("resync", key);
            return;
          }
        }
      } catch (error) {
        this.emit("fault", error);
      }
      if (this.recovering.get(sid) === recovery) {
        recovery.timer = setTimeout(() => void poll(), 1000);
      }
    };
    recovery.timer = setTimeout(() => void poll(), 1000);
  }
  private restoreTurn(
    key: string,
    result: RpcResult,
    preserveActivity = false,
  ) {
    const previous = this.turns.get(key);
    if (
      result.running ||
      result.inflight ||
      result.pending_approval ||
      result.pending_clarify
    ) {
      this.persistedTurns.delete(key);
      const snapshot = result.inflight ?? {};
      const turn: Turn = {
        conversation: key,
        text: visibleText(snapshot.assistant ?? ""),
        activity: preserveActivity ? (previous?.activity ?? []) : [],
        interactions: preserveActivity ? (previous?.interactions ?? []) : [],
        // A fresh snapshot has recovered the visible progress. Polling may
        // continue because snapshots have no cursor for safely merging deltas.
        recovering: false,
        startedAt: Number(
          snapshot.started_at ?? result.turn_started_at ?? Date.now() / 1000,
        ) * 1000,
        state: snapshot.status === "error"
          ? "error"
          : result.running
          ? "running"
          : "interrupted",
        ...(snapshot.error ? { error: visibleText(snapshot.error) } : {}),
      };
      this.turns.set(key, turn);
      for (
        const [kind, payload] of [
          ["approval", result.pending_approval],
          ["clarify", result.pending_clarify],
        ] as const
      ) {
        if (payload) {
          this.receive({
            method: "event",
            params: {
              type: `${kind}.request`,
              session_id: result.session_id,
              payload,
            },
          });
        }
      }
      this.emit("turn", turn);
    } else if (
      previous?.state === "running" &&
      this.persistedTurns.delete(key)
    ) {
      // We missed the completion while offline. History knows the answer; the
      // old live projection cannot provide a trustworthy completion time.
      this.turns.delete(key);
      this.emit("idle", { conversation: key, startedAt: previous.startedAt });
      this.emit("resync", key);
    } else if (previous?.state === "running") {
      const turn: Turn = {
        ...previous,
        state: "interrupted",
        recovering: false,
        finishedAt: Date.now(),
        interactions: [],
      };
      this.turns.set(key, turn);
      this.emit("turn", turn);
    }
    if (!result.running) this.emit("settled", key);
  }
  async attach(key: string): Promise<string> {
    if (this.changingProfiles.has(JSON.parse(key)[0])) {
      throw new Error("Profile is being renamed. Try again shortly.");
    }
    const cached = this.runtime.get(key);
    if (cached) return cached;
    const pending = this.attaching.get(key);
    if (pending) return pending;
    const work = this.resume(key).finally(() => this.attaching.delete(key));
    this.attaching.set(key, work);
    return await work;
  }
  private async resume(key: string): Promise<string> {
    const [profile, id] = JSON.parse(key);
    const result = await this.call("session.resume", {
      session_id: id,
      profile,
      omit_messages: true,
    });
    assertSession(result);
    this.runtime.set(key, result.session_id);
    this.reverse.set(result.session_id, key);
    this.restoreTurn(key, result);
    if (result.running) this.startRecovery(result.session_id, key);
    return result.session_id as string;
  }
  async create(profile = "default") {
    const result = await this.call("session.create", {
      profile,
      source: "desktop",
    });
    const sourceId = String(result.stored_session_id ?? result.session_key);
    if (!sourceId || sourceId === "undefined") {
      throw new Error("Hermes did not return a stored conversation ID");
    }
    const key = conversationKey(profile, sourceId);
    assertSession(result);
    this.runtime.set(key, result.session_id);
    this.reverse.set(result.session_id, key);
    return {
      key,
      sourceId,
      profile,
      title: "New conversation",
      pendingPersistence: true,
      activityAt: Date.now(),
    };
  }
  async openBot(profile: string) {
    const lookup = async () => {
      const result = await this.call("session.list", {
        profile,
        title: "Bot Chat",
        include_hidden: true,
      });
      if (!Array.isArray(result.sessions)) {
        throw new Error("Hermes did not return the bot conversation lookup");
      }
      return result.sessions.find(
        (row) => row.title === "Bot Chat" && !row.archived,
      );
    };
    let row = await lookup();
    if (!row) {
      const created = await this.call("session.create", {
        profile,
        title: "Bot Chat",
        hidden: true,
        follow_profile_config: true,
      });
      try {
        await this.call("session.title", {
          session_id: created.session_id,
          title: "Bot Chat",
        });
      } catch (error) {
        const winner = await lookup();
        if (!winner) throw error;
        row = winner;
      }
      if (!row) row = await lookup();
      if (!row) {
        throw new Error(
          "The bot conversation could not be resolved after creation",
        );
      }
    }
    const sourceId = String(row.resolved_id ?? row.id ?? row.session_id);
    if (!sourceId || sourceId === "undefined") {
      throw new Error("Hermes did not return a stored bot conversation ID");
    }
    const roster = await this.call("profiles.list", {});
    const bot = roster.profiles?.find(
      (entry: { name: string }) => entry.name === profile,
    );
    return {
      key: conversationKey(profile, sourceId),
      profile,
      sourceId,
      bot: true,
      title: bot?.ui_meta?.["hermes-bots"]?.title || bot?.display_name ||
        profile,
      activityAt: epochMillis(
        row.last_active ?? row.started_at,
        Date.now() / 1000,
      ),
    };
  }
  forgetProfile(profile: string) {
    for (const [key, sid] of this.runtime) {
      if (JSON.parse(key)[0] !== profile) continue;
      this.stopRecovery(sid);
      this.runtime.delete(key);
      this.reverse.delete(sid);
      this.turns.delete(key);
      this.seq.delete(sid);
    }
  }
  async releaseProfile(profile: string) {
    this.changingProfiles.add(profile);
    await Promise.all(
      [...this.attaching]
        .filter(([key]) => JSON.parse(key)[0] === profile)
        .map(([, pending]) => pending.catch(() => undefined)),
    );
    const sessions = [...this.runtime].filter(
      ([key]) => JSON.parse(key)[0] === profile,
    );
    if (!sessions.length) return;
    const live = await this.call("session.active_list", {});
    const rows = (live.sessions ?? []) as { id: string; status: string }[];
    if (
      sessions.some(([, id]) =>
        rows.some((row) => row.id === id && row.status !== "idle")
      )
    ) {
      throw new Error("Stop active work before renaming this profile");
    }
    for (const [, session_id] of sessions) {
      await this.call("session.close", { session_id });
    }
    this.forgetProfile(profile);
  }
  finishProfileChange(profile: string) {
    this.changingProfiles.delete(profile);
  }
  async list() {
    const discovery = await this.rest(
      "/api/profiles/sessions?limit=1&archived=include",
    );
    if (discovery.errors?.length) {
      throw new Error("Some Hermes profiles could not be read");
    }
    const profiles = Object.keys(discovery.profile_totals ?? { default: 0 });
    const all = new Map<
      string,
      {
        key: string;
        profile: string;
        sourceId: string;
        source?: string;
        title: string;
        activityAt: number;
        bot?: boolean;
        pinned?: boolean;
        archived?: boolean;
      }
    >();
    for (const profile of profiles) {
      for (let offset = 0;; offset += 100) {
        const query = new URLSearchParams({
          profile,
          limit: "100",
          offset: String(offset),
          archived: "include",
          order: "recent",
        });
        const response = await this.rest(`/api/sessions?${query}`);
        const rows = response.sessions ?? [];
        for (const row of rows) {
          const sourceId = String(row.id ?? row.session_id);
          const key = conversationKey(profile, sourceId);
          all.set(key, {
            key,
            profile,
            sourceId,
            source: String(row.source ?? "")
              .trim()
              .toLowerCase(),
            title: row.title || "Untitled conversation",
            ...(row.pinned !== undefined
              ? { pinned: Boolean(row.pinned) }
              : {}),
            ...(row.archived !== undefined
              ? { archived: Boolean(row.archived) }
              : {}),
            activityAt: epochMillis(
              row.last_active ??
                row.last_activity ??
                row.updated_at ??
                row.started_at,
            ),
          });
        }
        if (
          rows.length < 100 ||
          (typeof response.total === "number" && offset + 100 >= response.total)
        ) {
          break;
        }
      }
    }
    const roster = await this.call("profiles.list", { include_sessions: true });
    for (const profile of roster.profiles ?? []) {
      const canonical = profile.canonical_session;
      const sourceId = canonical?.resolved_id ?? canonical?.id;
      if (typeof sourceId !== "string") continue;
      const key = conversationKey(profile.name, sourceId);
      all.set(key, {
        ...all.get(key),
        key,
        profile: profile.name,
        sourceId,
        bot: true,
        title: profile.ui_meta?.["hermes-bots"]?.title ||
          profile.display_name ||
          profile.name,
        activityAt: epochMillis(
          canonical?.last_active ?? canonical?.started_at,
        ),
      });
    }
    return [...all.values()];
  }
  async setOrganization(key: string, pinned: boolean, archived: boolean) {
    const [profile, sourceId] = JSON.parse(key) as [string, string];
    // Match desktop: the owner belongs in the PATCH body, not just the URL.
    const result = await this.rest(
      `/api/sessions/${encodeURIComponent(sourceId)}`,
      "PATCH",
      {
        profile,
        pinned,
        archived,
      },
    );
    if (result.ok !== true) {
      throw new Error("Hermes did not save conversation organization");
    }
  }
  async search(query: string) {
    const discovery = await this.rest(
      "/api/profiles/sessions?limit=1&archived=include",
    );
    const results: { key: string; title: string; profile: string }[] = [];
    for (
      const profile of Object.keys(
        discovery.profile_totals ?? { default: 0 },
      )
    ) {
      const params = new URLSearchParams({ q: query, profile, limit: "20" });
      const data = await this.rest(`/api/sessions/search?${params}`);
      for (const row of data.results ?? []) {
        const id = row.session_id ?? row.id;
        if (typeof id !== "string") continue;
        // Search snippets can start inside a private reasoning block. Only
        // return conversation metadata, never an unverified excerpt.
        results.push({
          key: conversationKey(profile, id),
          title: visibleText(row.title ?? "Conversation"),
          profile,
        });
      }
    }
    return results;
  }
  async submitPrompt(key: string, params: Record<string, unknown>) {
    const submit = (session_id: string) =>
      this.call("prompt.submit", { ...params, session_id }, 1800000);
    const sid = await this.attach(key);
    // Project the turn from dispatch: the agent build can take seconds before
    // the first message.start, and subscribers should show work immediately.
    let optimisticStartedAt = 0;
    if (this.turns.get(key)?.state !== "running") {
      optimisticStartedAt = Date.now();
      const turn: Turn = {
        conversation: key,
        text: "",
        activity: [],
        startedAt: optimisticStartedAt,
        state: "running",
        interactions: [],
      };
      this.turns.set(key, turn);
      this.emit("turn", { ...turn });
    }
    try {
      return await submit(sid);
    } catch (error) {
      // The submit failed before the agent produced anything; settle the
      // optimistic projection so clients never show a phantom running turn.
      const projected = this.turns.get(key);
      if (
        projected?.state === "running" &&
        projected.startedAt === optimisticStartedAt &&
        !projected.text &&
        !projected.activity.length
      ) {
        this.turns.delete(key);
        this.emit("idle", {
          conversation: key,
          startedAt: optimisticStartedAt,
        });
      }
      throw error;
    }
  }
  async history(key: string, offset = 0) {
    const [profile, id] = JSON.parse(key);
    const q = new URLSearchParams({
      profile,
      limit: "100",
      offset: String(offset),
      order: "latest",
      // Match desktop display history, including turns archived by compaction.
      include_compacted: "true",
    });
    let data: {
      messages?: Record<string, unknown>[];
      session_id?: string;
      pagination?: { limit?: number; has_more?: boolean };
    };
    try {
      data = await this.rest(
        `/api/sessions/${encodeURIComponent(id)}/messages?${q}`,
      );
    } catch (error) {
      if (
        !(error instanceof HermesHttpError) ||
        error.status !== 404 ||
        offset !== 0
      ) {
        throw error;
      }
      // Fresh sessions exist in the gateway before their first database row.
      // Verify that exact live session; never hide a missing saved transcript.
      const live = await this.call("session.resume", {
        session_id: id,
        profile,
      });
      if (
        live.stored_session_id !== id ||
        record(live.info).lazy !== true ||
        !Array.isArray(live.messages)
      ) {
        throw error;
      }
      assertSession(live);
      this.runtime.set(key, live.session_id);
      this.reverse.set(live.session_id, key);
      this.restoreTurn(key, live);
      data = { messages: live.messages, session_id: id };
    }
    return {
      conversation: key,
      offset,
      messages: normalizeMessages(data.messages ?? []),
      artifacts: fileReferences(data.messages ?? []),
      revision: createHash("sha256")
        .update(
          JSON.stringify({
            ids: (data.messages ?? []).map(
              (row: { id?: string; row_id?: string }) => row.id ?? row.row_id,
            ),
            messages: normalizeMessages(data.messages ?? []),
          }),
        )
        .digest("hex"),
      hasMore: data.pagination?.has_more ??
        (Number(data.pagination?.limit) > 0 &&
          (data.messages?.length ?? 0) >= Number(data.pagination?.limit)),
    };
  }
  async historyIndex(key: string): Promise<HistoryIndexItem[]> {
    const [profile, id] = JSON.parse(key) as [string, string];
    const pages: {
      id: string;
      role: "user" | "assistant";
      text: string;
      offset: number;
    }[][] = [];
    for (let offset = 0;; offset += 500) {
      const query = new URLSearchParams({
        profile,
        limit: "500",
        offset: String(offset),
        order: "latest",
        include_compacted: "true",
      });
      const response = await this.rest(
        `/api/sessions/${encodeURIComponent(id)}/messages?${query}`,
      );
      const rows = (response.messages ?? []) as Record<string, unknown>[];
      const positions = new Map(
        rows.map((row, index) => [
          String(row.id ?? row.row_id ?? row.message_id ?? `row-${index}`),
          index,
        ]),
      );
      pages.push(
        normalizeMessages(rows)
          .filter(
            (message) =>
              message.role === "user" || message.role === "assistant",
          )
          .map((message) => ({
            id: message.id,
            role: message.role as "user" | "assistant",
            text: message.text.replace(/\s+/g, " ").trim().slice(0, 300),
            offset: offset + rows.length - 1 - (positions.get(message.id) ?? 0),
          })),
      );
      if (rows.length < 500) break;
    }
    const index: HistoryIndexItem[] = [];
    for (const page of pages.reverse()) {
      for (const message of page) {
        if (message.role === "user") {
          index.push({
            id: message.id,
            prompt: message.text,
            answer: "",
            offset: message.offset,
          });
        } else if (index.length) {
          index[index.length - 1].answer = message.text;
        }
      }
    }
    return index;
  }
  async branch(key: string, messageId: string) {
    const [profile, id] = JSON.parse(key);
    let count = 0,
      found = false,
      finished = false;
    for (let offset = 0; !finished; offset += 500) {
      const query = new URLSearchParams({
        profile,
        limit: "500",
        offset: String(offset),
        order: "oldest",
      });
      const data = await this.rest(
        `/api/sessions/${encodeURIComponent(id)}/messages?${query}`,
      );
      const rows = data.messages ?? [];
      for (const row of rows) {
        // A user-prompt branch includes its complete response, ending before
        // the next user prompt, even when the turn crosses a history page.
        if (found && row.role === "user") {
          finished = true;
          break;
        }
        if (
          ["user", "assistant"].includes(row.role) &&
          plainText(row.content ?? row.text).trim()
        ) {
          count++;
        }
        if (String(row.id ?? row.row_id ?? row.message_id) === messageId) {
          found = true;
          if (row.role !== "user") {
            finished = true;
            break;
          }
        }
      }
      if (rows.length < 500) break;
    }
    if (!found || count === 0) {
      throw new Error(
        "The selected message is no longer available; refresh the conversation",
      );
    }
    const result = await this.call("session.branch", {
      session_id: await this.attach(key),
      count,
    });
    const sourceId = String(result.stored_session_id),
      branchKey = conversationKey(profile, sourceId);
    assertSession(result);
    this.runtime.set(branchKey, result.session_id);
    this.reverse.set(result.session_id, branchKey);
    return {
      key: branchKey,
      sourceId,
      profile,
      title: result.title ?? "Branched conversation",
      activityAt: Date.now(),
    };
  }
  answered(
    key: string,
    id: string,
    questionId?: string,
    answer?: string,
    remaining?: string[],
  ) {
    const turn = this.turns.get(key);
    if (turn) {
      if (questionId && remaining?.length) {
        const interaction = turn.interactions.find((x) => x.id === id);
        const question = interaction?.questions?.find(
          (q) => q.id === questionId,
        );
        if (question) question.answer = visibleText(answer ?? "");
      } else turn.interactions = turn.interactions.filter((x) => x.id !== id);
      this.emit("turn", turn);
    }
  }
}
