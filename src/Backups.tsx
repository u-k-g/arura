import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { connected, resource, subscribe } from "./client.ts";
import { run } from "./ui.tsx";

export default function Backups() {
  const [backup, setBackup] = createSignal<any>();
  const [starting, setStarting] = createSignal(false);
  createEffect(() => {
    if (!connected()) return;
    onCleanup(subscribe("backups", "latest", {}, setBackup));
  });
  const busy = () =>
    starting() || ["starting", "running"].includes(backup()?.status);
  return (
    <section aria-label="Hermes backup">
      <p>
        Create an archive on the Hermes host, then download it after Hermes
        finishes.
      </p>
      <button
        type="button"
        class="primary"
        disabled={!connected() || busy()}
        onClick={() =>
          void run(async () => {
            setStarting(true);
            try {
              await resource("backup", {}, {});
            } finally {
              setStarting(false);
            }
          })
        }
      >
        {busy() ? "Creating backup…" : "Create backup"}
      </button>
      <Show when={backup()}>
        {(value) => (
          <>
            <p role="status">
              {value().status === "complete"
                ? "Backup ready"
                : value().status === "error"
                  ? value().error
                  : "Creating backup on the host…"}
            </p>
            <Show when={value().status === "complete" && value().archive}>
              <a
                class="button"
                href={`/api/download?${new URLSearchParams({ type: "backup", archive: value().archive })}`}
                download=""
              >
                Download Hermes backup
              </a>
            </Show>
          </>
        )}
      </Show>
      <p>Also save your folders, pins, and shared preferences.</p>
      <a class="button" href="/api/workspace-backup" download="">
        Download workspace backup
      </a>
    </section>
  );
}
