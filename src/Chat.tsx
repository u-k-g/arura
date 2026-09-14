import DOMPurify from "dompurify";
import { marked } from "marked";
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
import { fileReferences } from "../shared/artifacts.ts";
import {
  elapsed,
  groupMessages,
  type Message,
  type Turn,
} from "../shared/model.ts";
import { rpcQueries } from "../shared/resources.ts";
import { draft, draftAttachments, loadCache, saveCache } from "./cache.ts";
import {
  command,
  connected,
  inform,
  mutate,
  request,
  resource,
  subscribe,
  workspace,
} from "./client.ts";
import type { ControlView } from "./RunControls.tsx";
import { Dialog, Field, Icon, IconButton, run } from "./ui.tsx";

const RunControls = lazy(() => import("./RunControls.tsx"));
const Clarification = lazy(() => import("./Clarification.tsx"));

DOMPurify.addHook("beforeSanitizeAttributes", (node) => {
  if (node.nodeName !== "A") return;
  const element = node as Element,
    href = element.getAttribute("href");
  if (!href || /^https?:/i.test(href)) return;
  const file = fileReferences([
    { role: "assistant", content: `[file](<${href}>)` },
  ])[0];
  if (file) {
    element.setAttribute(
      "href",
      `/api/download?path=${encodeURIComponent(file.path)}`,
    );
  }
});
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});
function Markdown(props: { text: string }) {
  const html = () =>
    DOMPurify.sanitize(marked.parse(props.text, { async: false }) as string, {
      FORBID_TAGS: ["img", "iframe", "video", "audio", "object", "embed"],
      FORBID_ATTR: ["style"],
    });
  return <div class="markdown" innerHTML={html()} />;
}
const ContextSuggestions = lazy(() => import("./ContextSuggestions.tsx"));
export default function Chat(props: {
  conversation: string;
  title: string;
  navigate: (view: string) => void;
}) {
  const [data, setData] = createSignal<any>({
    pages: [],
    commands: [],
    turn: null,
  });
  const [text, setText] = createSignal(""),
    [sending, setSending] = createSignal(false),
    [pages, setPages] = createSignal(1);
  const [edit, setEdit] = createSignal<string>(),
    [controls, setControls] = createSignal<ControlView>();
  const [uploads, setUploads] = createSignal<
    { path: string; name: string; image: boolean }[]
  >([]);
  const [tool, setTool] = createSignal<Message>(),
    [models, setModels] = createSignal<any[]>([]),
    [model, setModel] = createSignal("");
  const [customizeModels, setCustomizeModels] = createSignal(false);
  const modelKey = (entry: any) =>
    JSON.stringify([entry.provider ?? "", entry.id ?? entry.model ?? entry]);
  const modelLabel = (entry: any) =>
    entry.name ?? entry.label ?? entry.id ?? String(entry);
  const hiddenModels = createMemo(
    () => new Set<string>(workspace()?.settings?.hiddenModels ?? []),
  );
  const visibleModels = () =>
    models().filter((entry) => !hiddenModels().has(modelKey(entry)));
  const [suggestions, setSuggestions] = createSignal<any[]>([]),
    [attachment, setAttachment] = createSignal(false),
    [reference, setReference] = createSignal("");
  const [completions, setCompletions] = createSignal<
    { text: string; display?: string; meta?: string; kind?: string }[]
  >([]);
  const [completionIndex, setCompletionIndex] = createSignal(0),
    [cursor, setCursor] = createSignal(0);
  const excludedCommand = (value: string) =>
    /^\/(?:image|imagine|flux|voice|wake|terminal|shell|hud|radio|pet|browser)(?:[-\s]|$)/i.test(
      value,
    );
  let scroller!: HTMLDivElement;
  let input!: HTMLTextAreaElement;
  let fileInput!: HTMLInputElement;
  const messages = () =>
    data()
      .pages.slice()
      .sort((a: any, b: any) => b.offset - a.offset)
      .flatMap((p: any) => p.messages) as Message[];
  const turn = () => data().turn as Turn | null;
  const turnIsInHistory = () => {
    const last =
        turn()?.state === "running"
          ? messages().at(-1)
          : messages().findLast((message) => message.role === "assistant"),
      live = turn()?.text.replace(/\s+/g, "");
    return Boolean(
      live &&
        last?.role === "assistant" &&
        last.text.replace(/\s+/g, "").startsWith(live),
    );
  };
  const [clock, setClock] = createSignal(Date.now());
  let transcriptRevision = 0;
  onMount(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    onCleanup(() => clearInterval(t));
  });
  createEffect(() => {
    const key = props.conversation;
    const revision = ++transcriptRevision;
    setData({ pages: [], commands: [], turn: null });
    setText("");
    setPages(1);
    setEdit(undefined);
    setUploads([]);
    void draftAttachments(key).then((value) => {
      if (props.conversation === key && uploads().length === 0) {
        setUploads(value);
      }
    });
    void draft(key).then((value) => {
      if (props.conversation === key && text() === "") setText(value ?? "");
    });
    void loadCache<any>("chat:" + key).then((value) => {
      if (
        value &&
        props.conversation === key &&
        transcriptRevision === revision
      ) {
        setData(value);
      }
    });
  });
  createEffect(() => {
    const key = props.conversation;
    const count = pages();
    connected();
    const requested = new Set<string>();
    const stop = subscribe(
      "workspace",
      "transcript",
      { conversation: key, pages: count },
      (value) => {
        transcriptRevision++;
        const nearBottom =
          !scroller ||
          scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
            180;
        setData(value);
        const head = value.pages.find((page: any) => page.offset === 0);
        for (let offset = 100; head && offset < count * 100; offset += 100) {
          const preceding = value.pages.find(
            (page: any) => page.offset === offset - 100,
          );
          const requestId = `${head.revision}:${offset}`;
          if (
            preceding?.hasMore &&
            !value.pages.some((page: any) => page.offset === offset) &&
            !requested.has(requestId) &&
            connected()
          ) {
            requested.add(requestId);
            void command("load", key, { offset }).catch((error) =>
              inform(error.message),
            );
          }
        }
        void saveCache("chat:" + key, value);
        if (nearBottom) {
          requestAnimationFrame(() =>
            scroller?.scrollTo({
              top: scroller.scrollHeight,
              behavior: "instant",
            }),
          );
        }
      },
    );
    onCleanup(stop);
    if (connected()) {
      void command("load", key, { offset: 0 }).catch((error) =>
        inform(error.message),
      );
    }
  });
  const changeText = (value: string) => {
    setText(value);
    void draft(props.conversation, value);
  };
  async function send() {
    if (!text().trim() || sending()) return;
    const value = text();
    const key = props.conversation;
    setSending(true);
    try {
      const result = command("send", key, {
        text: value,
        attachments: uploads(),
        ...(edit() ? { edit: edit() } : {}),
      });
      changeText("");
      setEdit(undefined);
      await result;
      await draftAttachments(key, []);
      if (props.conversation === key) setUploads([]);
    } catch (error) {
      if (props.conversation === key) changeText(value);
      else await draft(key, value);
      throw error;
    } finally {
      setSending(false);
      input?.focus();
    }
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    const key = props.conversation;
    for (const file of files) {
      const body = new FormData();
      body.append("file", file);
      const profile = JSON.parse(key)[0];
      const r = await fetch(
        `/api/upload?profile=${encodeURIComponent(profile)}`,
        { method: "POST", body },
      );
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? "Upload failed");
      const path = result.path ?? result.file?.path ?? result.files?.[0]?.path;
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
      } else await draft(key, value);
    }
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
    const prefix = text().slice(0, position - match[0].length);
    const next = `${prefix}${item.text} `;
    changeText(next + text().slice(position));
    setCompletions([]);
    input.focus();
    input.setSelectionRange(next.length, next.length);
    setCursor(next.length);
  }
  const groups = createMemo(() => groupMessages(messages()));
  const renderMessage = (message: Message) => (
    <article class={`message ${message.role}`}>
      <Show
        when={message.role !== "tool"}
        fallback={
          <details class="past-tool">
            <summary>{message.tool ?? "Tool result"}</summary>
            <button
              type="button"
              class="desktop-only text-button"
              onClick={() => setTool(message)}
            >
              Inspect result
            </button>
          </details>
        }
      >
        <div class="message-label">
          {message.role === "user" ? "You" : "Hermes"}
        </div>
        <Markdown text={message.text} />
        <div class="message-actions">
          <IconButton
            icon="page"
            label="Copy message"
            onClick={() =>
              void run(() => navigator.clipboard.writeText(message.text))
            }
          />
          <Show when={message.role === "user"}>
            <IconButton
              icon="edit-pencil"
              label="Edit and resubmit"
              onClick={() => {
                setEdit(message.id);
                changeText(message.text);
                input.focus();
              }}
            />
          </Show>
          <IconButton
            icon="chat-bubble"
            label="Branch conversation"
            onClick={() =>
              void run(async () => {
                const result = await command("branch", props.conversation, {
                  messageId: message.id,
                });
                inform("Conversation branched");
                props.navigate(result.key);
              })
            }
          />
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
      <div class="conversation-toolbar">
        <button
          type="button"
          class="text-button"
          onClick={() =>
            void run(async () => {
              const result = await rpc("model.options");
              setModels(
                result.providers?.flatMap((provider: any) =>
                  (provider.models ?? []).map((id: string) => ({
                    id,
                    provider: provider.slug,
                    name: `${id} · ${provider.name}`,
                  })),
                ) ??
                  result.models ??
                  [],
              );
              setModel("choose");
              setCustomizeModels(false);
            })
          }
        >
          <Icon name="chat-bubble" />
          Model
        </button>
        <button
          type="button"
          class="text-button"
          onClick={() => setControls("automation")}
        >
          <Icon name="clock" />
          Automations
        </button>
        <button
          type="button"
          class="text-button"
          onClick={() =>
            void run(async () => {
              setControls("context");
            })
          }
        >
          Context
        </button>
        <button
          type="button"
          class="text-button"
          onClick={() =>
            void run(async () => {
              setControls("subagents");
            })
          }
        >
          Delegated work
        </button>
      </div>
      <div class="transcript" ref={scroller}>
        <div class="transcript-inner">
          <Show when={data().pages.at(-1)?.hasMore}>
            <button
              type="button"
              class="load-earlier"
              onClick={() => setPages((x) => x + 1)}
            >
              Load earlier messages
            </button>
          </Show>
          <For each={groups()}>
            {(group) => (
              <>
                <Show when={group.prompt}>
                  {(message) => renderMessage(message())}
                </Show>
                <Show when={group.answer}>
                  {(message) => renderMessage(message())}
                </Show>
                <Show when={group.work.length}>
                  <details class="work-summary history-work">
                    <summary>
                      Worked
                      <Show
                        when={
                          group.prompt?.createdAt && group.answer?.createdAt
                        }
                      >
                        {" "}
                        for{" "}
                        {elapsed(
                          group.prompt?.createdAt ?? 0,
                          group.answer?.createdAt ?? 0,
                        )}
                      </Show>
                    </summary>
                    <For each={group.work}>{renderMessage}</For>
                  </details>
                </Show>
              </>
            )}
          </For>
          <Show when={turn()}>
            {(t) => (
              <article
                class="message assistant live-message"
                classList={{
                  "settled-work": t().state !== "running" && turnIsInHistory(),
                }}
              >
                <Show when={t().state === "running" || !turnIsInHistory()}>
                  <div class="message-label">
                    Hermes{" "}
                    <Show when={t().state === "running"}>
                      <span class="working">Working</span>
                    </Show>
                  </div>
                </Show>
                <Show when={t().text && !turnIsInHistory()}>
                  <Markdown text={t().text} />
                </Show>
                <Show when={t().recovering}>
                  <p class="subtitle" role="status">
                    Recovering live progress from Hermes…
                  </p>
                </Show>
                <Show when={t().activity.length}>
                  <details class="work-summary" open={t().state === "running"}>
                    <summary>
                      {t().state === "running" ? "Working" : "Worked"} for{" "}
                      {elapsed(t().startedAt, t().finishedAt ?? clock())}
                    </summary>
                    <For each={t().activity}>
                      {(a) => (
                        <div class="activity">
                          <Icon
                            name={a.state === "complete" ? "check" : "clock"}
                          />
                          {a.label}
                        </div>
                      )}
                    </For>
                  </details>
                </Show>
                <Show when={t().error}>
                  <p class="error" role="alert">
                    {t().error}
                  </p>
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
            each={data().commands.filter(
              (c: any) =>
                c.status === "complete" &&
                c.kind === "send" &&
                c.result?.output,
            )}
          >
            {(c: any) => (
              <article class="message assistant">
                <div class="message-label">Command result</div>
                <Markdown text={c.result.output} />
              </article>
            )}
          </For>
          <For
            each={data().commands.filter((c: any) =>
              ["unknown", "error"].includes(c.status),
            )}
          >
            {(c: any) => (
              <div class="command-error" role="alert">
                {c.error}
                <Show when={c.status === "unknown"}>
                  <p>Check the conversation before sending again.</p>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
      <div class="compose-area">
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
        <Show
          when={data().commands.some(
            (c: any) => c.status === "queued" && c.kind === "send",
          )}
        >
          <div class="queue">
            <For
              each={data().commands.filter(
                (c: any) => c.status === "queued" && c.kind === "send",
              )}
            >
              {(c: any) => (
                <div>
                  <span>{c.payload.text}</span>
                  <IconButton
                    icon="edit-pencil"
                    label="Edit queued message"
                    onClick={() => {
                      const text = prompt("Queued message", c.payload.text);
                      if (text !== null) {
                        void run(() =>
                          mutate("commands.edit", { id: c._id, text }),
                        );
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void run(() =>
                        mutate("commands.edit", { id: c._id, next: true }),
                      )
                    }
                  >
                    Send next
                  </button>
                  <IconButton
                    icon="xmark"
                    label="Remove queued message"
                    onClick={() =>
                      void run(() =>
                        mutate("commands.edit", { id: c._id, cancel: true }),
                      )
                    }
                  />
                </div>
              )}
            </For>
          </div>
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
            profile={JSON.parse(props.conversation)[0]}
            error={turn()?.error}
            useSkill={(name) => {
              changeText(`/${name} ${text()}`);
              input.focus();
            }}
            navigate={props.navigate}
          />
        </Suspense>
        <form
          class="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              edit() &&
              !confirm(
                "Replace the conversation after this message? Files and external actions will not be undone.",
              )
            ) {
              return;
            }
            void run(send);
          }}
        >
          <textarea
            ref={input}
            aria-label="Message Hermes"
            aria-controls={
              completions().length ? "composer-completions" : undefined
            }
            aria-activedescendant={
              completions().length
                ? `completion-${completionIndex()}`
                : undefined
            }
            placeholder={
              connected() ? "Message Hermes…" : "Write a draft while offline…"
            }
            value={text()}
            onInput={(e) => {
              changeText(e.currentTarget.value);
              setCursor(e.currentTarget.selectionStart);
            }}
            onClick={(e) => setCursor(e.currentTarget.selectionStart)}
            onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
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
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  chooseCompletion(completionIndex());
                  return;
                }
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.isComposing &&
                !matchMedia(
                  "(max-width: 720px), (pointer: coarse) and (hover: none)",
                ).matches
              ) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            onPaste={(e) => {
              if (e.clipboardData?.files.length) {
                e.preventDefault();
                void run(() => upload(e.clipboardData!.files));
              }
            }}
          />
          <div class="composer-bottom">
            <div>
              <IconButton
                icon="attachment"
                label="Attach files"
                onClick={() => fileInput.click()}
              />
              <IconButton
                icon="folder"
                label="Reference a file, folder, URL, or conversation"
                onClick={() => setAttachment(true)}
              />
              <button
                type="button"
                class="text-button"
                onClick={() =>
                  void run(async () => {
                    const result = await rpc("commands.catalog");
                    setSuggestions(
                      (result.pairs ?? [])
                        .map(([command, description]: [string, string]) => ({
                          command,
                          description,
                        }))
                        .filter(
                          (item: { command: string }) =>
                            !/^\/(?:image|voice|wake|terminal|shell|hud|radio|pet|browser)(?:\s|$)/i.test(
                              item.command,
                            ),
                        ),
                    );
                  })
                }
              >
                / Commands
              </button>
            </div>
            <div>
              <Show when={turn()?.state === "running"}>
                <button
                  type="button"
                  class="text-button"
                  disabled={!text().trim()}
                  onClick={() =>
                    void run(async () => {
                      const value = text();
                      const result = await rpc("session.steer", {
                        text: value,
                      });
                      if (result.status === "rejected") {
                        throw new Error(
                          "Hermes could not accept steering at this point",
                        );
                      }
                      changeText("");
                      inform("Instructions sent to the active run");
                    })
                  }
                >
                  Steer
                </button>
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
                class="send"
                type="submit"
                aria-label={
                  turn()?.state === "running" ? "Queue message" : "Send message"
                }
                disabled={!text().trim() || !connected() || sending()}
              >
                <Icon name="send" />
              </button>
            </div>
          </div>
        </form>
        <p class="compose-hint">
          {!connected()
            ? "Draft saved on this device. Connect to send."
            : turn()?.state === "running"
              ? "Messages sent now join the queue."
              : "Hermes runs on your host."}
        </p>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => void run(() => upload(e.currentTarget.files))}
        />
      </div>
      <Show when={attachment()}>
        <Dialog title="Add context" close={() => setAttachment(false)}>
          <Field label="File, folder, or URL">
            <input
              value={reference()}
              onInput={(e) => setReference(e.currentTarget.value)}
            />
          </Field>
          <button
            type="button"
            class="primary"
            onClick={() => {
              changeText(text() + "\n" + reference());
              setAttachment(false);
            }}
          >
            Attach reference
          </button>
          <h3>Conversations</h3>
          <For each={workspace()?.conversations ?? []}>
            {(c: any) => (
              <button
                type="button"
                class="list-button"
                onClick={() => {
                  changeText(
                    text() + `\n[Conversation: ${c.sourceId} — ${c.title}]`,
                  );
                  setAttachment(false);
                }}
              >
                {c.title}
              </button>
            )}
          </For>
        </Dialog>
      </Show>
      <Show when={model()}>
        <Dialog title="Choose a model" close={() => setModel("")}>
          <button
            type="button"
            onClick={() => setCustomizeModels((value) => !value)}
          >
            {customizeModels() ? "Done customizing" : "Customize model list"}
          </button>
          <Show when={customizeModels()}>
            <p>
              Choose the models shown in your picker. This list syncs across
              your devices.
            </p>
            <For each={models()}>
              {(entry) => (
                <Field label={modelLabel(entry)}>
                  <input
                    type="checkbox"
                    checked={!hiddenModels().has(modelKey(entry))}
                    onChange={(event) =>
                      void run(() =>
                        mutate("workspace.modelVisibility", {
                          model: modelKey(entry),
                          hidden: !event.currentTarget.checked,
                        }),
                      )
                    }
                  />
                </Field>
              )}
            </For>
          </Show>
          <Show when={!customizeModels()}>
            <Show when={!visibleModels().length}>
              <p>
                No models are visible. Use Customize model list to show them.
              </p>
            </Show>
            <For each={visibleModels()}>
              {(m) => (
                <button
                  type="button"
                  class="list-button"
                  onClick={() =>
                    void run(async () => {
                      const value = `${JSON.stringify(m.id ?? m.model ?? m)}${
                        m.provider
                          ? ` --provider ${JSON.stringify(m.provider)}`
                          : ""
                      }`;
                      const result = await rpc("config.set", {
                        key: "model",
                        value,
                        scope: "session",
                      });
                      if (result.confirm_required) {
                        if (
                          !confirm(result.confirm_message || "Use this model?")
                        ) {
                          return;
                        }
                        await rpc("config.set", {
                          key: "model",
                          value,
                          scope: "session",
                          confirm_expensive_model: true,
                        });
                      }
                      setModel("");
                    })
                  }
                >
                  {modelLabel(m)}
                </button>
              )}
            </For>
          </Show>
          <Field label="Reasoning effort">
            <select
              aria-label="Reasoning effort"
              onChange={(e) =>
                void run(() =>
                  rpc("config.set", {
                    key: "reasoning",
                    value: e.currentTarget.value,
                    scope: "session",
                  }),
                )
              }
            >
              <option value="">Choose effort</option>
              <For each={["none", "minimal", "low", "medium", "high", "xhigh"]}>
                {(effort) => <option value={effort}>{effort}</option>}
              </For>
            </select>
          </Field>
        </Dialog>
      </Show>
      <Show when={suggestions().length}>
        <Dialog title="Commands and skills" close={() => setSuggestions([])}>
          <For each={suggestions()}>
            {(s) => (
              <button
                type="button"
                class="list-button"
                onClick={() => {
                  changeText(`${s.command ?? s.name ?? s} `);
                  setSuggestions([]);
                  input.focus();
                }}
              >
                <strong>{s.command ?? s.name ?? String(s)}</strong>
                <span>{s.description}</span>
              </button>
            )}
          </For>
        </Dialog>
      </Show>
      <Show when={tool()}>
        <Dialog title="Tool result" close={() => setTool(undefined)}>
          <pre>{tool()?.text}</pre>
        </Dialog>
      </Show>
      <Show when={controls()}>
        {(view) => (
          <Suspense fallback={<p>Loading controls…</p>}>
            <RunControls
              conversation={props.conversation}
              view={view()}
              close={() => setControls(undefined)}
            />
          </Suspense>
        )}
      </Show>
    </div>
  );
}
