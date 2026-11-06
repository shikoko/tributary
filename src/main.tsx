import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

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
