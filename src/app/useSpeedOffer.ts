import { useEffect, useRef } from "react";
import { speedSettings, type RepoSnapshot } from "../api";
import type { ToastMessage } from "../components/Toast";

const KEY = "tributary.speed.offered";

/** The repositories the speed-ups were offered for already (each once, ever). */
function offered(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Once per repository: when a big one opens with none of git's speed-ups on, offer them
 * (in its settings).
 */
export function useSpeedOffer(snapshot: RepoSnapshot | null, notify: (toast: ToastMessage) => void, openSpeedSettings: () => void) {
  const asked = useRef(new Set<string>());
  const path = snapshot && !snapshot.bare ? snapshot.path : null;
  const name = snapshot?.name ?? "";
  const latest = useRef({ notify, openSpeedSettings });
  latest.current = { notify, openSpeedSettings };
  useEffect(() => {
    if (!path || asked.current.has(path) || offered().includes(path)) return;
    asked.current.add(path);
    speedSettings(path)
      .then((settings) => {
        const anyOn = settings.fileWatcher === true || settings.untrackedCache || settings.commitGraph || settings.maintenance;
        if (!settings.big || anyOn) return;
        try {
          localStorage.setItem(KEY, JSON.stringify([...offered(), path].slice(-200)));
        } catch {
          // Without storage, it may be offered again next time.
        }
        latest.current.notify({
          text: `${name} has ${settings.files.toLocaleString("en-US")} files: git's speed-ups would make it quicker`,
          action: { label: "Speed up…", onClick: () => latest.current.openSpeedSettings() },
        });
      })
      .catch(() => {});
  }, [path, name]);
}
