import { render } from "solid-js/web";
import App from "./App.tsx";
import "./style.css";
import "./chrome.css";
import "./desktop-parity.css";

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
