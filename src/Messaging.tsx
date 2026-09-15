import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { confirmAction } from "./ActionDialog.tsx";
import { inform, resource, revision } from "./client.ts";
import { Field, IconButton } from "./ui.tsx";
import "./Messaging.css";

type Credential = {
  key: string;
  prompt?: string;
  description?: string;
  required?: boolean;
  advanced?: boolean;
  is_password?: boolean;
  is_set?: boolean;
  redacted_value?: string;
  url?: string;
};
type Platform = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  configured?: boolean;
  gateway_running?: boolean;
  state?: string;
  error_message?: string;
  docs_url?: string;
  env_vars?: Credential[];
};
type Person = {
  platform: string;
  user_id: string;
  user_name?: string;
  request_id?: string;
};
const brands: Record<string, string> = {
  telegram: "#26A5E4",
  discord: "#5865F2",
  mattermost: "#0058CC",
  matrix: "#888888",
  signal: "#3A76F0",
  whatsapp: "#25D366",
  bluebubbles: "#0BD318",
  homeassistant: "#18BCF2",
  email: "#EA4335",
  weixin: "#07C160",
  qqbot: "#EB1923",
  yuanbao: "#FB7299",
};
function PlatformMark(props: { platform: Platform }) {
  return (
    <span
      class="platform-mark"
      aria-hidden="true"
      style={{
        "--platform-brand":
          brands[props.platform.id] ??
          (props.platform.id === "slack" ? "#4A154B" : "var(--muted)"),
      }}
    >
      <Show
        when={brands[props.platform.id]}
        fallback={<span>{props.platform.name.slice(0, 1)}</span>}
      >
        <img
          src={`/platforms/${props.platform.id}.svg`}
          alt=""
          width="14"
          height="14"
        />
      </Show>
    </span>
  );
}
function tone(p: Platform) {
  return !p.enabled
    ? "muted"
    : p.state === "connected"
      ? "good"
      : ["fatal", "startup_failed"].includes(p.state ?? "")
        ? "bad"
        : "waiting";
}

