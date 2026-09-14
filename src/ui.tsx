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
      innerHTML={
        icons[`./icons/${props.name}.svg`] ?? icons["./icons/chat-bubble.svg"]
      }
    />
  );
}
export function IconButton(props: {
  icon: string;
  label: string;
  onClick: () => void;
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
}) {
  let el!: HTMLDialogElement;
  onMount(() => {
    el.showModal();
  });
  onCleanup(() => el.close());
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the native dialog through onCancel.
    <dialog
      ref={el}
      aria-label={props.title}
      class={props.class ?? ""}
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
