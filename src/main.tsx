import React, { Suspense, lazy } from "react";
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
import { ErrorBoundary } from "./components/ErrorScreen";
import { watchForProblems } from "./lib/problems";

// On macOS the window has no title bar: the tab bar makes room for the window buttons.
if (isMac) document.documentElement.classList.add("mac");
// The remembered theme and accent, before anything is drawn.
applyStoredAppearance();

// Errors nothing else caught go in the problems log, to send with a report later.
watchForProblems();

// The webview's own context menu (reload, inspect, …) doesn't belong in the app.
// Keep it only when text is selected, so copying still works.
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (event) => {
    if (!window.getSelection()?.toString()) event.preventDefault();
  });
}

// The catalogue of the app's building blocks (?catalogue), for working on how it looks: a
// page of its own, loaded only when asked for.
const Catalogue = lazy(() => import("./catalogue/Catalogue"));
const catalogue = new URLSearchParams(location.search).has("catalogue");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {catalogue ? (
      <Suspense>
        <Catalogue />
      </Suspense>
    ) : (
      // An error that stops the interface shows what happened, instead of an empty window.
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    )}
  </React.StrictMode>,
);
