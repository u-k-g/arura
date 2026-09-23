import ProfilePicker from "./ProfilePicker.tsx";
import SettingsFrame from "./SettingsFrame.tsx";
import ActionDialog from "./ActionDialog.tsx";
import { ask, confirmAction } from "./ActionDialog.tsx";
import type { ConversationPage, Doc } from "../shared/contracts.ts";
import { essentialIconChoices } from "../shared/essentialIcons.ts";
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
  untrack,
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
  saveDraft,
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
import {
  archiveAgeStatus,
  type Conversation,
  conversationActivity,
  conversationArchiveActivity,
  conversationReadActivity,
} from "../shared/model.ts";
import CommandPalette, { type PaletteItem } from "./CommandPalette.tsx";
const Chat = lazy(() => import("./Chat.tsx"));
const Settings = lazy(() => import("./Settings.tsx"));
const Resources = lazy(() => import("./Resources.tsx"));
const Messaging = lazy(() => import("./Messaging.tsx"));
const Capabilities = lazy(() => import("./Capabilities.tsx"));
const Artifacts = lazy(() => import("./Artifacts.tsx"));

export default function App() {
  const [blankChatVersion, setBlankChatVersion] = createSignal(0);
  const [collapsed, setCollapsed] = createSignal(
    preferences.getItem("arura.sidebarCollapsed") === "true",
  );
  const toggleSidebar = () =>
    setCollapsed((value) => {
      preferences.setItem("arura.sidebarCollapsed", String(!value));
      return !value;
    });
  const narrowQuery = matchMedia(
    "(max-width: 720px), (pointer: coarse) and (hover: none)",
  );
  const [narrow, setNarrow] = createSignal(narrowQuery.matches);
  onMount(() => {
    const update = () => setNarrow(narrowQuery.matches);
    update();
    narrowQuery.addEventListener("change", update);
    onCleanup(() => narrowQuery.removeEventListener("change", update));
  });
  const [menuAnchor, setMenuAnchor] = createSignal<{ x: number; y: number }>();
  const [iconPicker, setIconPicker] = createSignal<Conversation>();
  const [iconSearch, setIconSearch] = createSignal("");
  createEffect(() => {
    iconPicker();
    setIconSearch("");
  });
  const savedView = preferences.getItem("arura.view") ?? "";
  const initialView = savedView.split("?")[0] === "resources:files"
    ? "resources:artifacts"
    : savedView;
  if (initialView !== savedView) preferences.setItem("arura.view", initialView);
  const [view, setView] = createSignal(initialView);
  const [sheet, setSheet] = createSignal(false),
    [search, setSearch] = createSignal(""),
    [palette, setPalette] = createSignal(false);
  const [matches, setMatches] = createSignal<
    { key: string; title: string; profile: string }[]
  >([]);
  onMount(() => {
    const openPalette = (event: KeyboardEvent) => {
      if (
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.isComposing &&
        event.key.toLowerCase() === "k" &&
        authorized()
      ) {
        event.preventDefault();
        setPalette(true);
      }
    };
    globalThis.addEventListener("keydown", openPalette);
    onCleanup(() => globalThis.removeEventListener("keydown", openPalette));
  });
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
  const [archiveReady, setArchiveReady] = createSignal(false);
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
              const merged = [newDraft, oldDraft].filter(Boolean).join("\n\n");
              await draft(conversation.key, merged);
              await draft(key, "");
              saveDraft(conversation.profile, conversation.key, merged);
              saveDraft(
                (JSON.parse(key) as string[])[0] ?? conversation.profile,
                key,
                "",
              );
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
  const [username, setUsername] = createSignal(""),
    [password, setPassword] = createSignal(""),
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
      connected();
      const count = archiveLimit() / 10;
      setArchiveReady(false);
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
          setArchiveReady(true);
        }
      });
      const follow = (index: number, cursor: string | null) => {
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
              setArchiveReady(true);
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
  const chats = () => (workspace()?.conversations ?? []) as Conversation[];
  const draftFor = (key: string, profile: string) =>
    workspace()?.drafts?.find(
      (item) => item.key === key && item.profile === profile,
    )?.text;
  const draftPreview = (text: string) =>
    text.trim().split("\n")[0]?.slice(0, 60) || "Draft";
  const selected = () =>
    chats().find((c) => c.key === view()) ??
      archived().find((c) => c.key === view()) ??
      activeConversation();
  const unread = (conversation: Conversation) => {
    const state = workspace()?.reads?.find(
      (item) => item.key === conversation.key,
    );
    return (
      state?.unread ||
      conversationReadActivity(conversation) >
        (state?.activityAt ?? workspace()?.readBaseline ?? Infinity)
    );
  };
  onMount(() => {
    const markVisible = () => {
      const current = selected();
      if (
        connected() && current &&
        globalThis.document.visibilityState === "visible"
      ) {
        void mutate("workspace.markRead", {
          key: current.key,
          unread: false,
        }).catch(() => {});
      }
    };
    globalThis.document.addEventListener("visibilitychange", markVisible);
    onCleanup(() =>
      globalThis.document.removeEventListener("visibilitychange", markVisible)
    );
  });
  const viewedRevision = createMemo(() => {
    const current = selected();
    return current ? `${current.key}:${conversationReadActivity(current)}` : "";
  });
  createEffect(() => {
    viewedRevision();
    const online = connected();
    untrack(() => {
      const current = selected();
      if (
        online && globalThis.document.visibilityState === "visible" && current
      ) {
        void mutate("workspace.markRead", {
          key: current.key,
          unread: false,
        }).catch(() => {});
      }
    });
  });
  const [chosenProfile, setChosenProfile] = createSignal(
    preferences.getItem("arura.profile") || "default",
  );
  const currentProfile = () => selected()?.profile ?? chosenProfile();
  createEffect(() => {
    const profile = selected()?.profile;
    if (profile) {
      setChosenProfile(profile);
      preferences.setItem("arura.profile", profile);
    }
  });
  function newChat(profile = currentProfile()) {
    setChosenProfile(profile);
    preferences.setItem("arura.profile", profile);
    void draft("", "");
    void draftAttachments("", []);
    saveDraft(profile, "", "");
    if (view() === "") setBlankChatVersion((value) => value + 1);
    else navigate("");
    return Promise.resolve();
  }
  async function archiveConversation(conversation: Conversation) {
    const section = conversation.section === "archived" ? "recent" : "archived";
    await mutate("workspace.move", { key: conversation.key, section });
    if (section === "archived" && view() === conversation.key) {
      setChosenProfile(conversation.profile);
      navigate("");
    }
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
        run: () => void newChat(currentProfile()),
      },
      {
        id: "folder",
        label: "New folder",
        icon: "folder",
        group: "Actions",
        run: () => {
          setPalette(false);
          setFolderName("");
        },
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
  const recentConversations = createMemo(() =>
    chats()
      .filter((c) => c.section === "recent" && !c.backgroundSession)
      .sort((a, b) => conversationActivity(b) - conversationActivity(a))
  );
  const [ageNow, setAgeNow] = createSignal(Date.now());
  const ageTimer = setInterval(() => setAgeNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(ageTimer));
  const ageStatus = (c: Conversation) =>
    archiveAgeStatus(
      c,
      Number(workspace()?.settings.archiveDays ?? 14),
      ageNow(),
      workspace()?.settings.archiveEnabled !== false,
    );
  const ageFrom = (timestamp: number) => {
    const minutes = Math.floor(Math.max(0, ageNow() - timestamp) / 60_000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };
  const ageLabel = (c: Conversation) => {
    const activity = c.section === "recent" &&
        workspace()?.settings.archiveEnabled !== false
      ? conversationArchiveActivity(c)
      : conversationActivity(c);
    return ageFrom(activity);
  };
  const ageTitle = (c: Conversation) => {
    if (
      c.section !== "recent" ||
      c.bot ||
      c.folderId ||
      workspace()?.settings.archiveEnabled === false
    ) return undefined;
    if (c.pendingInput) {
      return "Automatic archive paused while input is pending";
    }
    if (c.running) return "Automatic archive paused while the agent is working";
    if (
      c.section === "recent" &&
      (c.unarchivedAt ?? 0) > conversationActivity(c)
    ) return "Time since restoration; the archive clock restarted";
    if (ageStatus(c) === "overdue") return "Due for automatic archive";
    if (ageStatus(c) === "warning") return "Automatic archive within one day";
    return undefined;
  };
  const row = (c: Conversation) => (
    <div
      class="thread-row"
      classList={{
        selected: view() === c.key,
        unread: Boolean(unread(c)),
        draft: Boolean(draftFor(c.key, c.profile)),
      }}
    >
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
        onClick={() => navigate(c.key)}
      >
        <span class="session-dot" />
        <span>{c.title}</span>
        <Show
          when={draftFor(c.key, c.profile)}
          fallback={
            <time
              class="session-age"
              classList={{
                "archive-warning": ageStatus(c) === "warning",
                "archive-overdue": ageStatus(c) === "overdue",
              }}
              title={ageTitle(c)}
            >
              {ageLabel(c)}
            </time>
          }
        >
          <i class="draft-indicator" title="Draft saved">
            <Icon name="edit-pencil" />
          </i>
        </Show>
        <Show when={c.running}>
          <i class="busy-dot" />
        </Show>
      </button>
      <IconButton
        icon="archive"
        class="archive-button"
        label={`Archive ${c.title}`}
        disabled={c.running || c.pendingInput}
        onClick={() => void run(() => archiveConversation(c))}
      />
      <IconButton
        icon="more-horiz"
        class="row-menu-button"
        label={`Actions for ${c.title}`}
        onClick={(event) => openMenu(c, event)}
      />
    </div>
  );
  const conversationActions = () => (
    <IconButton
      icon="plus"
      label="New conversation"
      onClick={() => void newChat(currentProfile())}
    />
  );
  const navigationActions = () => (
    <>
      <IconButton
        icon="search"
        label="Search conversations"
        onClick={() => setPalette(true)}
      />
    </>
  );
  const gatewayStatus = () => (
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
        {gatewayStatus()}
        {navigationActions()}
      </header>
      <nav class="sidebar-sections" aria-label="Main navigation">
        <For
          each={[
            ["threads", "Threads", "message-text"],
            ["resources:profiles", "Bots", "comp-align-bottom-solid"],
            ["resources:jobs", "Cron jobs", "timer"],
          ]}
        >
          {([route, label, icon]) => {
            const active = () =>
              route === "threads"
                ? !view() || view().startsWith("[")
                : view().split("?")[0] === route;
            return (
              <button
                type="button"
                title={label}
                aria-label={label}
                aria-current={active() ? "page" : undefined}
                classList={{ active: active() }}
                onClick={() =>
                  navigate(
                    route === "threads"
                      ? (preferences.getItem("arura.lastConversation") ?? "")
                      : route,
                  )}
              >
                <Icon name={icon} />
              </button>
            );
          }}
        </For>
      </nav>
      <div class="nav-scroll">
        <Show when={chats().some((c) => c.section === "essential")}>
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
        <For each={(workspace()?.drafts ?? []).filter((d) => d.key === "")}>
          {(d) => (
            <div
              class="thread-row draft"
              classList={{
                selected: view() === "" && chosenProfile() === d.profile,
              }}
            >
              <button
                type="button"
                class="thread-select"
                title={draftPreview(d.text)}
                aria-label={`Draft: ${draftPreview(d.text)}`}
                onClick={() => {
                  setChosenProfile(d.profile);
                  preferences.setItem("arura.profile", d.profile);
                  navigate("");
                }}
              >
                <i class="draft-indicator">
                  <Icon name="edit-pencil" />
                </i>
                <span>{draftPreview(d.text)}</span>
              </button>
            </div>
          )}
        </For>
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
                  onClick={async () => {
                    const name = await ask("Folder name", folder.name);
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
                  onClick={async (e) => {
                    e.preventDefault();
                    if (
                      await confirmAction(
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
        <div class="pinned-divider">
          <IconButton
            icon="folder"
            class="pinned-divider-folder"
            label="New folder"
            onClick={() => setFolderName("")}
          />
          <IconButton
            icon="plus"
            label="New conversation"
            onClick={() => void newChat(currentProfile())}
          />
        </div>
        <For each={recentConversations()}>{row}</For>
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
      </div>
      <div class="archive">
        <button
          type="button"
          class="archive-toggle"
          aria-expanded={archiveOpen()}
          onClick={() => setArchiveOpen((x) => !x)}
        >
          <span>Archived</span>
          <span class="archive-rule" />
          <Icon name="nav-arrow-down" />
        </button>
        <Show when={archiveOpen()}>
          <div class="archive-list">
            <Show when={!archiveReady()}>
              <p class="archive-status" role="status">
                {connected()
                  ? "Loading archived conversations…"
                  : "Connect to load archived conversations."}
              </p>
            </Show>
            <Show when={archiveReady() && !archived().length}>
              <p class="archive-status" role="status">
                No archived conversations.
              </p>
            </Show>
            <For each={archived()}>
              {(c) => (
                <div class="thread-row">
                  <button
                    type="button"
                    class="thread-select"
                    title={c.title}
                    aria-label={c.title}
                    onClick={() => navigate(c.key)}
                  >
                    <span>{c.title}</span>
                    <Show when={c.archivedAt}>
                      {(at) => (
                        <time
                          class="session-age"
                          title={`Archived ${new Date(at()).toLocaleString()}`}
                        >
                          {ageFrom(at())}
                        </time>
                      )}
                    </Show>
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
          </div>
        </Show>
      </div>
      <footer class="nav-footer">
        <div class="profile-actions">
          <ProfilePicker
            current={currentProfile()}
            manage={() => navigate("resources:profiles")}
            choose={(profile) => {
              setChosenProfile(profile);
              preferences.setItem("arura.profile", profile);
              const latest = chats()
                .filter(
                  (c) =>
                    c.profile === profile &&
                    c.section !== "archived" &&
                    !c.backgroundSession,
                )
                .sort(
                  (a, b) => conversationActivity(b) - conversationActivity(a),
                )[0];
              navigate(latest?.key ?? "");
            }}
          />
          <IconButton
            icon="page"
            label="Artifacts"
            onClick={() => navigate("resources:artifacts")}
          />
          <IconButton
            icon="settings"
            label="Settings"
            onClick={() => navigate("settings")}
          />
        </div>
      </footer>
    </div>
  );
  return (
    <Show
      when={authorized()}
      fallback={
        <main class="authorization">
          <form
            action="/auth/login"
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy()) return;
              const fields = new FormData(e.currentTarget);
              setBusy(true);
              void run(async () => {
                await login(
                  String(fields.get("username") ?? ""),
                  String(fields.get("password") ?? ""),
                );
                setPassword("");
              }).finally(() => setBusy(false));
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
            <p>Sign in with your Hermes account.</p>
            <Field label="Username">
              <input
                id="username"
                name="username"
                autocomplete="username"
                autocapitalize="none"
                spellcheck={false}
                required
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
              />
            </Field>
            <Field label="Password">
              <input
                id="password"
                name="password"
                type="password"
                autocomplete="current-password"
                required
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
            </Field>
            <button type="submit" class="primary" disabled={busy()}>
              {busy() ? "Signing in…" : "Sign in"}
            </button>
            <p role="status">{notice()}</p>
          </form>
        </main>
      }
    >
      <div class="app-shell" classList={{ "sidebar-collapsed": collapsed() }}>
        <Show when={!narrow()}>
          <aside class="desktop-navigation">
            <Show
              when={!collapsed()}
              fallback={
                <div class="sidebar-titlebar collapsed-controls">
                  <IconButton
                    icon="sidebar-collapse"
                    label="Expand sidebar"
                    onClick={toggleSidebar}
                  />
                  {gatewayStatus()}
                  {navigationActions()}
                  {conversationActions()}
                </div>
              }
            >
              {navigation()}
            </Show>
          </aside>
        </Show>
        <main class="main-view">
          <header class="topbar mobile-only">
            <IconButton
              icon="menu"
              class="mobile-only"
              label="Open conversations"
              onClick={() => setSheet(true)}
            />
            <Show when={narrow() && selected()}>{(c) => row(c())}</Show>
            {navigationActions()}
            {conversationActions()}
          </header>
          <SettingsFrame view={view()} navigate={navigate}>
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
                            <Chat
                              conversation=""
                              reset={blankChatVersion()}
                              profile={chosenProfile()}
                              title="New session"
                              navigate={navigate}
                            />
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
                          <Show
                            when={view() === "resources:platforms"}
                            fallback={
                              <Show
                                when={![
                                  "resources:skills",
                                  "resources:toolsets",
                                  "resources:mcp",
                                ].includes(view())}
                                fallback={
                                  <Capabilities
                                    section={view().slice(10)}
                                    navigate={navigate}
                                  />
                                }
                              >
                                <Resources
                                  name={view().slice(10).split("?")[0]}
                                  navigate={navigate}
                                  newChat={async (profile) => {
                                    const result = await command(
                                      "openBot",
                                      "",
                                      {
                                        profile,
                                      },
                                    );
                                    navigate(String(result.key));
                                  }}
                                />
                              </Show>
                            }
                          >
                            <Messaging />
                          </Show>
                        }
                      >
                        <Artifacts navigate={navigate} />
                      </Show>
                    </Show>
                  }
                >
                  <Show
                    when={view() !== "settings"}
                    fallback={
                      <Resources
                        name="models"
                        navigate={navigate}
                        newChat={newChat}
                      />
                    }
                  >
                    <Settings
                      section={view().split(":")[1]}
                      navigate={navigate}
                    />
                  </Show>
                </Show>
              </Show>
            </Suspense>
          </SettingsFrame>
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
            <input
              type="search"
              class="filter"
              aria-label="Search icons"
              placeholder="Search icons…"
              value={iconSearch()}
              onInput={(event) => setIconSearch(event.currentTarget.value)}
            />
            <div class="essential-icon-picker">
              <For
                each={essentialIconChoices.filter(([icon, label]) =>
                  `${icon} ${label}`
                    .toLowerCase()
                    .includes(iconSearch().trim().toLowerCase())
                )}
              >
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
            <Show
              when={!essentialIconChoices.some(([icon, label]) =>
                `${icon} ${label}`
                  .toLowerCase()
                  .includes(iconSearch().trim().toLowerCase())
              )}
            >
              <p>No icons found.</p>
            </Show>
          </Dialog>
        )}
      </Show>
      <Show
        when={menu() &&
          (workspace()?.conversations.find(
            (item) => item.key === menu()?.key,
          ) ??
            menu())}
      >
        {(c) => (
          <Dialog
            title={c().title}
            class="conversation-menu"
            anchor={menuAnchor()}
            close={() => setMenu(undefined)}
          >
            <div class="action-list">
              <button
                type="button"
                disabled={c().section !== "archived" &&
                  (c().running || c().pendingInput)}
                onClick={() =>
                  void run(async () => {
                    await archiveConversation(c());
                    setMenu(undefined);
                  })}
              >
                <Icon name="archive" />
                {c().section === "archived" ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await mutate("workspace.markRead", {
                      key: c().key,
                      unread: !unread(c()),
                    });
                    setMenu(undefined);
                  })}
              >
                <Icon name="chat-bubble" />
                {unread(c()) ? "Mark as read" : "Mark as unread"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(c().sourceId);
                    setMenu(undefined);
                    inform("Session ID copied");
                  })}
              >
                <Icon name="page" />
                Copy session ID
              </button>
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
                  onClick={async () => {
                    const title = await ask("Conversation name", c().title);
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
                onClick={async () => {
                  if (
                    await confirmAction("Permanently delete this conversation?")
                  ) {
                    const conversation = c();
                    await run(async () => {
                      await command("delete", conversation.key, {});
                      if (view() === conversation.key) {
                        setChosenProfile(conversation.profile);
                        navigate("");
                      }
                    });
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
      <ActionDialog />
      <Show when={notice()}>
        <div class="toast" role="status">
          {notice()}
        </div>
      </Show>
    </Show>
  );
}
