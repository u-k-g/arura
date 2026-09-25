import ProfilePicker from "./ProfilePicker.tsx";
import SettingsFrame from "./SettingsFrame.tsx";
import ActionDialog from "./ActionDialog.tsx";
import { confirmAction } from "./ActionDialog.tsx";
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

function InlineRename(props: {
  initial: string;
  label: string;
  save: (name: string) => Promise<void>;
  cancel: () => void;
}) {
  let input!: HTMLInputElement;
  let cancelled = false;
  let saving = false;
  const [draftName, setDraftName] = createSignal(props.initial);
  const save = () => {
    if (cancelled || saving) return;
    saving = true;
    void props.save(draftName().trim()).finally(() => {
      saving = false;
    });
  };
  onMount(() =>
    globalThis.queueMicrotask(() => {
      input.scrollIntoView({ block: "nearest" });
      input.focus();
      input.select();
    })
  );
  return (
    <input
      ref={input}
      class="inline-rename"
      aria-label={props.label}
      value={draftName()}
      onInput={(event) => setDraftName(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          save();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelled = true;
          props.cancel();
        }
      }}
      onBlur={() => {
        save();
      }}
    />
  );
}

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
  const [desktopResourceHost, setDesktopResourceHost] = createSignal<
    HTMLElement
  >();
  const [mobileResourceHost, setMobileResourceHost] = createSignal<
    HTMLElement
  >();
  const resourceSection = () => {
    const route = view().split("?")[0];
    return route === "resources:profiles"
      ? "profiles"
      : route === "resources:jobs"
      ? "jobs"
      : undefined;
  };
  const resourceSidebarMount = () =>
    narrow()
      ? sheet() ? mobileResourceHost() : undefined
      : collapsed()
      ? undefined
      : desktopResourceHost();
  const navigationTitle = () =>
    resourceSection() === "profiles"
      ? "Profiles & bots"
      : resourceSection() === "jobs"
      ? "Scheduled jobs"
      : "Conversations";
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
    if (!palette() || !query || /^[1-9]$/.test(query)) {
      setMatches([]);
      setSearching(false);
      setSearchError("");
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
  const [menu, setMenu] = createSignal<Conversation>();
  const [folderPicker, setFolderPicker] = createSignal(false);
  const [editing, setEditing] = createSignal<{
    kind: "conversation" | "folder";
    id: string;
  }>();
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
  const openMenuAt = (conversation: Conversation, x: number, y: number) => {
    setMenuAnchor({ x, y });
    setFolderPicker(false);
    setMenu(conversation);
  };
  const openMenu = (conversation: Conversation, event: MouseEvent) => {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openMenuAt(
      conversation,
      event.clientX || bounds.left,
      event.clientY || bounds.bottom,
    );
  };
  const beginRename = (
    kind: "conversation" | "folder",
    id: string,
    openSheet = true,
  ) => {
    setMenu(undefined);
    if (narrow() && openSheet) setSheet(true);
    setEditing({ kind, id });
  };
  let titlePressTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTitleTap = 0;
  const cancelTitlePress = () => {
    if (titlePressTimer !== undefined) clearTimeout(titlePressTimer);
    titlePressTimer = undefined;
  };
  onCleanup(cancelTitlePress);
  let threadPress:
    | {
      pointer: number;
      x: number;
      y: number;
      conversation: Conversation;
      triggered: boolean;
      timer: ReturnType<typeof setTimeout>;
    }
    | undefined;
  let suppressedThreadClick: string | undefined;
  const cancelThreadPress = () => {
    if (threadPress) clearTimeout(threadPress.timer);
    threadPress = undefined;
  };
  onCleanup(cancelThreadPress);
  const startThreadPress = (c: Conversation, event: PointerEvent) => {
    if (!narrow() || !sheet()) return;
    suppressedThreadClick = undefined;
    if (event.pointerType === "mouse") return;
    cancelThreadPress();
    const { clientX: x, clientY: y, pointerId: pointer } = event;
    threadPress = {
      pointer,
      x,
      y,
      conversation: c,
      triggered: false,
      timer: setTimeout(() => {
        if (threadPress?.pointer === pointer) threadPress.triggered = true;
      }, 500),
    };
  };
  const moveThreadPress = (event: PointerEvent) => {
    if (threadPress?.pointer !== event.pointerId) return;
    if (
      Math.hypot(event.clientX - threadPress.x, event.clientY - threadPress.y) >
        10
    ) {
      cancelThreadPress();
    }
  };
  const finishThreadPress = () => {
    const press = threadPress;
    cancelThreadPress();
    if (!press?.triggered) return;
    suppressedThreadClick = press.conversation.key;
    setTimeout(() => openMenuAt(press.conversation, press.x, press.y), 0);
  };
  const threadContextMenu = (c: Conversation, event: MouseEvent) => {
    event.preventDefault();
    if (narrow() && sheet() && threadPress) {
      threadPress.triggered = true;
      return;
    }
    cancelThreadPress();
    if (narrow() && sheet()) suppressedThreadClick = c.key;
    openMenu(c, event);
  };
  const selectThread = (c: Conversation) => {
    if (suppressedThreadClick === c.key) {
      suppressedThreadClick = undefined;
      return;
    }
    navigate(c.key);
  };
  const stopRename = (kind: "conversation" | "folder", id: string) => {
    setEditing((current) =>
      current?.kind === kind && current.id === id ? undefined : current,
    );
  };
  const saveRename = async (
    kind: "conversation" | "folder",
    id: string,
    initial: string,
    name: string,
  ) => {
    if (editing()?.kind !== kind || editing()?.id !== id) return;
    if (!name || name === initial) {
      stopRename(kind, id);
      return;
    }
    try {
      if (kind === "conversation") {
        await command("rename", id, { title: name });
      } else {
        await mutate("workspace.folder", { id, name });
      }
      stopRename(kind, id);
    } catch (error) {
      inform(error instanceof Error ? error.message : "Rename failed");
    }
  };
  const destinations = [
    { id: "settings", label: "Settings" },
    { id: "resources:artifacts", label: "Generated files" },
    { id: "resources:profiles", label: "Profiles & bots" },
    { id: "resources:jobs", label: "Schedules" },
    { id: "resources:skills", label: "Installed skills" },
    { id: "resources:usage", label: "Usage" },
  ];
  const essentialConversations = createMemo(() =>
    chats().filter((c) => c.section === "essential")
      .sort((a, b) => a.rank - b.rank)
  );
  const pinnedConversations = createMemo(() =>
    chats().filter((c) => c.section === "pinned" && !c.folderId)
      .sort((a, b) => a.rank - b.rank)
  );
  const folderConversations = (folderId: string) =>
    chats().filter((c) => c.folderId === folderId)
      .sort((a, b) => a.rank - b.rank);
  const recentConversations = createMemo(() =>
    chats()
      .filter((c) => c.section === "recent" && !c.backgroundSession)
      .sort((a, b) => conversationActivity(b) - conversationActivity(a))
  );
  const sidebarConversations = () => [
    ...essentialConversations(),
    ...pinnedConversations(),
    ...(workspace()?.folders ?? []).flatMap((folder) =>
      folderConversations(folder._id)
    ),
    ...recentConversations(),
  ];
  const paletteItems = (): PaletteItem[] => {
    const query = search().trim().toLowerCase();
    const ordered = sidebarConversations();
    const slotFor = (key: string) => {
      const index = ordered.findIndex((item) => item.key === key);
      return index >= 0 && index < 9 ? index + 1 : undefined;
    };
    const conversationItem = (
      item: { key: string; title: string },
      group: string,
    ): PaletteItem => ({
      id: item.key,
      label: item.title,
      group,
      slot: slotFor(item.key),
      run: () => navigate(item.key),
    });
    if (/^[1-9]$/.test(query)) {
      const item = ordered[Number(query) - 1];
      return item ? [conversationItem(item, "Sidebar slots")] : [];
    }
    const items: PaletteItem[] = [
      {
        id: "new",
        label: "New conversation",
        group: "Commands",
        run: () => void newChat(currentProfile()),
      },
      {
        id: "sidebar",
        label: collapsed() ? "Expand sidebar" : "Collapse sidebar",
        group: "Commands",
        run: () => {
          toggleSidebar();
          setPalette(false);
        },
      },
      ...destinations.map((item) => ({
        ...item,
        group: "Commands",
        run: () => navigate(item.id),
      })),
    ].filter((item) => !query || item.label.toLowerCase().includes(query));
    const results = [
      ...new Map(
        [
          ...ordered.filter(
            (item) => !query || item.title.toLowerCase().includes(query),
          ),
          ...matches(),
        ].map((item) => [item.key, item]),
      ).values(),
    ];
    items.push(
      ...results.slice(0, 50).map((item) =>
        conversationItem(
          item,
          "Conversations",
        )
      ),
    );
    return items;
  };
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
  const row = (c: Conversation, editable = true) => (
    <div
      class="thread-row"
      classList={{
        selected: view() === c.key,
        unread: Boolean(unread(c)),
        running: Boolean(c.running),
        draft: Boolean(draftFor(c.key, c.profile)),
      }}
    >
      <Show
        when={editable && editing()?.kind === "conversation" &&
          editing()?.id === c.key}
        fallback={
          <button
            type="button"
            class="thread-select"
            onContextMenu={(event) => threadContextMenu(c, event)}
            onPointerDown={(event) => startThreadPress(c, event)}
            onPointerMove={moveThreadPress}
            onPointerUp={finishThreadPress}
            onPointerCancel={cancelThreadPress}
            onPointerLeave={cancelThreadPress}
            aria-current={view() === c.key ? "page" : undefined}
            title={c.title}
            aria-label={c.title}
            onClick={() => selectThread(c)}
            onDblClick={() => {
              if (editable && !c.bot) beginRename("conversation", c.key);
            }}
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
          </button>
        }
      >
        <div class="thread-select thread-rename">
          <span class="session-dot" />
          <InlineRename
            initial={c.title}
            label="Rename conversation"
            save={(name) => saveRename("conversation", c.key, c.title, name)}
            cancel={() => stopRename("conversation", c.key)}
          />
        </div>
      </Show>
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
  const chatView = () =>
    !view() ||
    (view() !== "capabilities" &&
      !view().startsWith("settings") &&
      !view().startsWith("resources:"));
  const mobileChatActions = {
    openNavigation: () => setSheet(true),
    openPalette: () => setPalette(true),
    newChat: () => void newChat(currentProfile()),
  };
  const gatewayOnline = () => connected() && !!workspace()?.connection?.online;
  const gatewayStatus = () => (
    <button
      type="button"
      class="gateway-status"
      aria-label={`Gateway ${gatewayOnline() ? "connected" : "disconnected"}`}
      title={`Gateway ${gatewayOnline() ? "connected" : "disconnected"}`}
      onClick={() => navigate("resources:status")}
    >
      <span class="connection" classList={{ offline: !gatewayOnline() }}>
        <i aria-hidden="true" />
      </span>
    </button>
  );
  const navigation = (mobile = false) => (
    <div class="navigation">
      <header class="sidebar-titlebar">
        <IconButton
          icon="sidebar-collapse"
          class="desktop-only"
          label="Collapse sidebar"
          onClick={toggleSidebar}
        />
        {gatewayStatus()}
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
      <Show when={!resourceSection()}>
        <div class="nav-scroll">
          <Show when={essentialConversations().length}>
            <div class="essentials">
              <For each={essentialConversations()}>
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
                      name={c.essentialIcon ?? (c.bot ? "bot" : "message-text")}
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
          <For each={pinnedConversations()}>
            {(c) => row(c)}
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
                  <Show
                    when={editing()?.kind === "folder" &&
                      editing()?.id === folder._id}
                    fallback={
                      <button
                        type="button"
                        class="folder-name"
                        onDblClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          beginRename("folder", folder._id);
                        }}
                      >
                        {folder.name}
                      </button>
                    }
                  >
                    <InlineRename
                      initial={folder.name}
                      label="Rename folder"
                      save={(name) =>
                        saveRename("folder", folder._id, folder.name, name)}
                      cancel={() => stopRename("folder", folder._id)}
                    />
                  </Show>
                  <IconButton
                    icon="edit-pencil"
                    label={`Rename folder ${folder.name}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      beginRename("folder", folder._id);
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
                <For each={folderConversations(folder._id)}>
                  {(c) => row(c)}
                </For>
              </details>
            )}
          </For>
          <div class="pinned-divider" aria-hidden="true" />
          <For each={recentConversations()}>{(c) => row(c)}</For>
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
                      onClick={() => selectThread(c)}
                      onContextMenu={(event) => threadContextMenu(c, event)}
                      onPointerDown={(event) => startThreadPress(c, event)}
                      onPointerMove={moveThreadPress}
                      onPointerUp={finishThreadPress}
                      onPointerCancel={cancelThreadPress}
                      onPointerLeave={cancelThreadPress}
                    >
                      <span>{c.title}</span>
                      <Show when={c.archivedAt}>
                        {(at) => (
                          <time
                            class="session-age"
                            title={`Archived ${
                              new Date(at()).toLocaleString()
                            }`}
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
                    <IconButton
                      icon="more-horiz"
                      class="row-menu-button"
                      label={`Actions for ${c.title}`}
                      onClick={(event) => openMenu(c, event)}
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
      </Show>
      <Show when={resourceSection()}>
        <div
          class="nav-scroll resource-sidebar-host"
          ref={(node) =>
            mobile ? setMobileResourceHost(node) : setDesktopResourceHost(node)}
        />
      </Show>
      <footer class="nav-footer">
        <div class="footer-actions">
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
          <span class="footer-spacer" />
          {conversationActions()}
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
          <Show when={!chatView() || selected()}>
            <header class="topbar mobile-only">
              <Show when={!chatView()}>
                <IconButton
                  icon="menu"
                  label={
                    resourceSection()
                      ? `Open ${navigationTitle()}`
                      : "Open conversations"
                  }
                  onClick={() => setSheet(true)}
                />
              </Show>
              <Show when={chatView() && selected()}>
                {(c) => (
                  <>
                    <Show
                      when={
                        editing()?.kind === "conversation" &&
                        editing()?.id === c().key
                      }
                      fallback={
                        <button
                          type="button"
                          class="mobile-thread-title"
                          title={`${c().title} · Double tap to rename; long press for actions`}
                          aria-label={`${c().title}, double tap to rename or long press for actions`}
                          onDblClick={() =>
                            !c().bot &&
                            beginRename("conversation", c().key, false)
                          }
                          onContextMenu={(event) => {
                            event.preventDefault();
                            cancelTitlePress();
                            openMenu(c(), event);
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key !== "ContextMenu" &&
                              !(event.shiftKey && event.key === "F10")
                            )
                              return;
                            event.preventDefault();
                            const bounds =
                              event.currentTarget.getBoundingClientRect();
                            openMenuAt(c(), bounds.left, bounds.bottom);
                          }}
                          onPointerDown={(event) => {
                            if (event.pointerType === "mouse") return;
                            cancelTitlePress();
                            const bounds =
                              event.currentTarget.getBoundingClientRect();
                            const x = event.clientX || bounds.left;
                            const y = event.clientY || bounds.bottom;
                            titlePressTimer = setTimeout(() => {
                              titlePressTimer = undefined;
                              lastTitleTap = 0;
                              openMenuAt(c(), x, y);
                            }, 500);
                          }}
                          onPointerUp={(event) => {
                            if (event.pointerType === "mouse") return;
                            if (titlePressTimer === undefined) return;
                            cancelTitlePress();
                            const now = Date.now();
                            if (now - lastTitleTap < 350 && !c().bot) {
                              beginRename("conversation", c().key, false);
                              lastTitleTap = 0;
                            } else lastTitleTap = now;
                          }}
                          onPointerCancel={cancelTitlePress}
                          onPointerLeave={cancelTitlePress}
                        >
                          {c().title}
                        </button>
                      }
                    >
                      <div class="mobile-thread-title mobile-thread-rename">
                        <InlineRename
                          initial={c().title}
                          label="Rename conversation"
                          save={(name) =>
                            saveRename("conversation", c().key, c().title, name)
                          }
                          cancel={() => stopRename("conversation", c().key)}
                        />
                      </div>
                    </Show>
                    <IconButton
                      icon="archive"
                      class="mobile-archive-button"
                      label={`${c().section === "archived" ? "Unarchive" : "Archive"} ${c().title}`}
                      disabled={
                        c().section !== "archived" &&
                        (c().running || c().pendingInput)
                      }
                      onClick={() => void run(() => archiveConversation(c()))}
                    />
                  </>
                )}
              </Show>
              <Show when={!chatView()}>
                {navigationActions()}
                {conversationActions()}
              </Show>
            </header>
          </Show>
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
                        <Chat
                          conversation={view()}
                          reset={blankChatVersion()}
                          profile={chosenProfile()}
                          title={selected()?.title ?? "New session"}
                          navigate={navigate}
                          mobileActions={mobileChatActions}
                        />
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
                                  sidebarMount={resourceSidebarMount}
                                  closeSidebar={() => setSheet(false)}
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
          title={navigationTitle()}
          class="navigation-sheet"
          close={() => setSheet(false)}
        >
          {navigation(true)}
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
                      (conversation().bot ? "bot" : "message-text")) === icon}
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
              <Show
                when={folderPicker()}
                fallback={
                  <>
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
                      <Icon name="eye" />
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
                                section: c().section === section
                                  ? "recent"
                                  : section,
                              });
                              setMenu(undefined);
                            })}
                        >
                          <Icon
                            name={section === "essential" ? "star" : "pin"}
                          />
                          {label}
                        </button>
                      )}
                    </For>
                    <button type="button" onClick={() => setFolderPicker(true)}>
                      <Icon name="folder" />
                      Move to folder
                    </button>
                    <Show when={!c().bot}>
                      <button
                        type="button"
                        onClick={() => beginRename("conversation", c().key)}
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
                    <Show when={c().section === "archived"}>
                      <button
                        type="button"
                        class="danger"
                        onClick={async () => {
                          if (
                            await confirmAction(
                              "Permanently delete this conversation?",
                            )
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
                    </Show>
                  </>
                }
              >
                <button type="button" onClick={() => setFolderPicker(false)}>
                  <Icon name="arrow-left" />
                  Back
                </button>
                <div class="folder-picker-heading">Move to folder</div>
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
                <Show when={c().folderId}>
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await mutate("workspace.move", {
                          key: c().key,
                          section: "pinned",
                        });
                        setMenu(undefined);
                      })}
                  >
                    <Icon name="pin" />
                    Remove from folder
                  </button>
                </Show>
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      const id = await mutate("workspace.folder", {
                        name: "Untitled",
                        conversationKey: c().key,
                      });
                      beginRename("folder", String(id));
                    })}
                >
                  <Icon name="plus" />
                  Create new folder
                </button>
              </Show>
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
