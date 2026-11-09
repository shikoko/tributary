import { useEffect } from "react";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { overallPercent } from "../lib/progress";
import type { ProgressState } from "./useActions";

/**
 * The progress on the taskbar button (Windows) or the Dock icon (macOS) too, so a long pull
 * can be followed from another app.
 */
export function useTaskbarProgress(progress: ProgressState | null) {
  const percent = progress?.visible ? overallPercent(progress.value) : null;
  const state = !progress?.visible ? "none" : percent === null ? "busy" : String(percent);
  useEffect(() => {
    const window = getCurrentWindow();
    const set =
      state === "none"
        ? { status: ProgressBarStatus.None }
        : state === "busy"
          ? { status: ProgressBarStatus.Indeterminate }
          : { status: ProgressBarStatus.Normal, progress: Number(state) };
    window.setProgressBar(set).catch(() => {});
  }, [state]);
}
