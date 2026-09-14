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
        icons["./icons/chat-bubble.svg"]}
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
}) {
  let el!: HTMLDialogElement;
  const position = () => {
    if (props.anchor) {
      const rect = el.getBoundingClientRect();
      el.style.setProperty(
        "--menu-x",
        `${
          Math.max(8, Math.min(props.anchor.x, innerWidth - rect.width - 8))
        }px`,
      );
      el.style.setProperty(
        "--menu-y",
        `${
          Math.max(8, Math.min(props.anchor.y, innerHeight - rect.height - 8))
        }px`,
      );
    }
  };
  onMount(() => {
    el.showModal();
    position();
    if (props.anchor) globalThis.addEventListener("resize", position);
  });
  onCleanup(() => {
    globalThis.removeEventListener("resize", position);
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
        if (e.target === el) props.close();
      }}
    >
      <div class="dialog-inner">
        <header>
          <h2>{props.title}</h2>
          <IconButton icon="xmark" label="Close" onClick={props.close} />
        </header>
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
      <Show when={props.icon}>
        <Icon name={props.icon!} />
      </Show>
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
