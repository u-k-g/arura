import { createMemo, createSignal, For, Show } from "solid-js";
import { Icon } from "./ui.tsx";
import "./turn-minimap.css";

export type TurnMinimapItem = {
  id: string;
  prompt: string;
  answer: string;
};

export default function TurnMinimap(props: {
  items: TurnMinimapItem[];
  currentIndex: number;
  select: (item: TurnMinimapItem, index: number) => void;
}) {
  const [activeIndex, setActiveIndex] = createSignal<number>();
  const currentIndex = () =>
    Math.max(0, Math.min(props.currentIndex, props.items.length - 1));
  const active = createMemo(() => {
    const index = activeIndex();
    return index === undefined ? undefined : props.items[index];
  });
  const position = (index: number) =>
    props.items.length < 2 ? 0 : index / (props.items.length - 1) * 100;
  const pointerIndex = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLButtonElement)
      .getBoundingClientRect();
    const progress = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    return Math.round(progress * (props.items.length - 1));
  };
  const move = (index: number) =>
    setActiveIndex(Math.max(0, Math.min(props.items.length - 1, index)));
  const select = (index: number) => {
    const item = props.items[index];
    if (item) props.select(item, index);
  };

  return (
    <Show when={props.items.length >= 2}>
      <nav class="turn-minimap" aria-label="Conversation turns">
        <button
          type="button"
          class="turn-minimap-step previous"
          aria-label="Previous turn"
          disabled={currentIndex() <= 0}
          onClick={() => select(currentIndex() - 1)}
        >
          <Icon name="nav-arrow-down" />
        </button>
        <div class="turn-minimap-track">
          <button
            type="button"
            class="turn-minimap-rail"
            aria-label={`Jump to a turn. Current turn ${
              currentIndex() + 1
            } of ${props.items.length}.`}
            style={{
              height: `min(${
                Math.max(48, (props.items.length - 1) * 9)
              }px, max(48px, calc(100dvh - 280px)))`,
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
                );
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                move(event.key === "Home" ? 0 : props.items.length - 1);
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
                    nearby: activeIndex() !== undefined &&
                      Math.abs(index() - activeIndex()!) === 1,
                  }}
                  style={{ top: `${position(index())}%` }}
                  aria-hidden="true"
                />
              )}
            </For>
          </button>
          <Show when={active()}>
            {(item) => (
              <div
                class="turn-minimap-preview"
                style={{
                  top: `${position(activeIndex()!)}%`,
                  transform: activeIndex() === 0
                    ? "translateY(0)"
                    : activeIndex() === props.items.length - 1
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
          class="turn-minimap-step next"
          aria-label="Next turn"
          disabled={currentIndex() >= props.items.length - 1}
          onClick={() => select(currentIndex() + 1)}
        >
          <Icon name="nav-arrow-down" />
        </button>
      </nav>
    </Show>
  );
}
