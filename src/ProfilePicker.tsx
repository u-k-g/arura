import "./profile-picker.css";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { connected, resource, revision } from "./client.ts";
import { Icon } from "./ui.tsx";
type Profile = {
  name: string;
  display_name?: string;
  ui_meta?: Record<string, { title?: string }>;
};
const label = (profile: Profile) =>
  profile.ui_meta?.["hermes-bots"]?.title ||
  profile.display_name ||
  profile.name;
export default function ProfilePicker(props: {
  current: string;
  choose: (name: string) => void;
  manage: () => void;
}) {
  const [profiles, setProfiles] = createSignal<Profile[]>([]);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  let panel!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  let disposed = false;
  let pending: Promise<void> | undefined;
  const refresh = () =>
    (pending ??= (async () => {
      setLoading(true);
      try {
        const result = await resource("profileRoster");
        if (!disposed) {
          setProfiles(result.profiles ?? []);
          setError("");
        }
      } catch (error) {
        if (!disposed) setError((error as Error).message);
      } finally {
        if (!disposed) setLoading(false);
        pending = undefined;
      }
    })());
  createEffect(() => {
    revision();
    if (!connected()) return;
    const timer = setTimeout(() => void refresh(), 300);
    onCleanup(() => clearTimeout(timer));
  });
  onCleanup(() => {
    disposed = true;
  });
  const position = () => {
    const rect = trigger.getBoundingClientRect();
    panel.style.left = `${Math.max(
      8,
      Math.min(rect.left, innerWidth - 268),
    )}px`;
    panel.style.bottom = `${Math.max(8, innerHeight - rect.top + 6)}px`;
    panel.style.maxHeight = `${Math.max(80, rect.top - 16)}px`;
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        class="profile-name"
        aria-label="Select profile"
        popovertarget="profile-picker"
        onClick={() => {
          position();
          void refresh();
        }}
      >
        {label(
          profiles().find((profile) => profile.name === props.current) ?? {
            name: props.current,
          },
        )}
        <Icon name="nav-arrow-down" />
      </button>
      <div
        ref={panel}
        id="profile-picker"
        popover="auto"
        class="profile-picker"
        role="dialog"
        aria-label="Switch profile"
      >
        <header>Profiles</header>
        <Show when={loading() && !profiles().length}>
          <p role="status">Loading profiles…</p>
        </Show>
        <Show when={error()}>
          <p role="alert">
            {error()}{" "}
            <button type="button" onClick={() => void refresh()}>
              Retry
            </button>
          </p>
        </Show>
        <For each={profiles()}>
          {(profile) => (
            <button
              type="button"
              aria-label={label(profile)}
              aria-pressed={profile.name === props.current}
              onClick={() => {
                props.choose(profile.name);
                panel.hidePopover();
              }}
            >
              <span>
                {label(profile)}
                <Show when={label(profile) !== profile.name}>
                  <small>{profile.name}</small>
                </Show>
              </span>
              <Show when={profile.name === props.current}>
                <Icon name="check" />
              </Show>
            </button>
          )}
        </For>
        <footer>
          <button
            type="button"
            onClick={() => {
              panel.hidePopover();
              props.manage();
            }}
          >
            Manage profiles & bots
          </button>
        </footer>
      </div>
    </>
  );
}
