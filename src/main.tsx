import { render } from "solid-js/web";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./style.css";
import "./chrome.css";
import "./desktop-parity.css";

if (import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onRegistered(registration) {
      if (!registration) return;
      const refresh = () => void registration.update();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refresh();
      });
    },
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
render(() => <App />, root);
