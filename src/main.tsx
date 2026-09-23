import { render } from "solid-js/web";
import App from "./App.tsx";
import "./style.css";
import "./chrome.css";
import "./desktop-parity.css";

// Mobile keyboards shrink the visual viewport while 100dvh can still describe
// the taller layout viewport. Keep the app's own scroll areas above the keys.
const visualViewport = globalThis.visualViewport;
if (visualViewport) {
  const updateViewport = () => {
    const layoutHeight = globalThis.document.documentElement.clientHeight;
    const keyboardHeight = layoutHeight - visualViewport.height;
    const style = globalThis.document.documentElement.style;
    if (visualViewport.scale > 1.05 || keyboardHeight < 120) {
      style.removeProperty("--app-viewport-height");
      style.removeProperty("--app-viewport-top");
      return;
    }
    style.setProperty(
      "--app-viewport-height",
      `${Math.round(visualViewport.height)}px`,
    );
    style.setProperty(
      "--app-viewport-top",
      `${Math.round(visualViewport.offsetTop)}px`,
    );
  };
  visualViewport.addEventListener("resize", updateViewport);
  visualViewport.addEventListener("scroll", updateViewport);
  globalThis.addEventListener("resize", updateViewport);
  updateViewport();
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
  globalThis.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void navigator.serviceWorker.getRegistration().then((r) => r?.update());
    }
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
render(() => <App />, root);
