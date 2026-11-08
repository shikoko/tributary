import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Google Sans for the interface and JetBrains Mono (with its real italics) for SHAs, branch
// names, paths and code. Bundled, so they work offline and look the same everywhere.
import "@fontsource-variable/google-sans";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "./styles.css";
import { isMac } from "./lib/platform";
import { applyStoredAppearance } from "./app/useAppearance";

// On macOS the window has no title bar: the tab bar makes room for the window buttons.
if (isMac) document.documentElement.classList.add("mac");
// The remembered theme and accent, before anything is drawn.
applyStoredAppearance();

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
