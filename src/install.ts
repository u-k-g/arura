import { createSignal, onCleanup, onMount } from "solid-js";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function openedAsInstalledApp() {
  return (
    globalThis.matchMedia("(display-mode: standalone)").matches ||
    globalThis.matchMedia("(display-mode: minimal-ui)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function iosHomeScreen() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(globalThis as unknown as { MSStream?: unknown }).MSStream
  );
}

export function useAppInstall() {
  const [canInstall, setCanInstall] = createSignal(false);
  const [installed, setInstalled] = createSignal(openedAsInstalledApp());
  const [iosHint, setIosHint] = createSignal(false);
  let deferred: BeforeInstallPromptEvent | undefined;

  onMount(() => {
    setIosHint(iosHomeScreen() && !installed());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferred = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setCanInstall(false);
      deferred = undefined;
    };
    const onDisplayChange = () => setInstalled(openedAsInstalledApp());

    globalThis.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    globalThis.addEventListener("appinstalled", onInstalled);
    const displayMode = globalThis.matchMedia("(display-mode: standalone)");
    displayMode.addEventListener("change", onDisplayChange);

    onCleanup(() => {
      globalThis.removeEventListener(
        "beforeinstallprompt",
        onBeforeInstallPrompt,
      );
      globalThis.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", onDisplayChange);
    });
  });

  async function install() {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") {
      setCanInstall(false);
      deferred = undefined;
      return true;
    }
    return false;
  }

  return { canInstall, installed, iosHint, install };
}
