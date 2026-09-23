import { inform } from "./client.ts";
import { type JSX, onCleanup, onMount, Show } from "solid-js";
const icons = import.meta.glob("./icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
export function Icon(props: { name: string }) {
  return (
    <span
      class="icon"
      aria-hidden="true"
      innerHTML={icons[`./icons/${props.name}.svg`] ??
        icons["./icons/message-text.svg"]}
    />
  );
}
export function IconButton(props: {
  icon: string;
  label: string;
  onClick: (event: MouseEvent) => void;
  disabled?: boolean;
  class?: string;
}) {
  return (
    <button
      type="button"
      class={`icon-button ${props.class ?? ""}`}
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Icon name={props.icon} />
    </button>
  );
}
export function Dialog(props: {
  title: string;
  children: JSX.Element;
  close: () => void;
  class?: string;
  anchor?: { x: number; y: number };
  hideHeader?: boolean;
}) {
  let el!: HTMLDialogElement;
  let drag:
    | { pointer: number; y: number; started: number; distance: number }
    | undefined;
  let suppressHandleClick = false;
  let settling: Animation | undefined;
  let openedAt = 0;
  const mobileSheet = () =>
    props.class?.split(" ").includes("navigation-sheet") &&
    matchMedia("(max-width: 720px), (pointer: coarse) and (hover: none)")
      .matches;
  const startDrag = (event: PointerEvent) => {
    if (!mobileSheet() || !event.isPrimary || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button") && !target.closest(".sheet-handle")) return;
    settling?.cancel();
    suppressHandleClick = false;
    drag = {
      pointer: event.pointerId,
      y: event.clientY,
      started: event.timeStamp,
      distance: 0,
    };
  };
  const moveDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const header = event.currentTarget as HTMLElement;
    if (!header.hasPointerCapture(event.pointerId)) {
      header.setPointerCapture(event.pointerId);
    }
    drag.distance = Math.max(0, event.clientY - drag.y);
    el.style.transform = `translateY(${drag.distance}px)`;
  };
  const endDrag = (event: PointerEvent, cancelled = false) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { distance, started } = drag;
    drag = undefined;
    suppressHandleClick = distance > 3;
    const header = event.currentTarget as HTMLElement;
    if (header.hasPointerCapture(event.pointerId)) {
      header.releasePointerCapture(event.pointerId);
    }
    const dismiss = !cancelled &&
      (distance >= Math.min(120, el.offsetHeight * 0.2) ||
        (distance > 35 &&
          distance / Math.max(1, event.timeStamp - started) > 0.6));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.transform = "";
      if (dismiss) props.close();
      return;
    }
    settling = el.animate(
      [
        { transform: `translateY(${distance}px)` },
        { transform: `translateY(${dismiss ? el.offsetHeight : 0}px)` },
      ],
      { duration: 180, easing: "ease-out", fill: "forwards" },
    );
    const animation = settling;
    void animation.finished
      .then(() => {
        if (settling !== animation) return;
        el.style.transform = "";
        animation.cancel();
        settling = undefined;
        if (dismiss) props.close();
      })
      .catch(() => {});
  };

  const position = () => {
    if (props.anchor) {
      const rect = el.getBoundingClientRect();
      el.style.setProperty(
        "--menu-x",
        `${
          Math.max(
            8,
            Math.min(props.anchor.x, innerWidth - rect.width - 8),
          )
        }px`,
      );
      el.style.setProperty(
        "--menu-y",
        `${
          Math.max(
            8,
            Math.min(props.anchor.y, innerHeight - rect.height - 8),
          )
        }px`,
      );
    }
  };
  onMount(() => {
    el.showModal();
    openedAt = globalThis.performance.now();
    position();
    if (props.anchor) globalThis.addEventListener("resize", position);
  });
  onCleanup(() => {
    globalThis.removeEventListener("resize", position);
    settling?.cancel();
    el.close();
  });
  return (
    <dialog
      ref={el}
      aria-label={props.title}
      class={props.class ?? ""}
      onKeyDown={(event) => {
        if (
          props.class !== "conversation-menu" ||
          !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          return;
        }
        const items = Array.from(
          el.querySelectorAll<HTMLElement>(
            ".action-list button:not(:disabled), .action-list a[href]",
          ),
        );
        if (!items.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home"
          ? 0
          : event.key === "End"
          ? items.length - 1
          : (current +
            (event.key === "ArrowDown" ? 1 : -1) +
            items.length) %
            items.length;
        items[next].focus();
      }}
      onCancel={(e) => {
        e.preventDefault();
        props.close();
      }}
      onClick={(e) => {
        if (
          e.target === el &&
          !(props.class === "conversation-menu" &&
            globalThis.performance.now() - openedAt < 400)
        ) props.close();
      }}
    >
      <div class="dialog-inner">
        <Show when={!props.hideHeader}>
          <header
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={(event) => endDrag(event)}
            onPointerCancel={(event) => endDrag(event, true)}
            onLostPointerCapture={(event) => {
              if (drag && event.target === event.currentTarget) {
                endDrag(event, true);
              }
            }}
          >
            <Show when={props.class?.split(" ").includes("navigation-sheet")}>
              <button
                type="button"
                class="sheet-handle"
                aria-label="Close sheet"
                onClick={() => {
                  if (suppressHandleClick) {
                    suppressHandleClick = false;
                    return;
                  }
                  props.close();
                }}
              >
                <span />
              </button>
            </Show>
            <h2>{props.title}</h2>
            <IconButton icon="xmark" label="Close" onClick={props.close} />
          </header>
        </Show>
        {props.children}
      </div>
    </dialog>
  );
}
export function Empty(props: {
  title: string;
  children?: JSX.Element;
  icon?: string;
}) {
  return (
    <div class="empty">
      <Show when={props.icon}>{(name) => <Icon name={name()} />}</Show>
      <h2>{props.title}</h2>
      <div>{props.children}</div>
    </div>
  );
}
export function Field(props: {
  label: string;
  children: JSX.Element;
  hint?: string;
}) {
  return (
    <div class="field">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Callers supply the form control inside the wrapping label. */}
      <label>
        <span>{props.label}</span>
        {props.children}
      </label>
      <Show when={props.hint}>
        <small>{props.hint}</small>
      </Show>
    </div>
  );
}
export async function run(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    inform(error instanceof Error ? error.message : "Action failed");
  }
}