export default function Messaging() {
  const [platforms, setPlatforms] = createSignal<Platform[]>([]);
  const [profiles, setProfiles] = createSignal<string[]>([]);
  const [profile, setProfile] = createSignal("default");
  const [selected, setSelected] = createSignal("");
  const [filter, setFilter] = createSignal("");
  const [pending, setPending] = createSignal<Person[]>([]);
  const [approved, setApproved] = createSignal<Person[]>([]);
  const [edits, setEdits] = createSignal<
    Record<string, Record<string, string>>
  >({});
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [listOpen, setListOpen] = createSignal(false);
  let generation = 0;
  onCleanup(() => generation++);
  const visible = createMemo(() =>
    platforms().filter((p) =>
      `${p.name} ${p.description ?? ""}`
        .toLowerCase()
        .includes(filter().toLowerCase()),
    ),
  );
  const current = createMemo(() =>
    platforms().find((p) => p.id === selected()),
  );
  const draft = (id: string) => edits()[id] ?? {};
  async function refresh() {
    const version = ++generation;
    const scope = profile();
    setLoading(true);
    try {
      const [data, people, roster] = await Promise.all([
        resource("platforms", { profile: scope }),
        resource("pairing", { profile: scope }),
        resource("profileRoster"),
      ]);
      if (version !== generation) return;
      const list = (data.platforms ?? []) as Platform[];
      setPlatforms(list);
      setPending(people.pending ?? []);
      setApproved(people.approved ?? []);
      setProfiles((roster.profiles ?? []).map((p: { name: string }) => p.name));
      if (!list.some((p) => p.id === selected()))
        setSelected(list[0]?.id ?? "");
      setError("");
    } catch (e) {
      if (version === generation)
        setError(e instanceof Error ? e.message : "Could not load messaging");
    } finally {
      if (version === generation) setLoading(false);
    }
  }
  createEffect(() => {
    profile();
    revision();
    void refresh();
  });
  async function update(
    operation: string,
    params: Record<string, string>,
    body: unknown,
  ) {
    if (busy()) return false;
    setBusy(true);
    const scope = profile();
    try {
      const result = await resource(
        operation,
        { ...params, profile: scope },
        { ...(body as Record<string, unknown>), profile: scope },
      );
      if (result.ok === false)
        throw new Error(
          result.error ??
            result.message ??
            "Hermes could not apply this change",
        );
      await refresh();
      inform(
        operation === "savePlatform" || result.restart_required
          ? "Saved. Restart the Hermes gateway to apply these changes."
          : "Saved",
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save messaging");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const fields = (p: Platform, group: string) =>
    (p.env_vars ?? []).filter((f) =>
      group === "required"
        ? f.required
        : group === "advanced"
          ? !f.required && f.advanced
          : !f.required && !f.advanced,
    );
  const credential = (p: Platform, field: Credential) => (
    <Field label={field.prompt || field.key} hint={field.description}>
      <span class="messaging-credential">
        <input
          type={field.is_password ? "password" : "text"}
          autocomplete="off"
          placeholder={field.is_set ? "Saved — leave blank to keep" : ""}
          value={draft(p.id)[field.key] ?? ""}
          disabled={busy()}
          onInput={(e) =>
            setEdits((all) => ({
              ...all,
              [p.id]: { ...all[p.id], [field.key]: e.currentTarget.value },
            }))
          }
        />
        <Show when={field.is_set}>
          <IconButton
            icon="trash"
            label={`Remove saved ${field.prompt || field.key}`}
            disabled={busy()}
            onClick={() =>
              void (async () => {
                if (
                  await confirmAction(
                    `Remove saved ${field.prompt || field.key}?`,
                  )
                )
                  if (
                    await update(
                      "savePlatform",
                      { id: p.id },
                      { clear_env: [field.key] },
                    )
                  )
                    setEdits((all) => ({
                      ...all,
                      [p.id]: { ...all[p.id], [field.key]: "" },
                    }));
              })()
            }
          />
        </Show>
        <Show when={field.url && /^https?:\/\//.test(field.url)}>
          <a href={field.url} target="_blank" rel="noreferrer">
            Get key
          </a>
        </Show>
      </span>
    </Field>
  );
  const select = (id: string) => {
    setSelected(id);
    setListOpen(false);
  };
  return (
    <section class="messaging-page" aria-label="Messaging">
      <header class="messaging-search">
        <input
          type="search"
          aria-label="Search messaging platforms"
          placeholder="Search messaging platforms…"
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
        />
        <IconButton
          icon="refresh"
          label="Refresh messaging"
          disabled={loading()}
          onClick={() => void refresh()}
        />
      </header>
      <Show when={profiles().length > 1}>
        <div class="messaging-profile">
          <Field label="Profile">
            <select
              value={profile()}
              disabled={busy()}
              onChange={(e) => {
                setEdits({});
                setPlatforms([]);
                setProfile(e.currentTarget.value);
              }}
            >
              <For each={profiles()}>
                {(p) => <option value={p}>{p}</option>}
              </For>
            </select>
          </Field>
        </div>
      </Show>
      <Show when={error()}>
        <div class="error" role="alert">
          {error()}{" "}
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </Show>
      <Show when={loading() && !platforms().length}>
        <p role="status">Loading messaging…</p>
      </Show>
      <button
        type="button"
        class="messaging-mobile-picker"
        onClick={() => setListOpen(true)}
      >
        Choose platform · {current()?.name ?? "Messaging"}
      </button>
      <Show when={listOpen()}>
        <button
          type="button"
          class="messaging-scrim"
          aria-label="Close platforms"
          onClick={() => setListOpen(false)}
        />
      </Show>
      <div class="messaging-layout">
        <nav
          class="messaging-platforms"
          classList={{ "is-open": listOpen() }}
          aria-label="Messaging platforms"
        >
          <For each={visible()}>
            {(p) => (
              <button
                type="button"
                class="platform-row"
                aria-label={p.name}
                aria-description={
                  p.state || (p.enabled ? "Enabled" : "Disabled")
                }
                classList={{ active: selected() === p.id }}
                aria-pressed={selected() === p.id}
                onClick={() => select(p.id)}
              >
                <PlatformMark platform={p} />
                <span>{p.name}</span>
                <Show
                  when={pending().filter((u) => u.platform === p.id).length}
                >
                  {(n) => (
                    <span
                      class="platform-pending"
                      aria-label={`${n()} pending requests`}
                    >
                      {n()}
                    </span>
                  )}
                </Show>
                <span
                  class={`platform-status ${tone(p)}`}
                  title={p.state || (p.enabled ? "Enabled" : "Disabled")}
                />
              </button>
            )}
          </For>
          <Show when={!visible().length && !loading()}>
            <p>No platforms found.</p>
          </Show>
        </nav>
        <Show when={current()}>
          {(p) => (
            <div class="messaging-detail">
              <div class="messaging-detail-scroll">
                <div class="messaging-detail-content">
                  <header class="platform-heading">
                    <PlatformMark platform={p()} />
                    <div>
                      <div class="platform-title">
                        <h1>{p().name}</h1>
                        <span class={`platform-state ${tone(p())}`}>
                          {(
                            p().state || (p().enabled ? "Enabled" : "Disabled")
                          ).replaceAll("_", " ")}
                        </span>
                        <Show when={p().configured === false}>
                          <span class="platform-state muted">Needs setup</span>
                        </Show>
                        <Show when={p().gateway_running === false}>
                          <span class="platform-state muted">
                            Gateway stopped
                          </span>
                        </Show>
                      </div>
                      <p>{p().description}</p>
                    </div>
                  </header>
                  <Show when={p().error_message}>
                    <p class="error" role="alert">
                      {p().error_message}
                    </p>
                  </Show>
                  <For
                    each={[
                      {
                        title: "Pending requests",
                        people: pending(),
                        pending: true,
                      },
                      {
                        title: "Approved users",
                        people: approved(),
                        pending: false,
                      },
                    ]}
                  >
                    {(group) => (
                      <Show
                        when={group.people.some((u) => u.platform === p().id)}
                      >
                        <section>
                          <h2>{group.title}</h2>
                          <For
                            each={group.people.filter(
                              (u) => u.platform === p().id,
                            )}
                          >
                            {(user) => (
                              <div class="messaging-person">
                                <span>
                                  {user.user_name || user.user_id}
                                  <small>
                                    {user.user_name ? user.user_id : ""}
                                  </small>
                                </span>
                                <button
                                  type="button"
                                  disabled={busy()}
                                  onClick={() =>
                                    void (async () => {
                                      if (
                                        !group.pending &&
                                        !(await confirmAction(
                                          `Revoke access for ${user.user_name || user.user_id}?`,
                                        ))
                                      )
                                        return;
                                      await update(
                                        group.pending
                                          ? "approvePairing"
                                          : "revokePairing",
                                        {},
                                        {
                                          platform: p().id,
                                          ...(group.pending
                                            ? { request_id: user.request_id }
                                            : { user_id: user.user_id }),
                                        },
                                      );
                                    })()
                                  }
                                >
                                  {group.pending ? "Approve" : "Revoke"}
                                </button>
                              </div>
                            )}
                          </For>
                        </section>
                      </Show>
                    )}
                  </For>
                  <Show
                    when={p().docs_url && /^https?:\/\//.test(p().docs_url!)}
                  >
                    <section>
                      <h2>Get credentials</h2>
                      <a href={p().docs_url} target="_blank" rel="noreferrer">
                        Open setup guide ↗
                      </a>
                    </section>
                  </Show>
                  <section>
                    <h2>Required</h2>
                    <For each={fields(p(), "required")}>
                      {(f) => credential(p(), f)}
                    </For>
                    <Show when={!fields(p(), "required").length}>
                      <p>No token needed.</p>
                    </Show>
                  </section>
                  <Show when={fields(p(), "recommended").length}>
                    <section>
                      <h2>Recommended</h2>
                      <For each={fields(p(), "recommended")}>
                        {(f) => credential(p(), f)}
                      </For>
                    </section>
                  </Show>
                  <Show when={fields(p(), "advanced").length}>
                    <details>
                      <summary>
                        Advanced · {fields(p(), "advanced").length}
                      </summary>
                      <For each={fields(p(), "advanced")}>
                        {(f) => credential(p(), f)}
                      </For>
                    </details>
                  </Show>
                </div>
              </div>
              <footer class="messaging-action-bar">
                <div>
                  <label class="messaging-toggle">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`${p().enabled ? "Disable" : "Enable"} ${p().name}`}
                      checked={p().enabled}
                      disabled={busy()}
                      onChange={(e) =>
                        void update(
                          "savePlatform",
                          { id: p().id },
                          { enabled: e.currentTarget.checked },
                        )
                      }
                    />
                    Enabled
                  </label>
                  <button
                    type="button"
                    class="primary"
                    disabled={
                      busy() ||
                      !Object.values(draft(p().id)).some((v) => v.trim())
                    }
                    onClick={() =>
                      void (async () => {
                        const id = p().id;
                        const env = Object.fromEntries(
                          Object.entries(draft(id)).filter(([, v]) => v.trim()),
                        );
                        if (await update("savePlatform", { id }, { env }))
                          setEdits((all) => ({ ...all, [id]: {} }));
                      })()
                    }
                  >
                    {busy() ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </footer>
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}
