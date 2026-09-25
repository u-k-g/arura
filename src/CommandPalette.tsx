import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Dialog, Icon } from "./ui.tsx";

export type PaletteItem = {
  id: string;
  label: string;
  group: string;
  slot?: number;
  run: () => void;
};

export default function CommandPalette(props: {
  query: string;
  search: (query: string) => void;
  items: PaletteItem[];
  searching: boolean;
  error: string;
  close: () => void;
}) {
  const [active, setActive] = createSignal(0);
  let chosen = false;
  const items = createMemo(() => props.items);
  createEffect(() => {
    props.query;
    items();
    setActive(0);
  });
  const move = (next: number) => {
    const count = items().length;
    if (!count) return;
    setActive((next + count) % count);
    globalThis.document
      .getElementById(`palette-option-${active()}`)
      ?.scrollIntoView({ block: "nearest" });
  };
  const choose = (item: PaletteItem | undefined) => {
    if (!item || chosen) return;
    chosen = true;
    props.close();
    item.run();
  };
  return (
    <Dialog
      title="Find anything"
      class="command-palette"
      close={props.close}
      hideHeader
    >
      <div class="palette-search">
        <Icon name="search" />
        <input
          autofocus
          role="combobox"
          aria-label="Search conversations and actions"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="palette-options"
          aria-activedescendant={items().length
            ? `palette-option-${active()}`
            : undefined}
          placeholder="Search conversations and actions"
          value={props.query}
          onInput={(event) => {
            const value = event.currentTarget.value;
            props.search(value);
            if (/^[1-9]$/.test(value)) {
              globalThis.queueMicrotask(() => {
                if (props.query === value) {
                  choose(items().find((item) => item.slot === Number(value)));
                }
              });
            }
          }}
          onKeyDown={(event) => {
            if (event.isComposing) {
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              move(active() + (event.key === "ArrowDown" ? 1 : -1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(items()[active()]);
            }
          }}
        />
      </div>
      <div
        class="palette-results"
        id="palette-options"
        role="listbox"
        aria-label="Search results"
      >
        <For each={items()}>
          {(item, index) => (
            <>
              <Show
                when={index() === 0 ||
                  items()[index() - 1].group !== item.group}
              >
                <div class="palette-group" role="presentation">
                  {item.group}
                </div>
              </Show>
              <button
                type="button"
                role="option"
                id={`palette-option-${index()}`}
                aria-label={item.slot
                  ? `${item.label}, slot ${item.slot}`
                  : undefined}
                aria-selected={index() === active()}
                tabindex="-1"
                onMouseMove={() => setActive(index())}
                onClick={() => choose(item)}
              >
                <span class="palette-item-text">
                  <span>{item.label}</span>
                </span>
                <Show when={item.slot}>
                  <kbd class="palette-slot">
                    {item.slot}
                  </kbd>
                </Show>
              </button>
            </>
          )}
        </For>
        <Show when={!items().length && !props.searching}>
          <p class="palette-empty">
            No matches. Try a different name or phrase.
          </p>
        </Show>
      </div>
      <Show when={props.searching}>
        <p class="palette-status" role="status">
          Searching message history…
        </p>
      </Show>
      <Show when={props.error}>
        <p class="palette-status error" role="alert">
          {props.error}
        </p>
      </Show>
    </Dialog>
  );
}
