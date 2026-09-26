import { toolPresentation } from "../shared/tool-presentation.ts";
import { workGroup } from "../shared/model.ts";
import { ask, confirmAction, rejectAction } from "./ActionDialog.tsx";
import ModelPicker, {
  modelKey,
  modelLabel,
  type ModelOption,
} from "./ModelPicker.tsx";
import {
  clearsStaleEffort,
  reasoningLevels,
} from "../shared/model-reasoning.ts";
import {
  type HistoryIndexItem,
  record,
  type Transcript,
} from "../shared/contracts.ts";
import {
  attachmentHref,
  contextReference,
  referencePattern,
  referenceValue,
} from "../shared/references.ts";
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
  elapsed,
  groupMessages,
  mergeHistoryMessages,
  type Message,
  type Turn,
  type TurnStats,
  userMessageText,
} from "../shared/model.ts";
import { rpcQueries } from "../shared/resources.ts";
import { draft, draftAttachments, loadCache, saveCache } from "./cache.ts";
import {
  command,
  client,
  connected,
  enqueueCommand,
  inform,
  mutate,
  request,
  refs,
  resource,
  saveDraft,
  subscribe,
  watchRuntime,
  workspace,
} from "./client.ts";
import ComposerInput, { type ComposerHandle } from "./ComposerInput.tsx";
import TurnMinimap, { type TurnMinimapItem } from "./TurnMinimap.tsx";
import { AnswerMarkdown, Markdown } from "./Markdown.tsx";
import { Dialog, Icon, IconButton, run } from "./ui.tsx";

const Clarification = lazy(() => import("./Clarification.tsx"));
const historyIndexCache = new Map<
  string,
  { revision: string; items: HistoryIndexItem[] }
>();

