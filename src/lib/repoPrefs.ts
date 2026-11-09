import { useCallback, useEffect, useState } from "react";
import type { Visibility } from "../api";

/** Settings that belong to one repository, like hidden branches, remembered in local storage. */
function key(name: string, path: string) {
  return `tributary.${name}:${path}`;
}

export function readRepoSetting<T>(name: string, path: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(name, path));
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Sent when a repository's setting changes, so every place that shows it follows. */
const CHANGED = "tributary-repo-setting";

function writeRepoSetting<T>(name: string, path: string, value: T) {
  try {
    localStorage.setItem(key(name, path), JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the setting just won't survive a restart.
  }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: key(name, path) }));
}

/** Like useState, for a setting of the repository at `path` (none open: the fallback). */
export function useRepoSetting<T>(
  name: string,
  path: string | null,
  fallback: T,
): [T, (value: T | ((current: T) => T)) => void] {
  const read = useCallback(() => (path ? readRepoSetting(name, path, fallback) : fallback), [name, path]);
  const [state, setState] = useState<{ path: string | null; value: T }>(() => ({ path, value: read() }));
  useEffect(() => setState({ path, value: read() }), [path, read]);
  // Changed elsewhere (another window of settings, say): read it again.
  useEffect(() => {
    if (!path) return;
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key(name, path)) setState({ path, value: read() });
    };
    window.addEventListener(CHANGED, changed);
    return () => window.removeEventListener(CHANGED, changed);
  }, [name, path, read]);
  const value = state.path === path ? state.value : read();
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      if (!path) return;
      const current = readRepoSetting(name, path, fallback);
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      writeRepoSetting(name, path, resolved);
      setState({ path, value: resolved });
    },
    [name, path],
  );
  return [value, set];
}

export const NO_VISIBILITY: Visibility = { hidden: [], solo: [] };

export function readVisibility(path: string): Visibility {
  const value = readRepoSetting<Visibility>("visibility", path, NO_VISIBILITY);
  return { hidden: value.hidden ?? [], solo: value.solo ?? [] };
}
