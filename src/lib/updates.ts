import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** A newer version of Tributary. */
export interface UpdateInfo {
  version: string;
  /** The version running now. */
  current: string;
  notes: string | null;
  date: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/** The first check after launching, and how often to check after that. */
const FIRST_CHECK = 15_000;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

export function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("check_for_update");
}

/** Download and install the update found by the last check, then restart. */
export function installUpdate(): Promise<void> {
  return invoke("install_update");
}

export function onUpdateProgress(handler: (progress: UpdateProgress) => void): Promise<() => void> {
  return listen<UpdateProgress>("update-progress", (event) => handler(event.payload));
}

export interface Updates {
  /** A newer version, once a check found one. */
  available: UpdateInfo | null;
  checking: boolean;
  /** Why the last check didn't work, if it didn't. */
  error: string | null;
  /** When the last check that worked finished (ms since the epoch). */
  checkedAt: number | null;
  check: () => Promise<void>;
}

/** Checks for a newer version a little after launching and every few hours, when `auto`. */
export function useUpdates(auto: boolean): Updates {
  const [available, setAvailable] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const running = useRef(false);

  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setChecking(true);
    try {
      const found = await checkForUpdate();
      setAvailable(found);
      setError(null);
      setCheckedAt(Date.now());
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      running.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!auto) return;
    // Quietly: a failed background check just tries again later.
    const first = setTimeout(check, FIRST_CHECK);
    const timer = setInterval(check, CHECK_EVERY);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [auto, check]);

  return { available, checking, error, checkedAt, check };
}