const ContextSuggestions = lazy(() => import("./ContextSuggestions.tsx"));
export default function Chat(props: {
  profile?: string;
  conversation: string;
  reset?: number;
  title: string;
  navigate: (view: string) => void;
  mobileActions: {
    openNavigation: () => void;
    openPalette: () => void;
    newChat: () => void;
  };
}) {
  const [historyPages, setHistoryPages] = createSignal<Transcript["pages"]>([]);
  const [activity, setActivity] = createSignal<
    Pick<Transcript, "commands" | "turn">
  >({ commands: [], turn: null });
  const [text, setText] = createSignal(""),
    [sending, setSending] = createSignal(false),
    [pages, setPages] = createSignal(1);
  const [queueOpen, setQueueOpen] = createSignal(true);
  const [statsView, setStatsView] = createSignal<{
    startedAt: number;
    finishedAt?: number;
    stats?: TurnStats;
    loading?: boolean;
  }>();
  const [expandedWork, setExpandedWork] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const workExpanded = (key: string) => expandedWork().has(key);
  const setWorkExpanded = (key: string, open: boolean) => {
    setExpandedWork((current) => {
      if (current.has(key) === open) return current;
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const workKey = (group: ReturnType<typeof groupMessages>[number]) =>
    `${props.conversation}:${
      group.prompt?.id ?? group.event?.id ?? group.work[0]?.id ?? "work"
    }`;
  const draftConfig = new Map<string, Record<string, unknown>>();
  const profileOf = (key: string) =>
    key ? (JSON.parse(key)[0] as string) : (props.profile ?? "default");
  let draftSync: ReturnType<typeof setTimeout> | undefined;
  let pendingDraft: { key: string; value: string } | undefined;
  const writeDraft = (key: string, value: string) => {
    void draft(key, value);
    clearTimeout(draftSync);
    if (pendingDraft && pendingDraft.key !== key) {
      saveDraft(
        profileOf(pendingDraft.key),
        pendingDraft.key,
        pendingDraft.value,
      );
    }
    if (!value) {
      pendingDraft = undefined;
      saveDraft(profileOf(key), key, value);
      return;
    }
    pendingDraft = { key, value };
    draftSync = setTimeout(() => {
      draftSync = undefined;
      pendingDraft = undefined;
      saveDraft(profileOf(key), key, value);
    }, 400);
  };
  onCleanup(() => {
    clearTimeout(draftSync);
    if (pendingDraft) {
      saveDraft(
        profileOf(pendingDraft.key),
        pendingDraft.key,
        pendingDraft.value,
      );
    }
  });
  const errorDismissed = (id: string) =>
    workspace()?.settings.dismissedErrors?.includes(id);
  const turnErrorId = (turn: Turn) =>
    JSON.stringify(["turn", props.conversation, turn.startedAt]);
  const dismissError = (id: string) =>
    void run(() => mutate("workspace.dismissError", { id }));
  const queued = () =>
    activity()
      .commands.filter(
        (item) => item.kind === "send" && item.status === "queued",
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  const sendNow = (id: Transcript["commands"][number]["_id"]) =>
    mutate("commands.edit", { id, sendNow: true, next: true });
  const [historyLoading, setHistoryLoading] = createSignal(false);
  const [historyRetry, setHistoryRetry] = createSignal(0);
  const [pendingPrompt, setPendingPrompt] = createSignal<{
    id: string;
    key: string;
    text: string;
    previousIds: Set<string>;
  }>();
  const historyFailure = createMemo(() => {
    const latest = activity()
      .commands.filter(
        (c) =>
          c.kind === "load" && !["queued", "dispatching"].includes(c.status),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return latest &&
      ["error", "unknown"].includes(latest.status) &&
      !errorDismissed(latest._id)
      ? latest
      : undefined;
  });
  const commandIssues = createMemo(() =>
    activity()
      .commands.filter(
        (item) =>
          ["error", "unknown"].includes(item.status) &&
          item.kind !== "load" &&
          !errorDismissed(item._id),
      )
      .sort((a, b) => b.createdAt - a.createdAt),
  );
  const [edit, setEdit] = createSignal<string>();
  const [uploads, setUploads] = createSignal<
    { path: string; name: string; image: boolean }[]
  >([]);
  const [models, setModels] = createSignal<ModelOption[]>([]),
    [model, setModel] = createSignal("");
  const [modelLoading, setModelLoading] = createSignal(false);
  let modelButton: HTMLButtonElement | undefined;
  const [currentProvider, setCurrentProvider] = createSignal("");
  const [currentModel, setCurrentModel] = createSignal("");
  const selectedModel = () => workspace()?.settings.chatModel;
  const displayedModel = () => selectedModel()?.label || currentModel();
  const [currentEffort, setCurrentEffort] = createSignal("");
  const rememberedEffort = () => {
    const selection = selectedModel();
    if (!selection) return "";
    return (
      workspace()?.settings.modelEfforts?.[
        modelKey({
          provider: selection.provider,
          id: selection.value.split(/\s+/)[0],
        })
      ] ?? ""
    );
  };
  const displayedEffort = createMemo(() => {
    const effort = rememberedEffort() || currentEffort();
    if (!effort) return "";
    const name = displayedModel();
    const provider = selectedModel()?.provider ?? currentProvider();
    const matches = models().filter((entry) =>
      [entry.id, entry.model, modelLabel(entry)].includes(name),
    );
    const entry =
      matches.find((item) => item.provider === provider) ??
      (matches.length === 1 ? matches[0] : undefined);
    const levels = entry
      ? reasoningLevels(
          entry.provider ?? "",
          entry.id ?? entry.model ?? "",
          entry.capabilities,
        )
      : reasoningLevels(provider ?? "", name);
    return levels?.includes(effort) ? effort : "";
  });
  createEffect(() => {
    if (!connected()) return;
    const key = props.conversation;
    if (!key) {
      let disposed = false;
      void resource("modelInfo")
        .then((result) => {
          if (!disposed) setCurrentModel(String(result.model ?? ""));
        })
        .catch(() => {
          /* The model picker can retry independently. */
        });
      onCleanup(() => {
        disposed = true;
      });
    } else {
      onCleanup(
        watchRuntime<{ model?: string }>(
          key,
          "session.context_breakdown",
          {},
          (result) => setCurrentModel(String(result.model ?? "")),
        ),
      );
    }
    onCleanup(
      watchRuntime<{ value?: string }>(
        key,
        "config.get",
        { key: "reasoning" },
        (result) => setCurrentEffort(String(result.value ?? "")),
      ),
    );
  });
  const [completions, setCompletions] = createSignal<
    { text: string; display?: string; meta?: string; kind?: string }[]
  >([]);
  const [completionIndex, setCompletionIndex] = createSignal(0),
    [cursor, setCursor] = createSignal(0);
  const [pendingUploads, setPendingUploads] = createSignal<
    { id: string; file: File; error?: string }[]
  >([]);
  const excludedCommand = (value: string) =>
    /^\/(?:image|imagine|flux|voice|wake|terminal|shell|hud|radio|pet|browser)(?:[-\s]|$)/i.test(
      value,
    );
  let scroller!: HTMLElement;
  let transcriptInner!: HTMLDivElement;
  const [awayFromBottom, setAwayFromBottom] = createSignal(false);
  const [cacheReady, setCacheReady] = createSignal(false);
  const [initializing, setInitializing] = createSignal(false);
  let needsInitialScroll = true;
  let scrollFrame: number | undefined;
  let liveScrollFrame: number | undefined;
  let scrollIntent = 0;
  let readingHistory = false;
  let touchStartY: number | undefined;
  const userScroll = () => {
    if (needsInitialScroll) return;
    readingHistory = true;
    setAwayFromBottom(true);
    scrollIntent++;
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
  };
  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    if (liveScrollFrame !== undefined) cancelAnimationFrame(liveScrollFrame);
  });
  const scrollToLatest = () => {
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
    readingHistory = false;
    setAwayFromBottom(false);
  };
  const maybeLoadEarlier = (preload = false) => {
    if (
      !scroller ||
      (!preload &&
        scroller.scrollTop > Math.max(800, scroller.clientHeight * 4)) ||
      !historyPages().at(-1)?.hasMore ||
      historyLoading() ||
      !connected()
    ) {
      return;
    }
    setHistoryLoading(true);
    setPages((count) => count + 1);
  };
  let input!: ComposerHandle;
  let fileInput!: HTMLInputElement;
  const historyRevision = createMemo(() =>
    historyPages()
      .map((page) => `${page.offset}:${page.revision}`)
      .join("|"),
  );
  const messages = createMemo(() => {
    historyRevision();
    // Command/status updates must not remount unchanged message groups.
    return untrack(() =>
      mergeHistoryMessages(
        historyPages()
          .slice()
          .sort((a, b) => b.offset - a.offset)
          .flatMap((page) => page.messages) as Message[],
      ),
    );
  });
  const visiblePendingPrompt = createMemo(() => {
    const pending = pendingPrompt();
    if (!pending || pending.key !== props.conversation) return;
    const command = activity().commands.find((item) => item.id === pending.id);
    if (
      command &&
      ["complete", "error", "unknown", "cancelled"].includes(command.status)
    ) {
      return;
    }
    const sentText = userMessageText(pending.text).trim();
    if (
      messages().some(
        (message) =>
          message.role === "user" &&
          !pending.previousIds.has(message.id) &&
          userMessageText(message.text).trim() === sentText,
      )
    ) {
      return;
    }
    return pending;
  });
  createEffect(() => {
    if (pendingPrompt() && !visiblePendingPrompt()) {
      // Once history owns the prompt, never revive the preview if an edit
      // later replaces that history entry.
      setPendingPrompt(undefined);
    }
  });
  const turn = () => activity().turn as Turn | null;
  // A send is on its way but no turn projection has arrived yet — the queue
  // poll, dispatch, and agent build all precede the first message.start.
  const thinking = createMemo(() => {
    if (!connected()) return false;
    const current = turn();
    if (current?.state === "running") return false;
    if (sending()) return true;
    return activity().commands.some(
      (c) =>
        (c.kind === "send" || c.kind === "sendNow") &&
        (c.status === "queued" || c.status === "dispatching") &&
        // A turn started after the command is that command's own turn.
        !(current && current.startedAt >= c.createdAt),
    );
  });
  const [clock, setClock] = createSignal(Date.now());
  let transcriptRevision = 0;
  let conversationRevision = 0;
  let lastReset = props.reset;
  onMount(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    const resize = new globalThis.ResizeObserver(() => {
      const intent = scrollIntent;
      if (liveScrollFrame !== undefined) cancelAnimationFrame(liveScrollFrame);
      liveScrollFrame = requestAnimationFrame(() => {
        liveScrollFrame = undefined;
        if (intent === scrollIntent && !awayFromBottom()) scrollToLatest();
      });
    });
    resize.observe(scroller);
    resize.observe(transcriptInner);
    onCleanup(() => {
      clearInterval(t);
      resize.disconnect();
    });
  });
  createEffect(() => {
    const key = props.conversation;
    const reset = props.reset;
    const clearBlank = !key && reset !== lastReset;
    if (clearBlank) {
      clearTimeout(draftSync);
      pendingDraft = undefined;
    }
    lastReset = reset;
    const revision = ++transcriptRevision;
    const draftRevision = ++conversationRevision;
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
    needsInitialScroll = true;
    readingHistory = false;
    setInitializing(Boolean(key));
    setCacheReady(false);
    setHistoryIndex(undefined);
    setIndexFailed(false);
    setPendingJump(undefined);
    draftConfig.clear();
    setAwayFromBottom(false);
    setHistoryPages([]);
    setActivity({ commands: [], turn: null });
    setText("");
    setPages(1);
    setHistoryLoading(false);
    setEdit(undefined);
    setPendingPrompt(undefined);
    setCurrentModel("");
    setCurrentEffort("");
    setUploads([]);
    setPendingUploads([]);
    void draftAttachments(key).then((value) => {
      if (
        !clearBlank &&
        conversationRevision === draftRevision &&
        props.conversation === key &&
        uploads().length === 0
      ) {
        setUploads(value);
      }
    });
    void draft(key).then((value) => {
      if (
        clearBlank ||
        conversationRevision !== draftRevision ||
        props.conversation !== key ||
        text() !== ""
      ) {
        return;
      }
      const remote = untrack(
        () =>
          workspace()?.drafts?.find(
            (item) => item.key === key && item.profile === profileOf(key),
          )?.text,
      );
      setText(value ?? remote ?? "");
    });
    void loadCache<Transcript>(`chat:${key}`)
      .then((value) => {
        if (props.conversation !== key || transcriptRevision !== revision) {
          return;
        }
        if (value?.pages.length) {
          setHistoryPages(value.pages);
          setPages(value.pages.length);
          requestAnimationFrame(() => {
            if (props.conversation !== key || !needsInitialScroll) return;
            scrollToLatest();
            needsInitialScroll = false;
            setInitializing(false);
          });
        }
        setCacheReady(true);
      })
      .catch(() => {
        if (props.conversation === key && transcriptRevision === revision) {
          setCacheReady(true);
        }
      });
  });
  createEffect(() => {
    const key = props.conversation;
    if (!key) return;
    connected();
    const stop = subscribe<Pick<Transcript, "commands" | "turn">>(
      "workspace",
      "activity",
      { conversation: key },
      (value) => {
        setActivity(value);
        if (liveScrollFrame !== undefined) {
          cancelAnimationFrame(liveScrollFrame);
        }
        const intent = scrollIntent;
        liveScrollFrame = requestAnimationFrame(() => {
          liveScrollFrame = undefined;
          if (
            props.conversation === key &&
            intent === scrollIntent &&
            !awayFromBottom()
          ) {
            scrollToLatest();
          }
        });
      },
    );
    onCleanup(stop);
  });
  createEffect(() => {
    const key = props.conversation;
    if (!key) return;
    if (!cacheReady()) return;
    const count = pages();
    historyRetry();
    connected();
    const requested = new Set<string>();
    const stop = subscribe<Transcript["pages"]>(
      "workspace",
      "history",
      { conversation: key, pages: count },
      (value) => {
        transcriptRevision++;
        const previousOffset = historyPages().at(-1)?.offset ?? 0;
        const prepended = (value.at(-1)?.offset ?? 0) > previousOffset;
        const viewportTop = scroller?.getBoundingClientRect().top ?? 0;
        const preservePosition =
          !needsInitialScroll && (prepended || awayFromBottom());
        const intent = scrollIntent;
        const oldScrollTop = scroller?.scrollTop ?? 0;
        const anchor = preservePosition
          ? Array.from(
              scroller?.querySelectorAll<HTMLElement>("[data-message-id]") ??
                [],
            ).find(
              (element) => element.getBoundingClientRect().bottom > viewportTop,
            )
          : undefined;
        const anchorId = anchor?.dataset.messageId;
        const anchorTop = anchor?.getBoundingClientRect().top ?? viewportTop;
        const nearBottom = needsInitialScroll || !awayFromBottom();
        setHistoryPages(value);
        if (value.length >= count || value.at(-1)?.hasMore === false) {
          setHistoryLoading(false);
        }
        const head = value.find((page) => page.offset === 0);
        for (let offset = 100; head && offset < count * 100; offset += 100) {
          const preceding = value.find((page) => page.offset === offset - 100);
          const requestId = `${head.revision}:${offset}`;
          if (
            preceding?.hasMore &&
            !value.some((page) => page.offset === offset) &&
            !requested.has(requestId) &&
            connected()
          ) {
            requested.add(requestId);
            void command("load", key, { offset }).catch(() => {
              if (props.conversation === key) setHistoryLoading(false);
            });
          }
        }
        void saveCache(`chat:${key}`, {
          pages: value,
          commands: [],
          turn: null,
        } satisfies Transcript);
        if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = undefined;
          if (
            props.conversation !== key ||
            !scroller ||
            intent !== scrollIntent
          ) {
            return;
          }
          if (needsInitialScroll && value.length) {
            scrollToLatest();
            needsInitialScroll = false;
            setInitializing(false);
          } else if (preservePosition) {
            const target = Array.from(
              scroller.querySelectorAll<HTMLElement>("[data-message-id]"),
            ).find((element) => element.dataset.messageId === anchorId);
            const shift = target
              ? target.getBoundingClientRect().top - anchorTop
              : undefined;
            scroller.scrollTop =
              shift === undefined ? oldScrollTop : scroller.scrollTop + shift;
          } else if (nearBottom) scrollToLatest();
          if (value.length >= count) maybeLoadEarlier(count < 3);
        });
      },
    );
    onCleanup(stop);
    if (connected()) {
      void command("load", key, { offset: 0 }).catch(() => {
        if (props.conversation === key) setHistoryLoading(false);
      });
    }
  });
  const changeText = (value: string) => {
    setText(value);
    writeDraft(props.conversation, value);
  };
  let composerForm!: HTMLFormElement;
  let composerMeasureFrame = 0;
  const [composerStacked, setComposerStacked] = createSignal(false);
  const measureComposer = () => {
    const entry = composerForm.querySelector<HTMLElement>(".composer-entry");
    const input = composerForm.querySelector<HTMLElement>(".composer-input");
    const controls =
      composerForm.querySelector<HTMLElement>(".composer-bottom");
    if (!entry || !input || !controls) return;
    if (globalThis.getComputedStyle(entry).display !== "contents") {
      setComposerStacked(false);
      return;
    }
    const inputStyle = globalThis.getComputedStyle(input);
    const singleLineHeight =
      parseFloat(inputStyle.lineHeight) +
      parseFloat(inputStyle.paddingTop) +
      parseFloat(inputStyle.paddingBottom);
    if (!composerStacked()) {
      setComposerStacked(input.scrollHeight > singleLineHeight + 3);
      return;
    }
    const formStyle = globalThis.getComputedStyle(composerForm);
    const controlWidthStyle = controls.style.width;
    controls.style.width = "max-content";
    const controlWidth = controls.getBoundingClientRect().width;
    controls.style.width = controlWidthStyle;
    const inlineWidth =
      composerForm.clientWidth -
      parseFloat(formStyle.paddingLeft) -
      parseFloat(formStyle.paddingRight) -
      controlWidth -
      parseFloat(formStyle.columnGap);
    if (inlineWidth <= 0) return;
    const measure = input.cloneNode(true) as HTMLElement;
    measure.removeAttribute("contenteditable");
    measure.setAttribute("aria-hidden", "true");
    measure.style.position = "absolute";
    measure.style.visibility = "hidden";
    measure.style.pointerEvents = "none";
    measure.style.width = `${inlineWidth}px`;
    measure.style.minHeight = "0";
    measure.style.maxHeight = "none";
    measure.style.overflow = "visible";
    composerForm.append(measure);
    setComposerStacked(measure.scrollHeight > singleLineHeight + 3);
    measure.remove();
  };
  const scheduleComposerMeasure = () => {
    globalThis.cancelAnimationFrame(composerMeasureFrame);
    composerMeasureFrame = globalThis.requestAnimationFrame(measureComposer);
  };
  onMount(() => {
    const observer = new globalThis.ResizeObserver(scheduleComposerMeasure);
    observer.observe(composerForm);
    const controls = composerForm.querySelector(".composer-bottom");
    if (controls) observer.observe(controls);
    scheduleComposerMeasure();
    onCleanup(() => {
      observer.disconnect();
      globalThis.cancelAnimationFrame(composerMeasureFrame);
    });
  });
  createEffect(() => {
    text();
    displayedModel();
    displayedEffort();
    scheduleComposerMeasure();
  });
  async function restoreFailedMessage(item: Transcript["commands"][number]) {
    if (
      text().trim() &&
      !(await confirmAction("Replace the current draft?", {
        message:
          "The message that failed will replace the text in the composer.",
        confirmLabel: "Restore message",
      }))
    ) {
      return;
    }
    changeText(item.payload.text);
    setEdit(item.payload.edit);
    const attachments = item.payload.attachments ?? [];
    setUploads(attachments);
    void draftAttachments(props.conversation, attachments);
    dismissError(item._id);
    input?.focus();
  }
  async function retryConfirmedModel(item: Transcript["commands"][number]) {
    if (!item.payload.model || item.status !== "error" || !connected()) return;
    if (
      !(await confirmAction("Switch model and send?", {
        message:
          item.error ?? "Hermes needs confirmation for this model change.",
        confirmLabel: "Switch and send",
      }))
    ) {
      return;
    }
    await enqueueCommand("send", item.conversation, {
      ...item.payload,
      model: { ...item.payload.model, confirmed: true },
    });
    dismissError(item._id);
  }
  let submission: { signature: string; id: string } | undefined;
  let submitPending = false;
  async function send() {
    if (
      !text().trim() ||
      sending() ||
      pendingUploads().some((item) => !item.error)
    ) {
      return;
    }
    const value = text();
    const originalKey = props.conversation;
    const focusOwner = globalThis.document.activeElement;
    const composerHadFocus =
      focusOwner instanceof globalThis.HTMLElement &&
      focusOwner.closest(".composer-input") !== null;
    let key = originalKey;
    setSending(true);
    try {
      // The composer selection follows the user across conversations. Hermes
      // applies it only when a session's current model differs.
      const modelSelection = selectedModel();
      const effort = rememberedEffort();
      const payload = {
        text: value,
        ...(modelSelection
          ? { model: { ...modelSelection, ...(effort ? { effort } : {}) } }
          : {}),
        attachments: uploads().filter((file) =>
          value.includes(`[Attached file: ${file.path}]`),
        ),
        ...(edit() ? { edit: edit() } : {}),
      };
      if (!key) {
        const created = await command("create", "", {
          profile: props.profile ?? "default",
        });
        key = String(created.key);
        // Preserve the unsent draft if submitting to the new session fails.
        await draft(key, value);
        await draftAttachments(key, uploads());
        saveDraft(profileOf(key), key, value);
        saveDraft(profileOf(""), "", "");
        for (const params of draftConfig.values()) {
          const result = await command("rpc", key, {
            method: "config.set",
            params,
          });
          if (result.confirm_required) {
            if (
              !(await confirmAction("Switch model?", {
                message: String(result.confirm_message || "Use this model?"),
                confirmLabel: "Switch model",
              }))
            ) {
              props.navigate(key);
              return;
            }
            await command("rpc", key, {
              method: "config.set",
              params: { ...params, confirm_expensive_model: true },
            });
            if (params.key === "model" && payload.model) {
              payload.model.confirmed = true;
              await mutate("workspace.setting", {
                key: "chatModel",
                value: payload.model,
              });
            }
          }
        }
        draftConfig.clear();
      }
      const signature = JSON.stringify([key, payload]);
      if (submission?.signature !== signature) {
        submission = { signature, id: crypto.randomUUID() };
      }
      if (
        originalKey &&
        !payload.edit &&
        !value.trimStart().startsWith("/") &&
        turn()?.state !== "running"
      ) {
        setPendingPrompt({
          id: submission.id,
          key,
          text: value,
          previousIds: new Set(messages().map((message) => message.id)),
        });
        if (!awayFromBottom()) requestAnimationFrame(scrollToLatest);
      }
      await enqueueCommand("send", key, payload, submission.id);
      submission = undefined;
      if (!originalKey) {
        await draft("", "");
        await draftAttachments("", []);
        await draft(key, "");
        await draftAttachments(key, []);
        saveDraft(profileOf(""), "", "");
        saveDraft(profileOf(key), key, "");
        props.navigate(key);
        if (composerHadFocus) {
          globalThis.requestAnimationFrame(() =>
            globalThis.document
              .querySelector<HTMLElement>('[aria-label="Message Hermes"]')
              ?.focus(),
          );
        }
      }
      // Acceptance into the durable queue is enough to compose the next turn.
      // Never erase newer text typed while the request was in flight.
      if (
        props.conversation === key &&
        text() === value &&
        edit() === payload.edit
      ) {
        changeText("");
        setEdit(undefined);
        setUploads([]);
        await draftAttachments(key, []);
      } else if (props.conversation !== key && (await draft(key)) === value) {
        await draft(key, "");
        await draftAttachments(key, []);
        saveDraft(profileOf(key), key, "");
      }
    } catch (error) {
      setPendingPrompt(undefined);
      if (!originalKey && key) props.navigate(key);
      throw error;
    } finally {
      setSending(false);
      if (
        composerHadFocus &&
        props.conversation === key &&
        globalThis.document.activeElement === focusOwner
      ) {
        input?.focus();
      }
    }
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    const key = props.conversation;
    for (const file of files) {
      const uploadId = crypto.randomUUID();
      setPendingUploads((items) => [...items, { id: uploadId, file }]);
      try {
        const body = new FormData();
        body.append("file", file);
        const profile = key ? JSON.parse(key)[0] : (props.profile ?? "default");
        const r = await fetch(
          `/api/upload?profile=${encodeURIComponent(profile)}`,
          { method: "POST", body },
        );
        const result = await r.json();
        if (!r.ok) throw new Error(result.error ?? "Upload failed");
        const path =
          result.path ?? result.file?.path ?? result.files?.[0]?.path;
        if (!path) {
          throw new Error("Hermes did not return an uploaded file reference");
        }
        const attachments = [
          ...(await draftAttachments(key)),
          { path, name: file.name, image: file.type.startsWith("image/") },
        ];
        await draftAttachments(key, attachments);
        const value =
          (props.conversation === key ? text() : ((await draft(key)) ?? "")) +
          `\n[Attached file: ${path}]\n`;
        if (props.conversation === key) {
          setUploads(attachments);
          changeText(value);
        } else writeDraft(key, value);
        setPendingUploads((items) =>
          items.filter((item) => item.id !== uploadId),
        );
      } catch (error) {
        setPendingUploads((items) =>
          items.map((item) =>
            item.id === uploadId
              ? {
                  ...item,
                  error:
                    error instanceof Error ? error.message : "Upload failed",
                }
              : item,
          ),
        );
      }
    }
  }
  function sessionRpc(method: string, params: Record<string, unknown>) {
    const key = props.conversation;
    if (!key) {
      draftConfig.set(String(params.key), params);
      return Promise.resolve({} as Record<string, unknown>);
    }
    return command("rpc", key, { method, params });
  }
  const rpc = (method: string, params: Record<string, unknown> = {}) =>
    rpcQueries.has(method)
      ? request("/api/query", {
          method,
          params,
          conversation: props.conversation,
        })
      : command("rpc", props.conversation, { method, params });
  createEffect(() => {
    const value = text(),
      position = cursor();
    const match = value.slice(0, position).match(/(?:^|\s)(\/[\w-]*)$/);
    const online = connected();
    setCompletions([]);
    setCompletionIndex(0);
    if (!match || !online) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void rpc("complete.slash", { text: match[1] })
        .then((result) => {
          if (!disposed) {
            setCompletions(
              (result.items ?? [])
                .filter(
                  (item: { text: string; kind?: string }) =>
                    !excludedCommand(item.text) &&
                    (position === match[1].length || item.kind === "skill"),
                )
                .slice(0, 8),
            );
          }
        })
        .catch(() => {
          /* Completion is optional; the composer stays usable. */
        });
    }, 150);
    onCleanup(() => {
      disposed = true;
      clearTimeout(timer);
    });
  });
  function chooseCompletion(index: number) {
    const item = completions()[index],
      position = cursor();
    const match = text()
      .slice(0, position)
      .match(/\/[\w-]*$/);
    if (!item || !match) return;
    input.replaceRange(position - match[0].length, position, `${item.text} `);
    setCompletions([]);
  }
  type MessageGroup = ReturnType<typeof groupMessages>[number];
  let previousConversation = props.conversation;
  let previousGroups = new Map<string, MessageGroup>();
  const groups = createMemo(() => {
    if (previousConversation !== props.conversation) {
      previousConversation = props.conversation;
      previousGroups = new Map();
    }
    const nextGroups = new Map<string, MessageGroup>();
    const result = groupMessages(messages()).map((group, index) => {
      const key =
        group.prompt?.id ??
        group.event?.id ??
        group.work[0]?.id ??
        String(index);
      const previous = previousGroups.get(key);
      const stable =
        previous &&
        previous.prompt === group.prompt &&
        previous.answer === group.answer &&
        previous.event === group.event &&
        previous.work.length === group.work.length &&
        previous.work.every((message, index) => message === group.work[index])
          ? previous
          : group;
      nextGroups.set(key, stable);
      return stable;
    });
    previousGroups = nextGroups;
    return result;
  });
  let groupContainer!: HTMLDivElement;
  const loadedMinimapItems = createMemo<TurnMinimapItem[]>(() =>
    groups().flatMap((group) =>
      group.prompt
        ? [
            {
              id: group.prompt.id,
              prompt: userMessageText(group.prompt.text)
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 300),
              answer: (group.answer?.text ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 300),
            },
          ]
        : [],
    ),
  );
  const [historyIndex, setHistoryIndex] = createSignal<{
    key: string;
    revision: string;
    items: HistoryIndexItem[];
  }>();
  const [indexFailed, setIndexFailed] = createSignal(false);
  const [pendingJump, setPendingJump] = createSignal<string>();
  const headRevision = createMemo(() => {
    const head = historyPages().find((page) => page.offset === 0);
    return head ? `${head.revision}:${head.hasMore}` : "";
  });
  const headHasMore = createMemo(
    () => historyPages().find((page) => page.offset === 0)?.hasMore ?? false,
  );
  createEffect(() => {
    const key = props.conversation;
    const revision = headRevision();
    if (!key || !headHasMore()) return;
    const cached = historyIndexCache.get(key);
    if (cached?.revision === revision) {
      setHistoryIndex({ key, ...cached });
      return;
    }
    setIndexFailed(false);
    const controller = new globalThis.AbortController();
    void globalThis
      .fetch(`/api/history-index?conversation=${encodeURIComponent(key)}`, {
        signal: controller.signal,
      })
      .then(async (response) => {
        if (!response.ok) throw new Error("History index unavailable");
        return (await response.json()) as { items: HistoryIndexItem[] };
      })
      .then(({ items }) => {
        if (props.conversation === key && headRevision() === revision) {
          historyIndexCache.delete(key);
          historyIndexCache.set(key, { revision, items });
          if (historyIndexCache.size > 20) {
            const oldest = historyIndexCache.keys().next().value;
            if (oldest) historyIndexCache.delete(oldest);
          }
          setHistoryIndex({ key, revision, items });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && props.conversation === key) {
          setIndexFailed(true);
        }
      });
    onCleanup(() => controller.abort());
  });
  const minimapItems = createMemo<TurnMinimapItem[]>(() => {
    const loaded = loadedMinimapItems();
    const head = historyPages().find((page) => page.offset === 0);
    if (!head?.hasMore) return loaded;
    const index = historyIndex();
    if (
      index?.key !== props.conversation ||
      index.revision !== headRevision()
    ) {
      return indexFailed() ? loaded : [];
    }
    const visible = new Map(loaded.map((item) => [item.id, item]));
    const known = new Set(index.items.map((item) => item.id));
    return [
      ...index.items.map((item) => ({ ...item, ...visible.get(item.id) })),
      ...loaded.filter((item) => !known.has(item.id)),
    ];
  });
  const [currentTurnIndex, setCurrentTurnIndex] = createSignal(0);
  let minimapFrame: number | undefined;
  const updateMinimap = () => {
    const items = minimapItems();
    if (!items.length || !scroller || !transcriptInner) return;
    if (
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
      40
    ) {
      setCurrentTurnIndex(items.length - 1);
      return;
    }
    const rows = groupContainer?.children;
    if (!rows?.length) return;
    const boundary =
      scroller.getBoundingClientRect().top +
      Math.min(90, scroller.clientHeight * 0.28);
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (
        (rows[middle] as HTMLElement).getBoundingClientRect().top <= boundary
      ) {
        low = middle + 1;
      } else high = middle;
    }
    const groupIndex = Math.max(0, low - 1);
    const prompt = groups()
      .slice(0, groupIndex + 1)
      .findLast((group) => group.prompt)?.prompt;
    const index = items.findIndex((item) => item.id === prompt?.id);
    if (index >= 0) setCurrentTurnIndex(index);
  };
  const scheduleMinimapUpdate = () => {
    if (minimapFrame !== undefined) return;
    minimapFrame = requestAnimationFrame(() => {
      minimapFrame = undefined;
      updateMinimap();
    });
  };
  const jumpToTurn = (item: TurnMinimapItem, index: number) => {
    const groupIndex = groups().findIndex(
      (group) => group.prompt?.id === item.id,
    );
    if (groupIndex < 0) {
      const offset = item.offset;
      if (offset !== undefined) {
        setPendingJump(item.id);
        setHistoryLoading(true);
        setPages((count) => Math.max(count, Math.floor(offset / 100) + 1));
      }
      return;
    }
    userScroll();
    setCurrentTurnIndex(index);
    setAwayFromBottom(true);
    const target = groupContainer?.children[groupIndex] as
      | HTMLElement
      | undefined;
    if (!target) return;
    const align = () => {
      scroller.scrollTop +=
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        8;
    };
    align();
    const intent = scrollIntent;
    requestAnimationFrame(() => {
      if (intent === scrollIntent) align();
    });
  };
  createEffect(() => {
    const id = pendingJump();
    if (!id || !groups().some((group) => group.prompt?.id === id)) return;
    const index = minimapItems().findIndex((item) => item.id === id);
    if (index < 0) return;
    const item = minimapItems()[index];
    setPendingJump(undefined);
    requestAnimationFrame(() => jumpToTurn(item, index));
  });
  createEffect(() => {
    minimapItems();
    scheduleMinimapUpdate();
  });
  onMount(() => {
    const observer = new globalThis.ResizeObserver(scheduleMinimapUpdate);
    observer.observe(scroller);
    observer.observe(transcriptInner);
    scheduleMinimapUpdate();
    onCleanup(() => {
      observer.disconnect();
      if (minimapFrame !== undefined) cancelAnimationFrame(minimapFrame);
    });
  });
  const settledHistoryGroup = createMemo(() => {
    const current = turn();
    return current && current.state !== "running"
      ? workGroup(groups(), current)
      : undefined;
  });
  const turnIsInHistory = () => Boolean(settledHistoryGroup());
  const historyOwnsWork = () => Boolean(settledHistoryGroup());
  const liveWorkGroup = createMemo(() => {
    const current = turn();
    return current ? workGroup(groups(), current) : undefined;
  });
  const pendingHistoryGroup = createMemo(() => {
    const current = turn();
    return current &&
      current.state !== "running" &&
      !settledHistoryGroup() &&
      current.text
      ? workGroup(groups(), { ...current, state: "running" })
      : undefined;
  });
  const renderActivity = (activity: Turn["activity"][number]) => (
    <div class="activity">
      <Icon
        name={
          activity.state === "complete"
            ? "check"
            : activity.state === "error"
              ? "xmark"
              : "clock"
        }
      />
      {activity.label}
    </div>
  );
  // The elapsed summary anchors inside a history group only once the agent
  // has produced something; before that the live article carries it, so a
  // fresh turn never renders as a blank gap.
  const hasTurnOutput = () => Boolean(turn()?.text || turn()?.activity.length);
  const showOutputStats = (
    group?: ReturnType<typeof groupMessages>[number],
    live?: Turn,
  ) => {
    if (live) {
      setStatsView({
        startedAt: live.startedAt,
        finishedAt: live.finishedAt,
        stats: live.stats,
      });
      return;
    }
    const promptAt = group?.prompt?.createdAt ?? 0;
    const answerAt = group?.answer?.createdAt;
    setStatsView({ startedAt: promptAt, finishedAt: answerAt, loading: true });
    if (!client) {
      setStatsView({ startedAt: promptAt, finishedAt: answerAt });
      return;
    }
    void client
      .query(refs.workspace.outputStats, {
        conversation: props.conversation,
        after: Math.max(0, promptAt - 60_000),
        before: (answerAt ?? Date.now()) + 60_000,
      })
      .then((rows) => {
        const answer = group?.answer;
        const match =
          rows.findLast(
            (row: { answerId?: string; answerText: string }) =>
              row.answerId && row.answerId === answer?.id,
          ) ??
          rows.findLast((row: { answerText: string }) =>
            Boolean(
              answer?.text &&
                row.answerText &&
                answer.text.startsWith(row.answerText),
            ),
          );
        setStatsView((current) =>
          current?.startedAt === promptAt
            ? {
                startedAt: match?.startedAt ?? promptAt,
                finishedAt: match?.data?.milestones?.at(-1)?.at ?? answerAt,
                stats: match?.data as TurnStats | undefined,
              }
            : current,
        );
      })
      .catch(() => {
        setStatsView((current) =>
          current?.startedAt === promptAt
            ? { startedAt: promptAt, finishedAt: answerAt }
            : current,
        );
      });
  };
  const statsButton = (onClick: () => void) => (
    <button
      type="button"
      class="output-stats-button"
      aria-label="Output stats"
      title="Output stats"
      onClick={onClick}
    >
      <Icon name="stats-down-square" />
    </button>
  );
  const secondsFromStart = (at: number, start: number) =>
    `${Math.max(0, (at - start) / 1000).toFixed(1)}s`;
  const renderLiveWork = (t: Turn) => (
    <Show when={!historyOwnsWork()}>
      <div class="work-summary-row">
        <Show
          when={t.activity.length}
          fallback={
            <div class="work-summary work-summary-static">
              {t.state === "running" ? "Working" : "Worked"} for{" "}
              {elapsed(t.startedAt, t.finishedAt ?? clock())}
            </div>
          }
        >
          <details
            class="work-summary"
            open={workExpanded(`${props.conversation}:live:${t.startedAt}`)}
            onToggle={(event) =>
              setWorkExpanded(
                `${props.conversation}:live:${t.startedAt}`,
                event.currentTarget.open,
              )
            }
          >
            <summary>
              {t.state === "running" ? "Working" : "Worked"} for{" "}
              {elapsed(t.startedAt, t.finishedAt ?? clock())}
              <span class="activity-count">
                {" "}
                · {t.activity.length} tool{" "}
                {t.activity.length === 1 ? "call" : "calls"}
              </span>
              <Icon name="nav-arrow-down" />
            </summary>
            <Show
              when={workExpanded(`${props.conversation}:live:${t.startedAt}`)}
            >
              <For each={t.activity}>{renderActivity}</For>
            </Show>
          </details>
        </Show>
        {statsButton(() => showOutputStats(undefined, t))}
      </div>
    </Show>
  );
  const renderMessage = (message: Message) => (
    <article class={`message ${message.role}`} data-message-id={message.id}>
      <Show
        when={message.role !== "tool"}
        fallback={
          <details class="past-tool">
            <summary>
              {
                toolPresentation(
                  message.tool ?? "Tool result",
                  record(message.details).input,
                ).label
              }
              <Icon name="nav-arrow-down" />
            </summary>
            <div class="tool-payload">
              <pre>
                {JSON.stringify(message.details ?? message.text, null, 2)}
              </pre>
            </div>
          </details>
        }
      >
        <div class="message-attachments">
          <For each={message.attachments ?? []}>
            {(attachment) => (
              <a
                href={attachmentHref(attachment.url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Show when={!/^https?:/i.test(attachment.url)}>
                  <img
                    src={attachmentHref(attachment.url)}
                    alt={attachment.name}
                    loading="lazy"
                  />
                </Show>
                {attachment.name}
              </a>
            )}
          </For>
          <For
            each={
              message.role === "user"
                ? Array.from(message.text.matchAll(referencePattern))
                : []
            }
          >
            {(match) =>
              match[1] === "folder" ? (
                <span class="context-reference">
                  <Icon name="folder" />
                  {referenceValue(match[0])}
                </span>
              ) : (
                <a
                  class="context-reference"
                  href={
                    ["session", "folder"].includes(match[1])
                      ? "#"
                      : attachmentHref(referenceValue(match[0]))
                  }
                  target={match[1] === "session" ? undefined : "_blank"}
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    if (match[1] !== "session") return;
                    event.preventDefault();
                    const [profile, ...id] = referenceValue(match[0]).split(
                      "/",
                    );
                    props.navigate(JSON.stringify([profile, id.join("/")]));
                  }}
                >
                  <Icon
                    name={
                      match[1] === "session"
                        ? "message-text"
                        : match[1] === "folder"
                          ? "folder"
                          : "attachment"
                    }
                  />
                  {referenceValue(match[0])}
                </a>
              )
            }
          </For>
        </div>
        <Show
          when={message.role === "assistant"}
          fallback={
            <Markdown
              text={
                message.role === "user"
                  ? userMessageText(message.text)
                      .replace(referencePattern, "")
                      .trim()
                  : message.text
              }
            />
          }
        >
          <AnswerMarkdown text={message.text} />
        </Show>
        <div class="message-actions">
          <IconButton
            icon="page"
            label="Copy message"
            onClick={() =>
              void run(() =>
                navigator.clipboard.writeText(
                  message.role === "user"
                    ? userMessageText(message.text)
                    : message.text,
                ),
              )
            }
          />
          <Show when={message.role === "user" && !message.compacted}>
            <IconButton
              icon="edit-pencil"
              label="Edit and resubmit"
              onClick={() => {
                setPendingPrompt(undefined);
                setEdit(message.id);
                changeText(
                  [
                    userMessageText(message.text),
                    ...(message.attachments ?? []).map((attachment) =>
                      contextReference("image", attachment.url),
                    ),
                  ]
                    .filter(Boolean)
                    .join("\n"),
                );
                input.focus();
              }}
            />
            <IconButton
              icon="git-fork"
              label="Branch conversation"
              onClick={() =>
                void run(async () => {
                  const result = await command("branch", props.conversation, {
                    messageId: message.id,
                  });
                  inform("Conversation branched");
                  props.navigate(String(result.key));
                })
              }
            />
          </Show>
        </div>
      </Show>
    </article>
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Drag and drop supplements the keyboard-accessible file picker.
    <div
      class="conversation"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void run(() => upload(e.dataTransfer?.files ?? null));
      }}
    >
      <div class="transcript-shell">
        <section
          class="transcript"
          aria-label="Conversation history"
          ref={scroller}
          onWheel={(event) => {
            if (event.deltaY < 0 || awayFromBottom()) userScroll();
          }}
          onTouchStart={(event) => {
            touchStartY = event.touches[0]?.clientY;
          }}
          onTouchMove={(event) => {
            const y = event.touches[0]?.clientY;
            if (
              y !== undefined &&
              touchStartY !== undefined &&
              Math.abs(y - touchStartY) > 6
            ) {
              userScroll();
              touchStartY = undefined;
            }
          }}
          onTouchEnd={() => (touchStartY = undefined)}
          onPointerDown={(event) => {
            // A click in the transcript is not a request to stop following.
            // Thumb dragging is, even on browsers that do not emit wheel events.
            if (event.clientX >= scroller.getBoundingClientRect().right - 18) {
              userScroll();
            }
          }}
          onKeyDown={userScroll}
          onScroll={() => {
            scheduleMinimapUpdate();
            if (scrollFrame === undefined) {
              const farFromBottom =
                scroller.scrollHeight -
                  scroller.scrollTop -
                  scroller.clientHeight >
                40;
              if (!farFromBottom) {
                readingHistory = false;
                setAwayFromBottom(false);
              } else if (readingHistory) setAwayFromBottom(true);
              if (!needsInitialScroll) maybeLoadEarlier();
            }
          }}
        >
          <Show when={!props.conversation}>
            <div class="new-session-welcome">
              <h1>HERMES</h1>
              <p>Your personal AI assistant.</p>
            </div>
          </Show>
          <div
            class="transcript-inner"
            ref={transcriptInner}
            style={{ visibility: initializing() ? "hidden" : "visible" }}
          >
            <div class="transcript-groups" ref={groupContainer}>
              <For each={groups()}>
                {(group) => (
                  <div class="transcript-group">
                    <Show when={group.event}>
                      <p class="timeline-event" role="status">
                        {group.event?.text}
                      </p>
                    </Show>
                    <Show when={group.prompt}>
                      {(message) => renderMessage(message())}
                    </Show>
                    <Show
                      when={
                        group === liveWorkGroup() && hasTurnOutput() && turn()
                      }
                    >
                      {(t) => renderLiveWork(t())}
                    </Show>
                    <Show
                      when={
                        ((group.prompt && group.answer) ||
                          (group.work.length &&
                            (!turn() || group !== groups().at(-1)))) &&
                        group !== pendingHistoryGroup() &&
                        !(
                          turn()?.state === "running" &&
                          group === liveWorkGroup()
                        )
                      }
                    >
                      <div class="work-summary-row">
                        <details
                          class="work-summary history-work"
                          open={workExpanded(workKey(group))}
                          onToggle={(event) =>
                            setWorkExpanded(
                              workKey(group),
                              event.currentTarget.open,
                            )
                          }
                        >
                          <summary>
                            Worked
                            <Show
                              when={
                                group === settledHistoryGroup() ||
                                (group.prompt?.createdAt &&
                                  group.answer?.createdAt)
                              }
                            >
                              {" "}
                              for{" "}
                              {elapsed(
                                group === settledHistoryGroup()
                                  ? (turn()?.startedAt ?? 0)
                                  : (group.prompt?.createdAt ?? 0),
                                group === settledHistoryGroup()
                                  ? (turn()?.finishedAt ?? clock())
                                  : (group.answer?.createdAt ?? 0),
                              )}
                            </Show>
                            <Icon name="nav-arrow-down" />
                          </summary>
                          <Show when={workExpanded(workKey(group))}>
                            <For each={group.work}>{renderMessage}</For>
                            <Show when={group === settledHistoryGroup()}>
                              <For
                                each={turn()?.activity.filter(
                                  (activity) =>
                                    !group.work.some(
                                      (message) =>
                                        message.toolCallId === activity.id ||
                                        message.tool === activity.label,
                                    ),
                                )}
                              >
                                {renderActivity}
                              </For>
                            </Show>
                          </Show>
                        </details>
                        {statsButton(() =>
                          showOutputStats(
                            group,
                            group === settledHistoryGroup()
                              ? (turn() ?? undefined)
                              : undefined,
                          ),
                        )}
                      </div>
                    </Show>
                    <Show
                      when={
                        group === pendingHistoryGroup() ||
                        (turn()?.state === "running" &&
                          group === liveWorkGroup())
                          ? undefined
                          : group.answer
                      }
                    >
                      {(message) => renderMessage(message())}
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <Show when={visiblePendingPrompt()}>
              {(pending) => (
                <article class="message user pending-prompt" role="status">
                  <Markdown text={userMessageText(pending().text)} />
                  <small>Sending…</small>
                </article>
              )}
            </Show>
            <Show when={thinking()}>
              <article class="message assistant">
                <p class="thinking-label" role="status">
                  Thinking…
                </p>
              </article>
            </Show>
            <Show when={turn()}>
              {(t) => (
                <article
                  class="message assistant live-message"
                  hidden={
                    (historyOwnsWork() ||
                      (t().state !== "running" &&
                        turnIsInHistory() &&
                        !t().activity.length)) &&
                    !t().error &&
                    !t().recovering &&
                    !t().interactions.length
                  }
                  classList={{
                    "settled-work":
                      t().state !== "running" && turnIsInHistory(),
                  }}
                >
                  <Show when={t().recovering}>
                    <p class="subtitle" role="status">
                      Recovering live progress from Hermes…
                    </p>
                  </Show>
                  <Show when={!liveWorkGroup() || !hasTurnOutput()}>
                    {renderLiveWork(t())}
                  </Show>
                  <Show
                    when={
                      t().text &&
                      (t().state === "running" || !turnIsInHistory())
                    }
                  >
                    <AnswerMarkdown text={t().text} />
                  </Show>
                  <Show
                    when={
                      t().state === "running" &&
                      t().activity.findLast((a) => a.state === "running")
                    }
                  >
                    {(activity) => (
                      <div class="current-activity" role="status">
                        <Icon name="clock" />
                        {activity().label}
                      </div>
                    )}
                  </Show>
                  <For each={t().interactions.map((item) => item.id)}>
                    {(id) => {
                      const interaction = () =>
                        t().interactions.find((item) => item.id === id);
                      return (
                        <Show when={interaction()}>
                          {(i) => (
                            <div class="interaction">
                              <h3>
                                {i().kind === "approval"
                                  ? "Approval needed"
                                  : i().kind === "secret"
                                    ? "Input needed"
                                    : "A question from Hermes"}
                              </h3>
                              <p>{i().text}</p>
                              <Show
                                when={i().kind === "approval"}
                                fallback={
                                  <Show
                                    when={i().kind === "clarify"}
                                    fallback={
                                      <form
                                        onSubmit={(e) => {
                                          e.preventDefault();
                                          const value = new FormData(
                                            e.currentTarget,
                                          ).get("answer");
                                          e.currentTarget.reset();
                                          void run(() =>
                                            request("/api/respond", {
                                              conversation: props.conversation,
                                              requestId: i().id,
                                              value,
                                            }),
                                          );
                                        }}
                                      >
                                        <input
                                          name="answer"
                                          aria-label="Secret or verification code"
                                          type="password"
                                          autocomplete="off"
                                          required
                                        />
                                        <button type="submit" class="primary">
                                          Answer
                                        </button>
                                      </form>
                                    }
                                  >
                                    <Clarification
                                      interaction={i()}
                                      respond={(params) =>
                                        rpc("clarify.respond", params)
                                      }
                                    />
                                  </Show>
                                }
                              >
                                <button
                                  type="button"
                                  class="primary"
                                  onClick={() =>
                                    void run(() =>
                                      rpc("approval.respond", {
                                        request_id: i().id,
                                        choice: "once",
                                      }),
                                    )
                                  }
                                >
                                  Allow once
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void run(() =>
                                      rpc("approval.respond", {
                                        request_id: i().id,
                                        choice: "deny",
                                      }),
                                    )
                                  }
                                >
                                  Deny
                                </button>
                              </Show>
                            </div>
                          )}
                        </Show>
                      );
                    }}
                  </For>
                </article>
              )}
            </Show>
            <For
              each={activity().commands.filter(
                (c) =>
                  c.status === "complete" &&
                  c.kind === "send" &&
                  c.result?.output,
              )}
            >
              {(c) => (
                <article class="message assistant">
                  <div class="message-label">Command result</div>
                  <Markdown text={c.result.output} />
                </article>
              )}
            </For>
          </div>
        </section>
        <TurnMinimap
          items={minimapItems()}
          currentIndex={currentTurnIndex()}
          select={jumpToTurn}
          jumpToLatest={scrollToLatest}
          showJumpToLatest={awayFromBottom()}
        />
      </div>
      <div class="compose-area">
        <Show when={historyFailure()}>
          <div class="history-error chat-issue" role="alert">
            <span>Conversation history may be out of date.</span>
            <button
              type="button"
              disabled={!connected()}
              onClick={() => setHistoryRetry((value) => value + 1)}
            >
              Retry history
            </button>
          </div>
        </Show>
        <Show when={turn()?.error && !errorDismissed(turnErrorId(turn()!))}>
          <div class="chat-issue" role="alert">
            <strong>Hermes stopped this turn.</strong>
            <details>
              <summary>Details</summary>
              <p>{turn()?.error}</p>
            </details>
            <IconButton
              icon="xmark"
              label="Dismiss error"
              onClick={() => turn() && dismissError(turnErrorId(turn()!))}
            />
          </div>
        </Show>
        <Show when={commandIssues()[0]}>
          {(c) => (
            <div class="command-error chat-issue" role="alert">
              <strong>
                {c().result?.confirmRequired
                  ? "Model switch needs confirmation"
                  : c().kind === "send"
                    ? c().status === "unknown"
                      ? "Message delivery is uncertain"
                      : c().payload.edit
                        ? "Edit was not sent"
                        : "Message was not sent"
                    : "Action failed"}
              </strong>
              <Show
                when={
                  c().payload.edit &&
                  c().error?.includes(
                    "target user message is no longer in session history",
                  )
                }
              >
                <small>
                  Hermes could not match the message selected for editing.
                  Restore your text, then refresh the conversation before trying
                  again.
                </small>
              </Show>
              <Show when={commandIssues().length > 1}>
                <small>{commandIssues().length} issues</small>
              </Show>
              <details>
                <summary>Details</summary>
                <p>{c().error}</p>
              </details>
              <Show
                when={c().result?.confirmRequired && c().status === "error"}
              >
                <button
                  type="button"
                  disabled={!connected()}
                  onClick={() => void run(() => retryConfirmedModel(c()))}
                >
                  Confirm switch and send
                </button>
              </Show>
              <Show
                when={
                  c().kind === "send" &&
                  c().status === "error" &&
                  !c().result?.confirmRequired
                }
              >
                <button
                  type="button"
                  onClick={() => void run(() => restoreFailedMessage(c()))}
                >
                  Restore message to composer
                </button>
              </Show>
              <IconButton
                icon="xmark"
                label="Dismiss error"
                onClick={() => dismissError(c()._id)}
              />
            </div>
          )}
        </Show>
        <div class="composer-attachments">
          <For each={pendingUploads()}>
            {(item) => (
              <div role="status">
                {item.file.name} · {item.error ?? "Uploading…"}
                <Show when={item.error}>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingUploads((items) =>
                        items.filter((entry) => entry.id !== item.id),
                      );
                      const transfer = new DataTransfer();
                      transfer.items.add(item.file);
                      void upload(transfer.files);
                    }}
                  >
                    Retry upload
                  </button>
                  <IconButton
                    icon="xmark"
                    label={`Dismiss ${item.file.name}`}
                    onClick={() =>
                      setPendingUploads((items) =>
                        items.filter((entry) => entry.id !== item.id),
                      )
                    }
                  />
                </Show>
              </div>
            )}
          </For>
          <For
            each={uploads().filter((file) =>
              text().includes(`[Attached file: ${file.path}]`),
            )}
          >
            {(file) => (
              <div class="context-reference">
                <a
                  href={attachmentHref(file.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Show when={file.image}>
                    <img src={attachmentHref(file.path)} alt={file.name} />
                  </Show>
                  {file.name}
                </a>
                <IconButton
                  icon="xmark"
                  label={`Remove ${file.name}`}
                  onClick={() => {
                    changeText(
                      text().replace(`[Attached file: ${file.path}]`, ""),
                    );
                    const next = uploads().filter(
                      (item) => item.path !== file.path,
                    );
                    setUploads(next);
                    void draftAttachments(props.conversation, next);
                  }}
                />
              </div>
            )}
          </For>
        </div>
        <Show when={completions().length}>
          <div
            class="completion-list"
            role="listbox"
            id="composer-completions"
            aria-label="Commands and skills"
          >
            <For each={completions()}>
              {(item, index) => (
                <button
                  type="button"
                  role="option"
                  id={`completion-${index()}`}
                  aria-selected={completionIndex() === index()}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => chooseCompletion(index())}
                >
                  <strong>{item.display ?? item.text}</strong>
                  <small>{item.meta}</small>
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={queued().length}>
          <section class="queue-panel">
            <header>
              <button
                type="button"
                aria-expanded={queueOpen()}
                onClick={() => setQueueOpen((value) => !value)}
              >
                <Icon name="nav-arrow-down" />
                {queued().length} Queued{" "}
                {queued().length === 1 ? "Message" : "Messages"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void run(() =>
                    mutate("commands.clearQueue", {
                      conversation: props.conversation,
                    }),
                  )
                }
              >
                Clear All
              </button>
            </header>
            <Show when={queueOpen()}>
              <For each={queued()}>
                {(item, index) => (
                  <div class="queued-message">
                    <span
                      class="queue-dot"
                      classList={{ first: index() === 0 }}
                    />
                    <span class="queued-text">
                      {item.payload.text}
                      <Show when={item.error}>
                        <small role="status">{item.error}</small>
                      </Show>
                    </span>
                    <IconButton
                      icon="trash"
                      label="Delete queued message"
                      onClick={() =>
                        void run(() =>
                          mutate("commands.edit", {
                            id: item._id,
                            cancel: true,
                          }),
                        )
                      }
                    />
                    <IconButton
                      icon="edit-pencil"
                      label="Edit queued message"
                      onClick={() =>
                        void run(async () => {
                          const value = await ask(
                            "Queued message",
                            item.payload.text,
                            true,
                          );
                          if (value !== null) {
                            await mutate("commands.edit", {
                              id: item._id,
                              text: value,
                            });
                          }
                        })
                      }
                    />
                    <button
                      type="button"
                      class="send-now"
                      disabled={!connected()}
                      onClick={() => void run(() => sendNow(item._id))}
                    >
                      Send Now
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </section>
        </Show>
        <Show when={edit()}>
          <div class="editing">
            Editing an earlier message. Later conversation history will be
            replaced.{" "}
            <button
              type="button"
              onClick={() => {
                setEdit(undefined);
                changeText("");
              }}
            >
              Cancel
            </button>
          </div>
        </Show>
        <Suspense>
          <ContextSuggestions
            text={text()}
            profile={
              props.conversation
                ? JSON.parse(props.conversation)[0]
                : (props.profile ?? "default")
            }
            error={turn()?.error}
            useSkill={(name) => {
              changeText(`/${name} ${text()}`);
              input.focus();
            }}
            navigate={props.navigate}
          />
        </Suspense>
        <form
          ref={composerForm}
          class="composer"
          classList={{ stacked: composerStacked() }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitPending || sending()) return;
            submitPending = true;
            try {
              if (
                edit() &&
                (await rejectAction(
                  "Replace the conversation after this message? Files and external actions will not be undone.",
                ))
              )
                return;
              await run(send);
            } finally {
              submitPending = false;
            }
          }}
        >
          <div class="composer-entry">
            <ComposerInput
              ref={(handle) => {
                input = handle;
              }}
              context={`${props.conversation}:${edit() ?? ""}`}
              controls={
                completions().length ? "composer-completions" : undefined
              }
              activeDescendant={
                completions().length
                  ? `completion-${completionIndex()}`
                  : undefined
              }
              placeholder={
                connected() ? "Ask anything." : "NO CONNECTION TO GATEWAY…"
              }
              value={text()}
              onChange={changeText}
              onCursor={setCursor}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  e.metaKey &&
                  !e.ctrlKey &&
                  !e.altKey &&
                  !e.shiftKey &&
                  !e.isComposing
                ) {
                  e.preventDefault();
                  if (e.repeat) return;
                  if (text().trim()) {
                    (e.currentTarget as HTMLElement)
                      .closest("form")
                      ?.requestSubmit();
                  } else if (queued()[0]) {
                    void run(() => sendNow(queued()[0]._id));
                  }
                  return;
                }
                if (completions().length && !e.isComposing) {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setCompletions([]);
                    return;
                  }
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setCompletionIndex(
                      (i) =>
                        (i +
                          (e.key === "ArrowDown"
                            ? 1
                            : completions().length - 1)) %
                        completions().length,
                    );
                    return;
                  }
                  if (e.key === "Tab") {
                    e.preventDefault();
                    chooseCompletion(completionIndex());
                    return;
                  }
                }
              }}
              onPasteFiles={(files) => void run(() => upload(files))}
            />
            <button
              class="send mobile-send"
              type="submit"
              aria-label={
                turn()?.state === "running" ? "Queue message" : "Send message"
              }
              disabled={
                !text().trim() ||
                !connected() ||
                sending() ||
                pendingUploads().some((item) => !item.error)
              }
            >
              <Icon name="send" />
            </button>
          </div>
          <div class="composer-bottom">
            <div class="mobile-composer-navigation">
              <IconButton
                icon="menu"
                label="Open conversations"
                onClick={props.mobileActions.openNavigation}
              />
              <IconButton
                icon="search"
                label="Search conversations"
                onClick={props.mobileActions.openPalette}
              />
              <IconButton
                icon="plus"
                label="New conversation"
                onClick={props.mobileActions.newChat}
              />
            </div>
            <button
              type="button"
              class="text-button composer-model"
              ref={modelButton}
              aria-label="Model"
              aria-expanded={Boolean(model())}
              popovertarget="conversation-model-picker"
              disabled={modelLoading()}
              onClick={() => {
                // Native popover toggling exempts its invoker from light-dismiss,
                // so the same click cannot dismiss and reopen the picker.
                if (model() || modelLoading()) return;
                setModelLoading(true);
                void run(async () => {
                  const result = await rpc("model.options");
                  setCurrentProvider(String(result.provider ?? ""));
                  if (typeof result.model === "string") {
                    setCurrentModel(result.model);
                  }
                  setModels(
                    result.providers?.flatMap(
                      (provider: {
                        slug: string;
                        name: string;
                        models?: string[];
                        capabilities?: Record<
                          string,
                          ModelOption["capabilities"]
                        >;
                      }) =>
                        (provider.models ?? []).map((id: string) => ({
                          id,
                          provider: provider.slug,
                          name: id,
                          providerName: provider.name,
                          capabilities: provider.capabilities?.[id],
                        })),
                    ) ??
                      result.models ??
                      [],
                  );
                  setModel("choose");
                }).finally(() => setModelLoading(false));
              }}
            >
              {displayedModel() || "Select model"}
              {displayedEffort()
                ? ` · ${
                    displayedEffort() === "none" ? "Off" : displayedEffort()
                  }`
                : ""}
            </button>

            <IconButton
              icon="attachment"
              class="composer-add"
              label="Upload files"
              onClick={() => fileInput.click()}
            />
            <div>
              <Show when={turn()?.state === "running"}>
                <button
                  type="button"
                  class="text-button"
                  onClick={() => void run(() => rpc("session.interrupt"))}
                >
                  <Icon name="square" />
                  Stop
                </button>
              </Show>
              <button
                class="send desktop-send"
                type="submit"
                aria-label={
                  turn()?.state === "running" ? "Queue message" : "Send message"
                }
                disabled={
                  !text().trim() ||
                  !connected() ||
                  sending() ||
                  pendingUploads().some((item) => !item.error)
                }
              >
                <Icon name="send" />
              </button>
            </div>
          </div>
        </form>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const input = e.currentTarget;
            void run(async () => {
              try {
                await upload(input.files);
              } finally {
                input.value = "";
              }
            });
          }}
        />
      </div>
      <Show when={model()}>
        <ModelPicker
          anchor={modelButton}
          models={models()}
          current={displayedModel()}
          provider={selectedModel()?.provider ?? currentProvider()}
          effort={rememberedEffort() || currentEffort()}
          close={() => setModel("")}
          choose={async (m) => {
            // Hermes parses this as /model arguments, not JSON or shell quoting.
            const value = `${m.id ?? m.model ?? m}${
              m.provider ? ` --provider ${m.provider}` : ""
            } --session`;
            const result = await sessionRpc("config.set", {
              key: "model",
              value,
              scope: "session",
            });
            if (result.confirm_required) {
              if (
                !(await confirmAction(`Switch to ${modelLabel(m)}?`, {
                  message: String(result.confirm_message || "Use this model?"),
                  confirmLabel: "Switch model",
                }))
              ) {
                return;
              }
              await sessionRpc("config.set", {
                key: "model",
                value,
                scope: "session",
                confirm_expensive_model: true,
              });
            }
            setCurrentModel(modelLabel(m));
            setCurrentProvider(m.provider ?? "");
            const levels = reasoningLevels(
              m.provider ?? "",
              m.id ?? m.model ?? "",
              m.capabilities,
            );
            const remembered =
              workspace()?.settings.modelEfforts?.[modelKey(m)];
            // Models without a reported level reject a stale effort, so clear
            // it instead of sending the previous model's level. "none" parses
            // to disabled, which omits the wire field. Best-effort: the model
            // switch itself already succeeded.
            if (remembered && levels?.includes(remembered)) {
              await sessionRpc("config.set", {
                key: "reasoning",
                value: remembered,
                scope: "session",
              });
              setCurrentEffort(remembered);
            } else if (
              clearsStaleEffort(
                m.provider ?? "",
                m.id ?? m.model ?? "",
                m.capabilities,
              )
            ) {
              try {
                await sessionRpc("config.set", {
                  key: "reasoning",
                  value: "none",
                  scope: "session",
                });
                setCurrentEffort("none");
              } catch (error) {
                inform(
                  error instanceof Error
                    ? error.message
                    : "Could not clear reasoning effort",
                );
              }
            }
            await mutate("workspace.setting", {
              key: "chatModel",
              value: {
                value,
                label: modelLabel(m),
                provider: m.provider ?? "",
                confirmed: Boolean(result.confirm_required),
              },
            });
            setModel("");
          }}
          changeEffort={async (effort, selected) => {
            await sessionRpc("config.set", {
              key: "reasoning",
              value: effort,
              scope: "session",
            });
            setCurrentEffort(effort);
            await mutate("workspace.modelEffort", {
              model: modelKey(selected),
              effort,
            });
          }}
        />
      </Show>
      <Show when={statsView()}>
        {(view) => (
          <Dialog
            title="Output stats"
            class="output-stats-dialog"
            close={() => setStatsView(undefined)}
          >
            <Show when={!view().loading} fallback={<p>Loading timing…</p>}>
              <Show
                when={view().stats}
                fallback={
                  <p>Detailed timing was not recorded for this reply.</p>
                }
              >
                {(stats) => (
                  <>
                    <div class="output-stats-metrics">
                      <div>
                        <small>Time to first output</small>
                        <strong>
                          {stats().firstOutputAt
                            ? secondsFromStart(
                                stats().firstOutputAt!,
                                view().startedAt,
                              )
                            : "Unavailable"}
                        </strong>
                      </div>
                      <div>
                        <small>Tokens per second</small>
                        <strong>
                          {stats().tokensPerSecond !== undefined
                            ? stats().tokensPerSecond!.toFixed(1)
                            : "Unavailable"}
                        </strong>
                        <small>Recent model calls</small>
                      </div>
                    </div>
                    <h3>Timeline</h3>
                    <ol class="output-stats-timeline">
                      <For each={stats().milestones}>
                        {(item) => (
                          <li>
                            <time>
                              {secondsFromStart(item.at, view().startedAt)}
                            </time>
                            <span>{item.label}</span>
                          </li>
                        )}
                      </For>
                    </ol>
                    <small class="output-stats-note">
                      Times are measured when Arura receives Hermes events.
                    </small>
                  </>
                )}
              </Show>
            </Show>
          </Dialog>
        )}
      </Show>
    </div>
  );
}
