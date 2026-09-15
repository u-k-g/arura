import type { ConversationPage, Doc } from "../shared/contracts.ts";
import { essentialIcons } from "../shared/essentialIcons.ts";
import {
  createEffect,
  createMemo,
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
import { Dialog, Field, Icon, IconButton, run } from "./ui.tsx";
import {
  draft,
  draftAttachments,
  loadCache,
  preferences,
  saveCache,
} from "./cache.ts";
import type { Conversation } from "../shared/model.ts";
import CommandPalette, { type PaletteItem } from "./CommandPalette.tsx";
const Chat = lazy(() => import("./Chat.tsx"));
const Settings = lazy(() => import("./Settings.tsx"));
const Resources = lazy(() => import("./Resources.tsx"));
const Capabilities = lazy(() => import("./Capabilities.tsx"));
const Artifacts = lazy(() => import("./Artifacts.tsx"));

export default function App() {
  const [collapsed, setCollapsed] = createSignal(
    preferences.getItem("arura.sidebarCollapsed") === "true",
  );
  const toggleSidebar = () =>
    setCollapsed((value) => {
      preferences.setItem("arura.sidebarCollapsed", String(!value));
      return !value;
    });
  const [menuAnchor, setMenuAnchor] = createSignal<{ x: number; y: number }>();
  const [iconPicker, setIconPicker] = createSignal<Conversation>();
  const [view, setView] = createSignal(preferences.getItem("arura.view") ?? "");
  const [sheet, setSheet] = createSignal(false),
    [search, setSearch] = createSignal(""),
    [sidebarFilter, setSidebarFilter] = createSignal(""),
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
  const [archived, setArchived] = createSignal<Doc<"conversations">[]>([]),
    [archiveOpen, setArchiveOpen] = createSignal(false),
    [archiveLimit, setArchiveLimit] = createSignal(10);
  const [archiveHasMore, setArchiveHasMore] = createSignal(false);
  const [menu, setMenu] = createSignal<Conversation>(),
    [folderName, setFolderName] = createSignal<string | null>(null);
  const [activeConversation, setActiveConversation] = createSignal<
    Conversation | null
  >(null);
  createEffect(() => {
    const key = view();
    connected();
    setActiveConversation(null);
    if (!authorized() || !key.startsWith("[")) return;
    const stop = subscribe<Conversation | null>(
      "workspace",
      "byKey",
      { key },
      (conversation) => {
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
      },
    );
    onCleanup(stop);
  });
  const [name, setName] = createSignal(""),
    [code, setCode] = createSignal(""),
    [busy, setBusy] = createSignal(false);
  onMount(() => {
    document.documentElement.dataset.theme =
      preferences.getItem("arura.theme") ?? "system";
    const size = Number(preferences.getItem("arura.textSize") ?? 13);
    document.documentElement.style.setProperty(
      "--message-size",
      `${Math.min(20, Math.max(12, size))}px`,
    );
    void start();
  });
  createEffect(() => {
    if (authorized()) {
      const count = archiveLimit() / 10;
      const pages = new Map<
        number,
        {
          page: Doc<"conversations">[];
          isDone: boolean;
          continueCursor: string;
        }
      >();
      const stops = new Map<number, () => void>();
      let disposed = false,
        fresh = false;
      const cacheKey = `archive:${count}`;
      void loadCache<{ items: Doc<"conversations">[]; hasMore: boolean }>(
        cacheKey,
      ).then((cached) => {
        if (cached && !disposed && !fresh) {
          setArchived(cached.items);
          setArchiveHasMore(cached.hasMore);
        }
      });
      const follow = function (index: number, cursor: string | null) {
        let nextCursor: string | undefined;
        stops.set(
          index,
          subscribe<ConversationPage>(
            "workspace",
            "archived",
            { cursor },
            (result) => {
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
            },
          ),
        );
      };
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
        !sidebarFilter().trim() ||
        c.title.toLowerCase().includes(sidebarFilter().trim().toLowerCase()),
    );
  const selected = () =>
    chats().find((c) => c.key === view()) ??
      archived().find((c) => c.key === view()) ??
      activeConversation();
  async function newChat(profile = "default") {
    await run(async () => {
      const result = await command("create", "", { profile });
      navigate(String(result.key));
    });
  }
  const openMenu = (conversation: Conversation, event: MouseEvent) => {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuAnchor({
      x: event.clientX || bounds.left,
      y: event.clientY || bounds.bottom,
    });
    setMenu(conversation);
  };
  const destinations = [
    { id: "settings", label: "Settings", icon: "settings" },
    { id: "resources:files", label: "Host files", icon: "folder" },
    { id: "resources:artifacts", label: "Generated files", icon: "page" },
    { id: "resources:profiles", label: "Profiles & bots", icon: "chat-bubble" },
    { id: "resources:jobs", label: "Schedules", icon: "clock" },
    { id: "resources:skills", label: "Installed skills", icon: "page" },
    { id: "resources:usage", label: "Usage", icon: "computer" },
  ];
  const paletteItems = (): PaletteItem[] => {
    const query = search().trim().toLowerCase();
    const items: PaletteItem[] = [
      {
        id: "new",
        label: "New conversation",
        icon: "plus",
        group: "Actions",
        run: () => void newChat(selected()?.profile ?? "default"),
      },
      {
        id: "sidebar",
        label: collapsed() ? "Expand sidebar" : "Collapse sidebar",
        icon: "menu",
        group: "Actions",
        run: () => {
          toggleSidebar();
          setPalette(false);
        },
      },
      ...destinations.map((item) => ({
        ...item,
        group: "Go to",
        run: () => navigate(item.id),
      })),
    ].filter((item) => !query || item.label.toLowerCase().includes(query));
    const results = [
      ...new Map(
        [
          ...chats().filter(
            (item) => !query || item.title.toLowerCase().includes(query),
          ),
          ...matches(),
        ].map((item) => [item.key, item]),
      ).values(),
    ];
    items.push(
      ...results.slice(0, 50).map((item) => ({
        id: item.key,
        label: item.title,
        icon: "chat-bubble",
        group: query ? "Conversations" : "Recent conversations",
        detail: item.profile,
        run: () => navigate(item.key),
      })),
    );
    return items;
  };
  const recentGroups = createMemo(() => {
    const groups = new Map<string, Conversation[]>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (
      const chat of chats()
        .filter((c) => c.section === "recent" && !c.backgroundSession)
        .sort((a, b) => b.activityAt - a.activityAt)
    ) {
      const age = (today.getTime() - chat.activityAt) / 86400000;
      const label = age < 0
        ? "Today"
        : age < 1
        ? "Yesterday"
        : age < 7
        ? "Last week"
        : age < 30
        ? "Last month"
        : "Older";
      const items = groups.get(label) ?? [];
      items.push(chat);
      groups.set(label, items);
    }
    return [...groups.entries()];
  });
  const row = (c: Conversation) => (
    <div class="thread-row" classList={{ selected: view() === c.key }}>
      <button
        type="button"
        class="thread-select"
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(c, event);
        }}
        aria-current={view() === c.key ? "page" : undefined}
        title={c.title}
        aria-label={c.title}
        onClick={() =>
          navigate(c.key)}
      >
        <span class="session-dot" classList={{ running: c.running }} />
        <span>{c.title}</span>
        <time class="session-age">
          {Math.max(0, Math.floor((Date.now() - c.activityAt) / 86400000)) ||
            ""}
          {Date.now() - c.activityAt >= 86400000 ? "d" : "now"}
        </time>
        <Show when={c.running}>
          <i class="busy-dot" />
        </Show>
      </button>
      <IconButton
        icon="more-horiz"
        label={`Actions for ${c.title}`}
        onClick={(event) =>
          openMenu(c, event)}
      />
    </div>
  );
  const navigation = () => (
    <div class="navigation">
      <header class="sidebar-titlebar">
        <IconButton
          icon="sidebar-collapse"
          class="desktop-only"
          label="Collapse sidebar"
          onClick={toggleSidebar}
        />
      </header>
      <nav class="sidebar-sections" aria-label="Main navigation">
        <button
          type="button"
          classList={{ active: !view().startsWith("resources:profiles") }}
          onClick={() => navigate("")}
        >
          Sessions
        </button>
        <button
          type="button"
          classList={{ active: view() === "resources:profiles" }}
          onClick={() => navigate("resources:profiles")}
        >
          Bots
        </button>
      </nav>
      <nav class="sidebar-actions" aria-label="Hermes tools">
        <button
          type="button"
          classList={{ selected: view() === "resources:platforms" }}
          onClick={() => navigate("resources:platforms")}
        >
          <Icon name="chat-bubble" />
          <span>Messaging</span>
        </button>
        <button
          type="button"
          classList={{ selected: view() === "resources:artifacts" }}
          onClick={() => navigate("resources:artifacts")}
        >
          <Icon name="page" />
          <span>Artifacts</span>
        </button>
        <button
          type="button"
          classList={{ selected: view() === "resources:jobs" }}
          onClick={() => navigate("resources:jobs")}
        >
          <Icon name="clock" />
          <span>Scheduled jobs</span>
        </button>
      </nav>
      <div class="nav-search">
        <IconButton
          icon="search"
          label="Find anything"
          onClick={() => setPalette(true)}
        />
        <input
          aria-label="Filter sessions"
          placeholder="Search sessions…"
          value={sidebarFilter()}
          onInput={(event) => setSidebarFilter(event.currentTarget.value)}
        />
        <Show when={sidebarFilter()}>
          <IconButton
            icon="xmark"
            label="Clear session filter"
            onClick={() => setSidebarFilter("")}
          />
        </Show>
      </div>
      <div class="nav-scroll">
        <Show when={chats().some((c) => c.section === "essential")}>
          <div class="section-heading">
            <span>Essentials</span>
          </div>
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
                  aria-label={c.title}
                  onClick={() => navigate(c.key)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(c, e);
                  }}
                >
                  <Icon
                    name={c.essentialIcon ?? (c.bot ? "bot" : "chat-bubble")}
                  />
                </button>
              )}
            </For>
          </div>
        </Show>
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
          {(folder) => (
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
          <span>Sessions</span>
        </div>
        <For each={recentGroups()}>
          {([label, items], index) => (
            <>
              <Show when={index() > 0}>
                <div class="session-date-group">{label}</div>
              </Show>
              <For each={items}>{row}</For>
            </>
          )}
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
        <div class="profile-actions">
          <button
            type="button"
            class="profile-name"
            aria-label="Profiles and bots"
            onClick={() => navigate("resources:profiles")}
          >
            {selected()?.profile ?? "default"}
          </button>
          <IconButton
            icon="folder"
            label="Files"
            onClick={() => navigate("resources:files")}
          />
          <IconButton
            icon="more-horiz"
            label="All settings"
            onClick={() => navigate("settings")}
          />
        </div>
        <button
          type="button"
          class="gateway-status"
          onClick={() => navigate("resources:status")}
        >
          <span
            class="connection"
            classList={{
              offline: !connected() || !workspace()?.connection?.online,
            }}
          >
            <i />
            Gateway {workspace()?.connection?.online && connected()
              ? "connected"
              : "disconnected"}
          </span>
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
            <img
              class="brand-mark"
              src="/hermes/app-icon.png"
              alt="Hermes"
              width="26"
              height="26"
            />
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
      <div class="app-shell" classList={{ "sidebar-collapsed": collapsed() }}>
        <aside class="desktop-navigation">
          <Show when={!collapsed()}>{navigation()}</Show>
        </aside>
        <main class="main-view">
          <header class="topbar">
            <IconButton
              icon="menu"
              class="mobile-only"
              label="Open conversations"
              onClick={() => setSheet(true)}
            />
            <Show when={collapsed()}>
              <IconButton
                icon="sidebar-collapse"
                class="desktop-only"
                label="Expand sidebar"
                onClick={toggleSidebar}
              />
            </Show>
            <span class="view-title">
              {selected() || view().startsWith("[")
                ? ""
                : view() === "capabilities"
                ? "Capabilities"
                : view()
                  .replace(/^(resources|settings):/, "")
                  .replace(/^./, (x) => x.toUpperCase())}
            </span>
            <IconButton
              icon="plus"
              label="New conversation"
              disabled={!connected()}
              onClick={() => void newChat(selected()?.profile ?? "default")}
            />
            <IconButton
              icon="search"
              label="Search conversations"
              onClick={() => setPalette(true)}
            />
            <Show when={selected()}>
              {(c) => (
                <>
                  <IconButton
                    icon="archive"
                    label={c().section === "archived"
                      ? "Unarchive conversation"
                      : "Archive conversation"}
                    disabled={c().section !== "archived" &&
                      (c().running || c().pendingInput)}
                    onClick={() =>
                      void run(() =>
                        mutate("workspace.move", {
                          key: c().key,
                          section: c().section === "archived"
                            ? "recent"
                            : "archived",
                        })
                      )}
                  />
                  <IconButton
                    icon="more-horiz"
                    label="Conversation actions"
                    onClick={(event) => openMenu(c(), event)}
                  />
                </>
              )}
            </Show>
            <IconButton
              icon="bell"
              label="Notifications"
              onClick={() => navigate("settings:notifications")}
            />
            <IconButton
              icon="settings"
              label="Settings"
              onClick={() => navigate("settings")}
            />
            <Show when={workspace()?.notices?.some((n) => !n.read)}>
              <span
                class="notification-count"
                role="status"
                aria-label="Unread notifications"
              >
                {workspace()?.notices?.filter((n) => !n.read).length}
              </span>
            </Show>
          </header>
          <Suspense fallback={<div class="loading">Opening…</div>}>
            <Show
              when={view() !== "capabilities"}
              fallback={<Capabilities navigate={navigate} />}
            >
              <Show
                when={view().startsWith("settings")}
                fallback={
                  <Show
                    when={view().startsWith("resources:")}
                    fallback={
                      <Show
                        when={view()}
                        fallback={
                          <section class="home-view">
                            <header class="home-heading">
                              <img
                                class="brand-mark"
                                src="/hermes/app-icon.png"
                                alt="Hermes"
                                width="26"
                                height="26"
                              />
                              <h1>Your conversations</h1>
                              <p class="quiet">
                                Pick up where you left off, or start something
                                new.
                              </p>
                            </header>
                            <div class="home-actions">
                              <button
                                type="button"
                                onClick={() => void newChat()}
                              >
                                <Icon name="plus" />
                                <span>
                                  New conversation
                                  <small>Ask Hermes anything</small>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setPalette(true)}
                              >
                                <Icon name="search" />
                                <span>
                                  Find a conversation
                                  <small>Search your history</small>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate("resources:artifacts")}
                              >
                                <Icon name="folder" />
                                <span>
                                  Browse generated files
                                  <small>Outputs across conversations</small>
                                </span>
                              </button>
                            </div>
                            <div class="home-list-heading">
                              <h2>Recent conversations</h2>
                              <button
                                type="button"
                                class="text-button"
                                onClick={() => setPalette(true)}
                              >
                                View all <Icon name="arrow-left" />
                              </button>
                            </div>
                            <div class="home-conversations">
                              <For
                                each={chats()
                                  .filter((item) => item.section !== "archived")
                                  .slice(0, 12)}
                                fallback={
                                  <p class="quiet">
                                    Your conversations will appear here.
                                  </p>
                                }
                              >
                                {(item) => (
                                  <div class="home-conversation">
                                    <button
                                      type="button"
                                      onClick={() => navigate(item.key)}
                                    >
                                      <Icon name="chat-bubble" />
                                      <span>
                                        {item.title}
                                        <small>{item.profile}</small>
                                      </span>
                                      <Show when={item.running}>
                                        <span class="badge">Working</span>
                                      </Show>
                                      <time
                                        datetime={new Date(
                                          item.activityAt,
                                        ).toISOString()}
                                      >
                                        {new Date(
                                          item.activityAt,
                                        ).toLocaleDateString(undefined, {
                                          month: "short",
                                          day: "numeric",
                                        })}
                                      </time>
                                    </button>
                                    <IconButton
                                      icon="more-horiz"
                                      label={`Home actions for ${item.title}`}
                                      onClick={(event) => openMenu(item, event)}
                                    />
                                  </div>
                                )}
                              </For>
                            </div>
                          </section>
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
                            navigate(String(result.key));
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
        <CommandPalette
          query={search()}
          search={setSearch}
          items={paletteItems()}
          searching={searching()}
          error={searchError()}
          close={() => {
            setPalette(false);
            setSearch("");
          }}
        />
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
      <Show when={iconPicker()}>
        {(conversation) => (
          <Dialog
            title="Choose an Essentials icon"
            close={() => setIconPicker(undefined)}
          >
            <div class="essential-icon-picker">
              <For each={essentialIcons}>
                {([icon, label]) => (
                  <button
                    type="button"
                    aria-label={label}
                    title={label}
                    aria-pressed={(workspace()?.conversations.find(
                      (item) => item.key === conversation().key,
                    )?.essentialIcon ??
                      (conversation().bot ? "bot" : "chat-bubble")) === icon}
                    onClick={() =>
                      void run(async () => {
                        await mutate("workspace.setEssentialIcon", {
                          key: conversation().key,
                          icon,
                        });
                        setIconPicker(undefined);
                      })}
                  >
                    <Icon name={icon} />
                  </button>
                )}
              </For>
            </div>
          </Dialog>
        )}
      </Show>
      <Show when={menu()}>
        {(c) => (
          <Dialog
            title={c().title}
            class="conversation-menu"
            anchor={menuAnchor()}
            close={() => setMenu(undefined)}
          >
            <div class="action-list">
              <Show when={c().section === "essential"}>
                <button
                  type="button"
                  onClick={() => {
                    setIconPicker(c());
                    setMenu(undefined);
                  }}
                >
                  <Icon name="edit-pencil" />
                  Change icon
                </button>
              </Show>
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
                  ["essential", "Toggle Essentials"],
                  ["pinned", "Toggle pinned"],
                ]}
              >
                {([section, label]) => (
                  <button
                    type="button"
                    aria-pressed={c().section === section}
                    onClick={() =>
                      void run(async () => {
                        await mutate("workspace.move", {
                          key: c().key,
                          section: c().section === section ? "recent" : section,
                        });
                        setMenu(undefined);
                      })}
                  >
                    <Icon name={section === "essential" ? "star" : "pin"} />
                    {label}
                  </button>
                )}
              </For>
              <For each={workspace()?.folders ?? []}>
                {(f) => (
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
                    <Icon name="folder" />
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
                  <Icon name="edit-pencil" />
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
                <Icon name="download" />
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
                <Icon name="trash" />
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
