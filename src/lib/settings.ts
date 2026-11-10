import { useCallback, useEffect, useState } from "react";

const PREFIX = "tributary.";
/** Said when a stored setting changes, so every place showing it follows. */
const CHANGED = "tributary:setting";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * Like useState, but remembered across restarts in local storage, and the same everywhere
 * it's used: a change in one place shows in the others (Settings and a dialog, say).
 */
export function useStoredState<T>(key: string, fallback: T): [T, (value: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    const follow = (event: Event) => {
      const { detail } = event as CustomEvent<{ key: string; value: T }>;
      if (detail.key === key) setValue(detail.value);
    };
    window.addEventListener(CHANGED, follow);
    return () => window.removeEventListener(CHANGED, follow);
  }, [key]);
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
        try {
          localStorage.setItem(PREFIX + key, JSON.stringify(resolved));
        } catch {
          // Storage can be unavailable; the setting just won't survive a restart.
        }
        // After this render: the others with the same key follow.
        queueMicrotask(() => window.dispatchEvent(new CustomEvent(CHANGED, { detail: { key, value: resolved } })));
        return resolved;
      });
    },
    [key],
  );
  return [value, set];
}

export function readSetting<T>(key: string, fallback: T): T {
  return read(key, fallback);
}
