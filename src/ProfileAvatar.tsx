import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { resource } from "./client";
import { loadCache, saveCache } from "./cache";

export default function ProfileAvatar(props: {
  name: string;
  version: number;
}) {
  const [image, setImage] = createSignal("");
  createEffect(() => {
    const name = props.name,
      version = props.version;
    let disposed = false;
    void (async () => {
      const key = `avatar:${name}`;
      const cached = await loadCache<{ version: number; data: string }>(key);
      if (disposed) return;
      if (cached) setImage(cached.data);
      if (cached?.version === version) return;
      const value = await resource("profileAvatar", { name });
      if (disposed) return;
      const data =
        value.found && /^data:image\/(png|jpeg|webp);base64,/.test(value.data)
          ? value.data
          : "";
      setImage(data);
      void saveCache(key, { version, data });
    })().catch(() => {
      /* Cached image or initials remain available. */
    });
    onCleanup(() => {
      disposed = true;
    });
  });
  return (
    <Show
      when={image()}
      fallback={
        <span class="profile-avatar-placeholder">
          {props.name.slice(0, 1).toUpperCase()}
        </span>
      }
    >
      <img class="profile-avatar" src={image()} alt="" />
    </Show>
  );
}
