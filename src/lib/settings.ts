import { useCallback, useState } from "react";

const PREFIX = "tributary.";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Like useState, but remembered across restarts in local storage. */
export function useStoredState<T>(key: string, fallback: T): [T, (value: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
        try {
          localStorage.setItem(PREFIX + key, JSON.stringify(resolved));
        } catch {
          // Storage can be unavailable; the setting just won't survive a restart.
        }
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
