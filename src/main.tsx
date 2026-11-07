import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// JetBrains Mono for all text, with its real italics. Bundled, so it works offline and
// looks the same whatever fonts are installed.
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "./styles.css";
import { isMac } from "./lib/platform";

// On macOS the window has no title bar: the tab bar makes room for the window buttons.
if (isMac) document.documentElement.classList.add("mac");

// The webview's own context menu (reload, inspect, …) doesn't belong in the app.
// Keep it only when text is selected, so copying still works.
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (event) => {
    if (!window.getSelection()?.toString()) event.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
