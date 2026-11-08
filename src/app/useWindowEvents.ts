import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { activityLog, onActivity, onRepoChanged, stopWatching, watchRepository, type LogEntry } from "../api";
import { ACTIVITY_SIZE } from "./constants";

/** Call `listen` once, and its unlisten when the component goes away (even if that's before it resolved). */
function useSubscription(listen: () => Promise<() => void>) {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    const quietly = (unlisten: () => void) => {
      try {
        unlisten();
      } catch {
        // Already gone.
      }
    };
    listen()
      .then((unlisten) => (disposed ? quietly(unlisten) : (stop = unlisten)))
      .catch(() => {});
    return () => {
      disposed = true;
      if (stop) quietly(stop);
    };
    // Subscribes once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** The git commands Tributary ran: what's already been run, then each new one as it happens. */
export function useActivityLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  /** Entries up to this id were cleared. */
  const [cleared, setCleared] = useState(0);
  useEffect(() => {
    activityLog()
      .then(setEntries)
      .catch(() => {});
  }, []);
  useSubscription(() => onActivity((entry) => setEntries((current) => [...current.slice(1 - ACTIVITY_SIZE), entry])));
  const shown = entries.filter((entry) => entry.id > cleared);
  return { entries: shown, clear: () => setCleared(entries[entries.length - 1]?.id ?? 0) };
}

/** Folders dragged onto the window: `dropping` while one is over it, `onDrop` with its path. */
export function useFolderDrop(onDrop: (path: string) => void) {
  const [dropping, setDropping] = useState(false);
  const handler = useRef(onDrop);
  handler.current = onDrop;
  useSubscription(() =>
    getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") setDropping(true);
      else if (payload.type === "leave") setDropping(false);
      else if (payload.type === "drop") {
        setDropping(false);
        if (payload.paths[0]) handler.current(payload.paths[0]);
      }
    }),
  );
  return dropping;
}

/** `onFocus` when you come back to the window (to pick up changes made elsewhere). */
export function useWindowFocus(onFocus: () => void) {
  const handler = useRef(onFocus);
  handler.current = onFocus;
  // The DOM event covers most cases; the window event also catches the app being
  // activated while the web page itself already had focus.
  useEffect(() => {
    const listener = () => handler.current();
    window.addEventListener("focus", listener);
    return () => window.removeEventListener("focus", listener);
  }, []);
  useSubscription(() => getCurrentWindow().onFocusChanged(({ payload: focused }) => focused && handler.current()));
}
export type ActivityLog = ReturnType<typeof useActivityLog>;

/**
 * Watch the repository at `path` for changes made outside the app (an editor, the terminal,
 * an agent), calling `onChange` after each burst of them. Without a repository, nothing is
 * watched. If watching isn't possible (too many folders, say), coming back to the window
 * still picks changes up.
 */
export function useRepositoryWatch(path: string | null, onChange: () => void) {
  const handler = useRef(onChange);
  handler.current = onChange;
  const watched = useRef(path);
  watched.current = path;
  useEffect(() => {
    (path ? watchRepository(path) : stopWatching()).catch(() => {});
  }, [path]);
  useSubscription(() => onRepoChanged((changed) => changed === watched.current && handler.current()));
}
