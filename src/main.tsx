import { render } from "solid-js/web";
import App from "./App.tsx";
import "./style.css";
import "./chrome.css";
import "./desktop-parity.css";
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
render(() => <App />, root);
