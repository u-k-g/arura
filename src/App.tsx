import {
  createEffect,
  createSignal,
  For,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";
import {
  authorized,
  command,
  connected,
  inform,
  login,
  moreConversations,
  mutate,
  notice,
  request,
  start,
  subscribe,
  workspace,
} from "./client.ts";
import { Dialog, Empty, Field, Icon, IconButton, run } from "./ui.tsx";
import {
  draft,
  draftAttachments,
  loadCache,
  preferences,
  saveCache,
} from "./cache.ts";
import type { Conversation } from "../shared/model.ts";
import { shortcutFromEvent, shortcuts } from "../shared/shortcuts.ts";
const Chat = lazy(() => import("./Chat.tsx"));
const Settings = lazy(() => import("./Settings.tsx"));
const Resources = lazy(() => import("./Resources.tsx"));
const Artifacts = lazy(() => import("./Artifacts.tsx"));

export default function App() {
  const [view, setView] = createSignal(preferences.getItem("arura.view") ?? "");
  const [sheet, setSheet] = createSignal(false),
    [search, setSearch] = createSignal(""),
    [palette, setPalette] = createSignal(false);
  const [matches, setMatches] = createSignal<
    { key: string; title: string; profile: string }[]
  >([]);
  const [searching, setSearching] = createSignal(false);
  const [searchError, setSearchError] = createSignal("");
  createEffect(() => {
    const query = search().trim();
    const online = connected();
    if (!palette() || !query) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let disposed = false;
    setMatches([]);
    setSearching(online);
    setSearchError("");
    const timer = setTimeout(async () => {
      const cacheKey = `search:${query}`;
      const cached = await loadCache<
        { key: string; title: string; profile: string }[]
      >(
        cacheKey,
      );
      if (disposed) return;
      if (cached) setMatches(cached);
      if (!online) return;
      try {
        const value = await request(
          `/api/search?q=${encodeURIComponent(query)}`,
        );
        if (!disposed) {
          setMatches(value.results);
          void saveCache(cacheKey, value.results);
        }
      } catch (error) {
        if (!disposed) setSearchError((error as Error).message);
      } finally {
        if (!disposed) setSearching(false);
      }
    }, 250);
    onCleanup(() => {
      disposed = true;
      clearTimeout(timer);
    });
  });
  const [closedFolders, setClosedFolders] = createSignal<
    Record<string, boolean>
  >(
    (() => {
      try {
        const saved: unknown = JSON.parse(
          preferences.getItem("arura.closedFolders") ?? "{}",
        );
        if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
          return {};
        }
        return Object.fromEntries(
          Object.entries(saved).filter(
            ([, value]) => typeof value === "boolean",
          ),
        );
      } catch {
        return {};
      }
    })(),
  );
  const [archived, setArchived] = createSignal<any[]>([]),
    [archiveOpen, setArchiveOpen] = createSignal(false),
    [archiveLimit, setArchiveLimit] = createSignal(10);
  const [archiveHasMore, setArchiveHasMore] = createSignal(false);
  const [menu, setMenu] = createSignal<any>(),
    [folderName, setFolderName] = createSignal<string | null>(null);
  const [activeConversation, setActiveConversation] = createSignal<
    Conversation | null
  >(null);
  createEffect(() => {
    const key = view();
    connected();
    setActiveConversation(null);
    if (!authorized() || !key.startsWith("[")) return;
    const stop = subscribe("workspace", "byKey", { key }, (conversation) => {
      if (conversation && conversation.key !== key) {
        void (async () => {
          const oldDraft = await draft(key);
          const newDraft = await draft(conversation.key);
          if (oldDraft && oldDraft !== newDraft) {
            await draft(
              conversation.key,
              [newDraft, oldDraft].filter(Boolean).join("\n\n"),
            );
            await draft(key, "");
          }
          const attachments = await draftAttachments(key);
          if (attachments.length) {
            const existing = await draftAttachments(conversation.key);
            await draftAttachments(conversation.key, [
              ...existing,
              ...attachments.filter(
                (file) => !existing.some((old) => old.path === file.path),
              ),
            ]);
            await draftAttachments(key, []);
          }
          if (view() === key) navigate(conversation.key);
        })().catch((error) => inform(String(error)));
      } else setActiveConversation(conversation);
    });
    onCleanup(stop);
  });
  const [name, setName] = createSignal(""),
    [code, setCode] = createSignal(""),
    [busy, setBusy] = createSignal(false);
  onMount(() => {
    document.documentElement.dataset.theme =
      preferences.getItem("arura.theme") ?? "system";
    const size = Number(preferences.getItem("arura.textSize") ?? 16);
    document.documentElement.style.setProperty(
      "--message-size",
      `${Math.min(20, Math.max(14, size))}px`,
    );
    void start();
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const pressed = shortcutFromEvent(event);
      if (!pressed) return;
      const action = shortcuts.find(
        (shortcut) =>
          (workspace()?.settings?.shortcuts?.[shortcut.id] ??
            shortcut.default) === pressed,
      )?.id;
      if (action === "palette") {
        event.preventDefault();
        setPalette((x) => !x);
      }
      if (action === "newChat" && authorized()) {
        event.preventDefault();
        void newChat();
      }
    };
    globalThis.addEventListener("keydown", keyboard);
    onCleanup(() => globalThis.removeEventListener("keydown", keyboard));
  });
  createEffect(() => {
    if (authorized()) {
      const count = archiveLimit() / 10;
      const pages = new Map<
        number,
        { page: any[]; isDone: boolean; continueCursor: string }
      >();
      const stops = new Map<number, () => void>();
      let disposed = false,
        fresh = false;
      const cacheKey = `archive:${count}`;
      void loadCache<{ items: any[]; hasMore: boolean }>(cacheKey).then(
        (cached) => {
          if (cached && !disposed && !fresh) {
            setArchived(cached.items);
            setArchiveHasMore(cached.hasMore);
          }
        },
      );
      function follow(index: number, cursor: string | null) {
        let nextCursor: string | undefined;
        stops.set(
          index,
          subscribe("workspace", "archived", { cursor }, (result) => {
            if (disposed) return;
            fresh = true;
            pages.set(index, result);
            if (result.isDone || result.continueCursor !== nextCursor) {
              for (const [page, stop] of stops) {
                if (page > index) {
                  stop();
                  stops.delete(page);
                  pages.delete(page);
                }
              }
              nextCursor = result.continueCursor;
              if (!result.isDone && index + 1 < count) {
                follow(index + 1, result.continueCursor);
              }
            }
            const ordered = [...pages.entries()]
              .sort(([a], [b]) => a - b)
              .map(([, value]) => value);
            setArchived([
              ...new Map(
                ordered
                  .flatMap((page) => page.page)
                  .map((row) => [row._id, row]),
              ).values(),
            ]);
            setArchiveHasMore(!ordered.at(-1)?.isDone);
            void saveCache(cacheKey, {
              items: archived(),
              hasMore: archiveHasMore(),
            });
          }),
        );
      }
      follow(0, null);
      onCleanup(() => {
        disposed = true;
        for (const stop of stops.values()) stop();
      });
    }
  });
  const navigate = (next: string) => {
    setView(next);
    preferences.setItem("arura.view", next);
    if (next.startsWith("[")) {
      preferences.setItem("arura.lastConversation", next);
    }
    setSheet(false);
    setPalette(false);
    setSearch("");
  };
  const chats = () =>
    ((workspace()?.conversations ?? []) as Conversation[]).filter(
      (c) =>
        !search() || c.title.toLowerCase().includes(search().toLowerCase()),
    );
  const selected = () =>
    chats().find((c) => c.key === view()) ??
      archived().find((c) => c.key === view()) ??
      activeConversation();
  async function newChat(profile = "default") {
    await run(async () => {
      const result = await command("create", "", { profile });
      navigate(result.key);
    });
  }
  const row = (c: Conversation) => (
    <div class="thread-row" classList={{ selected: view() === c.key }}>
      <button
        type="button"
        class="thread-select"
        onClick={() =>
          navigate(c.key)}
      >
        <Icon name={c.running ? "clock" : "chat-bubble"} />
        <span>{c.title}</span>
        <Show when={c.running}>
          <i class="busy-dot" />
        </Show>
      </button>
      <IconButton
        icon="more-horiz"
        label={`Actions for ${c.title}`}
        onClick={() =>
          setMenu(c)}
      />
    </div>
  );
  const navigation = () => (
    <div class="navigation">
      <header class="brand">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("");
          }}
        >
          <span class="brand-mark">a</span> arura
        </a>
        <IconButton
          icon="plus"
          label="New conversation"
          onClick={() => void newChat()}
        />
      </header>
      <button type="button" class="nav-search" onClick={() => setPalette(true)}>
        <Icon name="search" />
        <span>Find anything</span>
        <kbd>
          {String(workspace()?.settings?.shortcuts?.palette ?? "Mod+k").replace(
            "Mod",
            "Ctrl/⌘",
          )}
        </kbd>
      </button>
      <div class="nav-scroll">
        <div class="essentials">
          <For
            each={chats()
              .filter((c) => c.section === "essential")
              .sort((a, b) => a.rank - b.rank)}
          >
            {(c) => (
              <button
                type="button"
                classList={{ selected: view() === c.key }}
                title={c.title}
                onClick={() => navigate(c.key)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu(c);
                }}
              >
                <Icon name="chat-bubble" />
                <span>{c.title}</span>
              </button>
            )}
          </For>
          <Show when={!chats().some((c) => c.section === "essential")}>
            <p class="quiet">Keep your everyday chats here.</p>
          </Show>
        </div>
        <div class="section-heading">
          <span>Pinned</span>
          <IconButton
            icon="plus"
            label="New folder"
            onClick={() => setFolderName("")}
          />
        </div>
        <For
          each={chats()
            .filter((c) => c.section === "pinned" && !c.folderId)
            .sort((a, b) => a.rank - b.rank)}
        >
          {row}
        </For>
        <For each={workspace()?.folders ?? []}>
          {(folder: any) => (
            <details
              class="folder"
              open={!closedFolders()[folder._id]}
              onToggle={(event) => {
                const closed = !event.currentTarget.open;
                if (Boolean(closedFolders()[folder._id]) === closed) return;
                const next = { ...closedFolders(), [folder._id]: closed };
                setClosedFolders(next);
                preferences.setItem(
                  "arura.closedFolders",
                  JSON.stringify(next),
                );
              }}
            >
              <summary>
                <Icon name="folder" />
                {folder.name}
                <IconButton
                  icon="edit-pencil"
                  label={`Rename folder ${folder.name}`}
                  onClick={() => {
                    const name = prompt("Folder name", folder.name);
                    if (name?.trim()) {
                      void run(() =>
                        mutate("workspace.folder", { id: folder._id, name })
                      );
                    }
                  }}
                />
                <IconButton
                  icon="nav-arrow-down"
                  label={`Move folder ${folder.name} down`}
                  onClick={() =>
                    void run(() =>
                      mutate("workspace.reorder", {
                        kind: "folder",
                        id: folder._id,
                        direction: 1,
                      })
                    )}
                />
                <IconButton
                  icon="nav-arrow-down"
                  class="rotate-icon"
                  label={`Move folder ${folder.name} up`}
                  onClick={() =>
                    void run(() =>
                      mutate("workspace.reorder", {
                        kind: "folder",
                        id: folder._id,
                        direction: -1,
                      })
                    )}
                />
                <button
                  type="button"
                  class="folder-delete"
                  aria-label={`Delete folder ${folder.name}`}
                  onClick={(e) => {
                    e.preventDefault();
                    if (
                      confirm(
                        "Remove this folder? Its conversations stay pinned.",
                      )
                    ) {
                      void run(() =>
                        mutate("workspace.folder", {
                          id: folder._id,
                          remove: true,
                        })
                      );
                    }
                  }}
                >
                  ×
                </button>
              </summary>
              <For
                each={chats()
                  .filter((c) => c.folderId === folder._id)
                  .sort((a, b) => a.rank - b.rank)}
              >
                {row}
              </For>
            </details>
          )}
        </For>
        <div class="section-heading">
          <span>Conversations</span>
        </div>
        <For
          each={chats()
            .filter((c) => c.section === "recent")
            .sort((a, b) => b.activityAt - a.activityAt)}
        >
          {row}
        </For>
        <Show when={workspace()?.recentHasMore}>
          <button
            type="button"
            class="text-button"
            disabled={!connected()}
            onClick={moreConversations}
          >
            Show 100 more conversations
          </button>
        </Show>
        <div class="archive">
          <button
            type="button"
            class="section-heading"
            aria-expanded={archiveOpen()}
            onClick={() => setArchiveOpen((x) => !x)}
          >
            <Icon name="archive" />
            <span>Archived</span>
            <Icon name="nav-arrow-down" />
          </button>
          <Show when={archiveOpen()}>
            <For each={archived()}>
              {(c) => (
                <div class="thread-row">
                  <button
                    type="button"
                    class="thread-select"
                    onClick={() => navigate(c.key)}
                  >
                    <span>{c.title}</span>
                  </button>
                  <IconButton
                    icon="refresh"
                    label={`Unarchive ${c.title}`}
                    onClick={() =>
                      void run(() =>
                        mutate("workspace.move", {
                          key: c.key,
                          section: "recent",
                        })
                      )}
                  />
                </div>
              )}
            </For>
            <Show when={archiveHasMore()}>
              <button
                type="button"
                class="text-button"
                onClick={() => setArchiveLimit((x) => x + 10)}
              >
                Show 10 more
              </button>
            </Show>
          </Show>
        </div>
      </div>
      <footer class="nav-footer">
        <button type="button" onClick={() => navigate("resources:profiles")}>
          <Icon name="chat-bubble" />
          Bots
        </button>
        <button type="button" onClick={() => navigate("resources:files")}>
          <Icon name="folder" />
          Files
        </button>
        <button type="button" onClick={() => navigate("settings")}>
          <Icon name="settings" />
          Settings
        </button>
      </footer>
    </div>
  );
  return (
    <Show
      when={authorized()}
      fallback={
        <main class="authorization">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void run(() => login(name(), code())).finally(() =>
                setBusy(false)
              );
            }}
          >
            <span class="brand-mark">a</span>
            <h1>Your space for Hermes.</h1>
            <p>Authorize this browser to access your conversations.</p>
            <Field label="Device name">
              <input
                autocomplete="nickname"
                placeholder="My phone"
                required
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
              />
            </Field>
            <Field
              label="Authorization code"
              hint="Use a code from an authorized device, or your host's access key."
            >
              <input
                type="password"
                autocomplete="one-time-code"
                required
                value={code()}
                onInput={(e) => setCode(e.currentTarget.value)}
              />
            </Field>
            <button type="submit" class="primary" disabled={busy()}>
              {busy() ? "Authorizing…" : "Authorize this device"}
            </button>
            <p role="status">{notice()}</p>
          </form>
        </main>
      }
    >
      <div class="app-shell">
        <aside class="desktop-navigation">{navigation()}</aside>
        <main class="main-view">
          <header class="topbar">
            <IconButton
              icon="menu"
              class="mobile-only"
              label="Open conversations"
              onClick={() => setSheet(true)}
            />
            <span class="view-title">
              {selected()?.title ??
                (view() === "settings"
                  ? "Settings"
                  : view().startsWith("resources:")
                  ? view()
                    .slice(10)
                    .replace(/^./, (x) => x.toUpperCase())
                  : "Your conversations")}
            </span>
            <Show when={selected()}>
              {(c) => (
                <IconButton
                  icon="more-horiz"
                  label="Conversation actions"
                  onClick={() => setMenu(c())}
                />
              )}
            </Show>
            <span
              class="connection"
              classList={{
                offline: !connected() || !workspace()?.connection?.online,
              }}
            >
              <i />
              {!connected()
                ? "Offline"
                : workspace()?.connection?.online
                ? "Connected"
                : "Connecting to Hermes"}
            </span>
            <IconButton
              icon="bell"
              label="Notifications"
              onClick={() => navigate("settings:notifications")}
            />
            <Show when={workspace()?.notices?.some((n: any) => !n.read)}>
              <span
                class="notification-count"
                role="status"
                aria-label="Unread notifications"
              >
                {workspace()?.notices?.filter((n: any) => !n.read).length}
              </span>
            </Show>
          </header>
          <Suspense fallback={<div class="loading">Opening…</div>}>
            <Show
              when={view().startsWith("settings")}
              fallback={
                <Show
                  when={view().startsWith("resources:")}
                  fallback={
                    <Show
                      when={view()}
                      fallback={
                        <Empty
                          title="What are we working on?"
                          icon="chat-bubble"
                        >
                          <p>
                            Start a conversation with Hermes, or return to one
                            you’ve saved.
                          </p>
                          <button
                            type="button"
                            class="primary"
                            onClick={() => void newChat()}
                          >
                            New conversation
                          </button>
                        </Empty>
                      }
                    >
                      <Chat
                        conversation={view()}
                        title={selected()?.title ?? "Conversation"}
                        navigate={navigate}
                      />
                    </Show>
                  }
                >
                  <Show
                    when={view() === "resources:artifacts"}
                    fallback={
                      <Resources
                        name={view().slice(10)}
                        navigate={navigate}
                        newChat={async (profile) => {
                          const result = await command("openBot", "", {
                            profile,
                          });
                          navigate(result.key);
                        }}
                      />
                    }
                  >
                    <Artifacts navigate={navigate} />
                  </Show>
                </Show>
              }
            >
              <Settings section={view().split(":")[1]} navigate={navigate} />
            </Show>
          </Suspense>
        </main>
      </div>
      <Show when={sheet()}>
        <Dialog
          title="Conversations"
          class="navigation-sheet"
          close={() => setSheet(false)}
        >
          {navigation()}
        </Dialog>
      </Show>
      <Show when={palette()}>
        <Dialog
          title="Find anything"
          close={() => {
            setPalette(false);
            setSearch("");
          }}
        >
          <input
            autofocus
            placeholder="Search conversations and actions"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <div class="palette-results">
            <button type="button" onClick={() => void newChat()}>
              <Icon name="plus" />
              New conversation
            </button>
            <For
              each={[
                "settings",
                "resources:files",
                "resources:profiles",
                "resources:jobs",
                "resources:skills",
                "resources:usage",
              ]}
            >
              {(target) => (
                <button
                  type="button"
                  onClick={() => navigate(target)}
                >
                  {target.replace("resources:", "")}
                </button>
              )}
            </For>
            <Show when={searching()}>
              <p role="status">Searching message history…</p>
            </Show>
            <Show when={searchError()}>
              <p role="alert">{searchError()}</p>
            </Show>
            <For
              each={[
                ...new Map(
                  [...chats(), ...matches()].map((chat) => [chat.key, chat]),
                ).values(),
              ]}
            >
              {(c) => (
                <button type="button" onClick={() => navigate(c.key)}>
                  <Icon name="chat-bubble" />
                  {c.title}
                </button>
              )}
            </For>
          </div>
        </Dialog>
      </Show>
      <Show when={folderName() !== null}>
        <Dialog title="New folder" close={() => setFolderName(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await mutate("workspace.folder", { name: folderName() });
                setFolderName(null);
              });
            }}
          >
            <Field label="Folder name">
              <input
                autofocus
                required
                value={folderName() ?? ""}
                onInput={(e) => setFolderName(e.currentTarget.value)}
              />
            </Field>
            <button type="submit" class="primary">
              Create folder
            </button>
          </form>
        </Dialog>
      </Show>
      <Show when={menu()}>
        {(c) => (
          <Dialog title={c().title} close={() => setMenu(undefined)}>
            <div class="action-list">
              <Show when={["essential", "pinned"].includes(c().section)}>
                <For each={[-1, 1]}>
                  {(direction) => (
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          await mutate("workspace.reorder", {
                            kind: "conversation",
                            id: c().key,
                            direction,
                          });
                          setMenu(undefined);
                        })}
                    >
                      Move {direction === -1 ? "up" : "down"}
                    </button>
                  )}
                </For>
              </Show>
              <For
                each={[
                  ["essential", "Keep in Essentials"],
                  ["pinned", "Pin conversation"],
                  ["recent", "Move to conversations"],
                  ["archived", "Archive"],
                ]}
              >
                {([section, label]) => (
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await mutate("workspace.move", {
                          key: c().key,
                          section,
                        });
                        setMenu(undefined);
                      })}
                  >
                    {label}
                  </button>
                )}
              </For>
              <For each={workspace()?.folders ?? []}>
                {(f: any) => (
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await mutate("workspace.move", {
                          key: c().key,
                          section: "pinned",
                          folderId: f._id,
                        });
                        setMenu(undefined);
                      })}
                  >
                    Move to {f.name}
                  </button>
                )}
              </For>
              <Show when={!c().bot}>
                <button
                  type="button"
                  onClick={() => {
                    const title = prompt("Conversation name", c().title);
                    if (title) {
                      void run(() => command("rename", c().key, { title }));
                    }
                    setMenu(undefined);
                  }}
                >
                  Rename
                </button>
              </Show>
              <a
                href={`/api/download?type=conversation&id=${
                  encodeURIComponent(
                    c().sourceId,
                  )
                }&profile=${encodeURIComponent(c().profile)}`}
                download=""
              >
                Export conversation
              </a>
              <button
                type="button"
                class="danger"
                onClick={() => {
                  if (confirm("Permanently delete this conversation?")) {
                    void run(() => command("delete", c().key, {}));
                  }
                  setMenu(undefined);
                }}
              >
                Delete conversation
              </button>
            </div>
          </Dialog>
        )}
      </Show>
      <Show when={notice()}>
        <div class="toast" role="status">
          {notice()}
        </div>
      </Show>
    </Show>
  );
}
