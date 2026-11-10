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
  /** Already downloaded, ready to install. */
  ready?: boolean;
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

/** Download the update found by the last check (and check its signature), without installing it. */
function downloadUpdate(): Promise<void> {
  return invoke("download_update");
}

/** Install the downloaded update and restart, once no git command is running. False if the wait was stopped. */
function restartToUpdate(): Promise<boolean> {
  return invoke<boolean>("restart_to_update");
}

function onUpdateProgress(handler: (progress: UpdateProgress) => void): Promise<() => void> {
  return listen<UpdateProgress>("update-progress", (event) => handler(event.payload));
}

/** What went wrong, and at which step. */
export interface UpdateError {
  step: "check" | "download" | "install";
  message: string;
}

export interface Updates {
  /** A newer version, once a check found one. */
  available: UpdateInfo | null;
  checking: boolean;
  /** When the last check that worked finished (ms since the epoch). */
  checkedAt: number | null;
  check: () => Promise<void>;
  /** Downloading it: how far, when the size is known. */
  downloading: { percent: number | null } | null;
  download: () => Promise<void>;
  /** Downloaded and checked: restarting (or quitting) installs it. */
  ready: boolean;
  /** Restarting as soon as no git command is running. */
  waiting: boolean;
  restart: () => Promise<void>;
  /** Stop waiting to restart (the update stays ready). */
  stopWaiting: () => void;
  error: UpdateError | null;
}

const message = (e: unknown) => String(e).replace(/^Error:\s*/, "");

/**
 * Checks for a newer version a little after launching and every few hours (when `auto`),
 * and downloads one as soon as it's found. It's installed only when the person restarts for
 * it (and no git command is running then), or when they quit.
 */
export function useUpdates(auto: boolean): Updates {
  const [available, setAvailable] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [downloading, setDownloading] = useState<{ percent: number | null } | null>(null);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<UpdateError | null>(null);
  const checkingNow = useRef(false);
  const downloadingNow = useRef(false);

  const download = useCallback(async () => {
    if (downloadingNow.current) return;
    downloadingNow.current = true;
    setDownloading({ percent: null });
    setError(null);
    let stop: (() => void) | undefined;
    try {
      stop = await onUpdateProgress(({ downloaded, total }) =>
        setDownloading({ percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : null }),
      ).catch(() => undefined);
      await downloadUpdate();
      setReady(true);
    } catch (e) {
      setError({ step: "download", message: message(e) });
    } finally {
      stop?.();
      downloadingNow.current = false;
      setDownloading(null);
    }
  }, []);

  const check = useCallback(async () => {
    if (checkingNow.current) return;
    checkingNow.current = true;
    setChecking(true);
    try {
      const found = await checkForUpdate();
      setAvailable(found);
      setReady(Boolean(found?.ready));
      setError(null);
      setCheckedAt(Date.now());
      // Downloading changes nothing yet, so it starts straight away.
      if (found && !found.ready) void download();
    } catch (e) {
      setError({ step: "check", message: message(e) });
    } finally {
      checkingNow.current = false;
      setChecking(false);
    }
  }, [download]);

  const restart = useCallback(async () => {
    setWaiting(true);
    setError(null);
    try {
      // Resolves only if the wait was stopped: otherwise Tributary restarts.
      await restartToUpdate();
    } catch (e) {
      setError({ step: "install", message: message(e) });
    } finally {
      setWaiting(false);
    }
  }, []);

  const stopWaiting = useCallback(() => {
    invoke("stop_update_restart").catch(() => {});
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

  return { available, checking, checkedAt, check, downloading, download, ready, waiting, restart, stopWaiting, error };
}
