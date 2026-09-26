import { createSignal } from "solid-js";

declare const __ARURA_BUILD_ID__: string;

const [availableBuild, setAvailableBuild] = createSignal<string>();
let dismissedBuild: string | undefined;
let checking: Promise<void> | undefined;

export const updateAvailable = () => Boolean(availableBuild());

export function dismissUpdate() {
  dismissedBuild = availableBuild();
  setAvailableBuild(undefined);
}

export function checkForUpdate() {
  if (checking) return checking;
  checking = (async () => {
    try {
      const response = await globalThis.fetch("/api/bootstrap", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) return;
      const { build } = (await response.json()) as { build?: unknown };
      if (typeof build !== "string") return;
      if (build === __ARURA_BUILD_ID__) setAvailableBuild(undefined);
      else if (build !== dismissedBuild) setAvailableBuild(build);
    } catch {
      // An offline PWA keeps its cached UI and checks again on reconnect.
    }
  })().finally(() => {
    checking = undefined;
  });
  return checking;
}

export function watchForUpdates() {
  const check = () => {
    if (globalThis.document.visibilityState === "visible") {
      void checkForUpdate();
    }
  };
  check();
  const interval = globalThis.setInterval(check, 60000);
  globalThis.document.addEventListener("visibilitychange", check);
  globalThis.addEventListener("pageshow", check);
  globalThis.addEventListener("online", check);
  return () => {
    globalThis.clearInterval(interval);
    globalThis.document.removeEventListener("visibilitychange", check);
    globalThis.removeEventListener("pageshow", check);
    globalThis.removeEventListener("online", check);
  };
}

export async function reloadUpdatedApp() {
  if ("serviceWorker" in globalThis.navigator) {
    try {
      const registration =
        await globalThis.navigator.serviceWorker.getRegistration();
      if (registration) {
        let changed = false;
        const onChange = () => {
          changed = true;
        };
        globalThis.navigator.serviceWorker.addEventListener(
          "controllerchange",
          onChange,
        );
        await registration.update();
        const installing = registration.installing;
        if (
          installing &&
          installing.state !== "installed" &&
          installing.state !== "activated"
        ) {
          await new Promise<void>((resolve) => {
            const done = () => {
              if (
                ["installed", "activated", "redundant"].includes(
                  installing.state,
                )
              ) {
                installing.removeEventListener("statechange", done);
                resolve();
              }
            };
            installing.addEventListener("statechange", done);
            done();
          });
        }
        const waiting = registration.waiting;
        if ((waiting || installing) && !changed) {
          const controlled = new Promise<boolean>((resolve) => {
            const done = () => {
              globalThis.navigator.serviceWorker.removeEventListener(
                "controllerchange",
                done,
              );
              resolve(true);
            };
            globalThis.navigator.serviceWorker.addEventListener(
              "controllerchange",
              done,
              { once: true },
            );
            globalThis.setTimeout(() => {
              globalThis.navigator.serviceWorker.removeEventListener(
                "controllerchange",
                done,
              );
              resolve(false);
            }, 8000);
          });
          waiting?.postMessage({ type: "SKIP_WAITING" });
          if (!(await controlled)) await registration.unregister();
        }
        globalThis.navigator.serviceWorker.removeEventListener(
          "controllerchange",
          onChange,
        );
      }
    } catch {
      // The page reload still checks the network for the new build.
    }
  }
  globalThis.location.reload();
}
