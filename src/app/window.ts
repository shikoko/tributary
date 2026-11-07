import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function setWindowTitle(title: string) {
  document.title = title;
  getCurrentWindow()
    .setTitle(title)
    .catch(() => {});
}

export function applyZoom(level: number) {
  getCurrentWebview()
    .setZoom(level)
    .catch(() => {});
}
