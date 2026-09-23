import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Icon } from "./ui.tsx";
import "./turn-minimap.css";

export type TurnMinimapItem = {
  id: string;
  prompt: string;
  answer: string;
};

const TICK_SPACING = 9;
const TICK_INSET = 4;

export default function TurnMinimap(props: {
  items: TurnMinimapItem[];
  currentIndex: number;
  select: (item: TurnMinimapItem, index: number) => void;
  jumpToLatest: () => void;
  showJumpToLatest: boolean;
}) {
  const [activeIndex, setActiveIndex] = createSignal<number>();
  const [railScroll, setRailScroll] = createSignal(0);
  let viewport: HTMLDivElement | undefined;
  const currentIndex = () =>
    Math.max(0, Math.min(props.currentIndex, props.items.length - 1));
  const active = createMemo(() => {
    const index = activeIndex();
    return index === undefined ? undefined : props.items[index];
  });
  const position = (index: number) => TICK_INSET + index * TICK_SPACING;
  const previewPosition = () => position(activeIndex() ?? 0) - railScroll();
  const nearby = (index: number) => {
    const active = activeIndex();
    return active !== undefined && Math.abs(index - active) === 1;
  };
  const pointerIndex = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLButtonElement)
      .getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        props.items.length - 1,
        Math.round((event.clientY - rect.top - TICK_INSET) / TICK_SPACING),
      ),
    );
  };
  const move = (index: number, reveal = false) => {
    const next = Math.max(0, Math.min(props.items.length - 1, index));
    setActiveIndex(next);
    if (!reveal || !viewport) return;
    const y = position(next);
    if (y < viewport.scrollTop + TICK_INSET) {
      viewport.scrollTop = y - TICK_INSET;
    } else if (
      y > viewport.scrollTop + viewport.clientHeight - TICK_INSET
    ) {
      viewport.scrollTop = y - viewport.clientHeight + TICK_INSET;
    }
    setRailScroll(viewport.scrollTop);
  };
  const select = (index: number) => {
    const item = props.items[index];
    if (item) props.select(item, index);
  };
  createEffect(() => {
    const index = currentIndex();
    props.items.length;
    if (!viewport) return;
    viewport.scrollTop = Math.max(
      0,
      position(index) - viewport.clientHeight / 2,
    );
    setRailScroll(viewport.scrollTop);
  });

  return (
    <Show when={props.items.length >= 1}>
      <nav class="turn-minimap" aria-label="Conversation turns">
        <div class="turn-minimap-track">
          <div
            class="turn-minimap-viewport"
            ref={viewport}
            onScroll={() => setRailScroll(viewport?.scrollTop ?? 0)}
          >
            <button
              type="button"
              class="turn-minimap-rail"
              aria-label={`Jump to a turn. Current turn ${
                currentIndex() + 1
              } of ${props.items.length}.`}
              style={{
                height: `${
                  TICK_INSET * 2 + (props.items.length - 1) * TICK_SPACING
                }px`,
                "--active-position": `${position(activeIndex() ?? 0)}px`,
              }}
              onMouseMove={(event) => move(pointerIndex(event))}
              onMouseLeave={() => setActiveIndex(undefined)}
              onFocus={() => setActiveIndex(currentIndex())}
              onBlur={() => setActiveIndex(undefined)}
              onClick={(event) => select(pointerIndex(event))}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  move(
                    (activeIndex() ?? currentIndex()) +
                      (event.key === "ArrowDown" ? 1 : -1),
                    true,
                  );
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  move(event.key === "Home" ? 0 : props.items.length - 1, true);
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select(activeIndex() ?? currentIndex());
                }
              }}
            >
              <span class="turn-minimap-spine" aria-hidden="true" />
              <For each={props.items}>
                {(_, index) => (
                  <span
                    class="turn-minimap-mark"
                    classList={{
                      current: index() === currentIndex(),
                      active: index() === activeIndex(),
                      nearby: nearby(index()),
                    }}
                    style={{ top: `${position(index())}px` }}
                    aria-hidden="true"
                  />
                )}
              </For>
            </button>
          </div>
          <Show when={active()}>
            {(item) => (
              <div
                class="turn-minimap-preview"
                style={{
                  top: `${previewPosition()}px`,
                  transform: previewPosition() < 28
                    ? "translateY(0)"
                    : previewPosition() > (viewport?.clientHeight ?? 0) - 28
                    ? "translateY(-100%)"
                    : "translateY(-50%)",
                }}
              >
                <strong>{item().prompt || "Attached files"}</strong>
                <Show when={item().answer}>
                  <span>{item().answer}</span>
                </Show>
              </div>
            )}
          </Show>
        </div>
        <button
          type="button"
          class="turn-minimap-step"
          classList={{ "is-hidden": !props.showJumpToLatest }}
          aria-label="Jump to latest messages"
          onClick={props.jumpToLatest}
        >
          <Icon name="nav-arrow-down" />
        </button>
      </nav>
    </Show>
  );
}
