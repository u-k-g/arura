import ProviderLogo from "./ProviderLogo.tsx";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { mutate, workspace } from "./client.ts";
import { Icon, IconButton, run } from "./ui.tsx";
import "./model-picker.css";
import {
  type ReasoningCapabilities,
  reasoningLevels,
} from "../shared/model-reasoning.ts";

export type ModelOption = {
  capabilities?: ReasoningCapabilities;
  provider?: string;
  providerName?: string;
  id?: string;
  model?: string;
  name?: string;
  label?: string;
};
export const modelLabel = (entry: ModelOption) =>
  entry.name ?? entry.label ?? entry.id ?? entry.model ?? String(entry);
const modelKey = (entry: ModelOption) =>
  JSON.stringify([entry.provider ?? "", entry.id ?? entry.model ?? entry]);
const providerLabel = (entry: ModelOption) =>
  entry.providerName ?? entry.provider ?? "Default provider";
const accessibleLabel = (entry: ModelOption) =>
  `${modelLabel(entry)} · ${providerLabel(entry)}`;

export default function ModelPicker(props: {
  anchor?: HTMLButtonElement;
  models: ModelOption[];
  current: string;
  provider: string;
  effort: string;
  close: () => void;
  choose: (model: ModelOption) => Promise<void>;
  changeEffort: (effort: string) => Promise<void>;
}) {
  let panel!: HTMLDivElement;
  const position = () => {
    const anchor = props.anchor?.getBoundingClientRect();
    if (!anchor) return;
    const viewport = globalThis.visualViewport;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const bottom = (viewport?.offsetTop ?? 0) +
      (viewport?.height ?? innerHeight) - 8;
    const above = anchor.top - top - 6;
    const below = bottom - anchor.bottom - 6;
    const upward = above >= Math.min(400, below);
    panel.style.maxHeight = `${Math.max(120, upward ? above : below)}px`;
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${
      Math.max(
        8,
        Math.min(anchor.right - rect.width, innerWidth - rect.width - 8),
      )
    }px`;
    panel.style.top = `${
      Math.max(
        top,
        upward ? anchor.top - rect.height - 6 : anchor.bottom + 6,
      )
    }px`;
  };
  onMount(() => {
    panel.showPopover();
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    onCleanup(() => observer.disconnect());
    globalThis.addEventListener("resize", position);
    globalThis.addEventListener("scroll", position, true);
    globalThis.visualViewport?.addEventListener("resize", position);
    globalThis.visualViewport?.addEventListener("scroll", position);
  });
  onCleanup(() => {
    globalThis.removeEventListener("resize", position);
    globalThis.removeEventListener("scroll", position, true);
    globalThis.visualViewport?.removeEventListener("resize", position);
    globalThis.visualViewport?.removeEventListener("scroll", position);
    requestAnimationFrame(() => props.anchor?.focus({ preventScroll: true }));
  });
  const [section, setSection] = createSignal("favorites");
  const [search, setSearch] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const favorites = createMemo(
    () => new Set(workspace()?.settings.modelFavorites ?? []),
  );
  const hidden = createMemo(
    () => new Set(workspace()?.settings.hiddenModels ?? []),
  );
  const providers = createMemo(() => [
    ...new Map(
      props.models.map((entry) => [entry.provider ?? "", providerLabel(entry)]),
    ).entries(),
  ]);
  const filtered = createMemo(() =>
    props.models.filter(
      (entry) =>
        !hidden().has(modelKey(entry)) &&
        (section() === "favorites"
          ? favorites().has(modelKey(entry))
          : section() === `provider:${entry.provider ?? ""}`) &&
        accessibleLabel(entry)
          .toLowerCase()
          .includes(search().trim().toLowerCase()),
    )
  );
  const selected = createMemo(() => {
    const matches = props.models.filter((entry) =>
      [entry.id, entry.model, modelLabel(entry)].includes(props.current)
    );
    return (
      matches.find((entry) => entry.provider === props.provider) ??
        (matches.length === 1 ? matches[0] : undefined)
    );
  });
  const efforts = createMemo(() => {
    const entry = selected();
    return entry
      ? reasoningLevels(
        entry.provider ?? "",
        entry.id ?? entry.model ?? "",
        entry.capabilities,
      )
      : undefined;
  });
  const perform = (action: () => Promise<void>) => {
    if (busy()) return;
    setBusy(true);
    void run(action).finally(() => setBusy(false));
  };
  return (
    <div
      ref={panel}
      popover="auto"
      id="conversation-model-picker"
      role="dialog"
      aria-label="Choose a model"
      class="model-picker"
      onToggle={(event) => {
        if (event.newState === "closed") props.close();
      }}
    >
      <div class="model-picker-layout">
        <nav class="model-provider-rail" aria-label="Model providers">
          <button
            type="button"
            title="Starred models"
            aria-label="Starred models"
            aria-pressed={section() === "favorites"}
            onClick={() => setSection("favorites")}
          >
            <Icon name="star" />
          </button>
          <div class="model-provider-divider" />
          <For each={providers()}>
            {([id, label]) => (
              <button
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={section() === `provider:${id}`}
                onClick={() => setSection(`provider:${id}`)}
              >
                <ProviderLogo provider={id} label={label} />
              </button>
            )}
          </For>
        </nav>
        <div class="model-picker-main">
          <div class="model-search-bar">
            <label class="model-search">
              <Icon name="search" />
              <input
                autofocus
                type="search"
                aria-label="Search models"
                placeholder="Search models…"
                value={search()}
                onInput={(event) => setSearch(event.currentTarget.value)}
              />
            </label>
            <IconButton icon="xmark" label="Close" onClick={props.close} />
          </div>
          <div class="model-picker-list" aria-busy={busy()}>
            <For each={filtered()}>
              {(entry) => (
                <div
                  class="model-picker-row"
                  classList={{
                    selected: props.current === modelLabel(entry) ||
                      props.current === entry.id ||
                      props.current === entry.model,
                  }}
                >
                  <button
                    type="button"
                    class="model-choice"
                    aria-label={accessibleLabel(entry)}
                    disabled={busy()}
                    onClick={() => perform(() => props.choose(entry))}
                  >
                    <span>{modelLabel(entry)}</span>
                    <small>{providerLabel(entry)}</small>
                  </button>
                  <button
                    type="button"
                    class="model-star"
                    classList={{ starred: favorites().has(modelKey(entry)) }}
                    aria-label={`${
                      favorites().has(modelKey(entry)) ? "Unstar" : "Star"
                    } ${accessibleLabel(entry)}`}
                    aria-pressed={favorites().has(modelKey(entry))}
                    onClick={() => {
                      void run(() =>
                        mutate("workspace.modelFavorite", {
                          model: modelKey(entry),
                          starred: !favorites().has(modelKey(entry)),
                        })
                      );
                    }}
                  >
                    <Icon name="star" />
                  </button>
                </div>
              )}
            </For>
            <Show when={!filtered().length}>
              <p class="model-picker-empty">
                {search()
                  ? "No matching models."
                  : section() === "favorites"
                  ? "Star models to keep them here."
                  : "No visible models. Manage the model list in Settings → Models & providers."}
              </p>
            </Show>
          </div>
          <footer class="model-picker-footer">
            <label>
              Reasoning effort
              <select
                aria-label="Reasoning effort"
                value={efforts()?.includes(props.effort) ? props.effort : ""}
                disabled={busy() || !efforts()?.length}
                onChange={(event) => {
                  const effort = event.currentTarget.value;
                  if (efforts()?.includes(effort)) {
                    perform(() => props.changeEffort(effort));
                  }
                }}
              >
                <option value="" disabled>
                  {efforts() === undefined
                    ? "Not reported"
                    : !efforts()?.length
                    ? "Not supported"
                    : "Choose effort"}
                </option>
                <For each={efforts() ?? []}>
                  {(effort) => (
                    <option value={effort}>
                      {effort === "none"
                        ? "Off"
                        : effort.charAt(0).toUpperCase() + effort.slice(1)}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </footer>
        </div>
      </div>
    </div>
  );
}
