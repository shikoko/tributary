import { useCallback, useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ZOOM_LEVELS } from "./constants";

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

/** Zooming the whole window in steps (0 for actual size), applied as it changes. */
export function useZoom(zoom: number, setZoom: (update: (current: number) => number) => void) {
  useEffect(() => applyZoom(zoom), [zoom]);
  return useCallback(
    (step: 1 | -1 | 0) =>
      setZoom((current) => {
        if (step === 0) return 1;
        const index = ZOOM_LEVELS.findIndex((level) => level >= current - 0.001);
        return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, (index < 0 ? 4 : index) + step))];
      }),
    [setZoom],
  );
}
