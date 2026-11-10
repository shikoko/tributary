import { useCallback, useEffect, useRef } from "react";
import { remoteState, runAction } from "../api";
import type { Tab } from "../components/TabBar";
import type { ToastMessage } from "../components/Toast";
import { notifySystem } from "../lib/notify";
import { isLocalChangesError, NOT_ENOUGH_SPACE } from "../lib/errors";
import { describeRun, dueRun, type ScheduleDays, type ScheduledResult, type ScheduledRun } from "../lib/schedule";
import { FIRST_AUTO_FETCH_DELAY } from "./constants";

/** Why a repository wasn't brought up to date, in a sentence. */
function whyNot(error: string): string {
  if (isLocalChangesError(error)) return "Fetched, but your uncommitted changes were in the way of moving the branch forward. Pull when you're ready.";
  if (error.startsWith(NOT_ENOUGH_SPACE)) return error.split(". ")[0] + ".";
  return error.split("\n")[0];
}

interface Options {
  tabs: Tab[];
  days: ScheduleDays;
  time: string;
  /** The last run that started, as dueRun names it, so each runs once. */
  last: string | null;
  setLast: (key: string) => void;
  setRun: (run: ScheduledRun) => void;
  /** The open repository: done the usual way, with its progress (and its errors shown there). */
  activePath: string | null;
  fetchActive: () => Promise<boolean>;
  notify: (toast: ToastMessage) => void;
}

/**
 * Fetch latest on a schedule: at the set time, fetch every open repository, one after
 * another, and bring its branch up to date when that's a fast-forward (its Git LFS files
 * too), never merging; then say how it went. Runs while Tributary is open and the computer
 * awake; returns a function to run it now.
 */
export function useScheduledFetch(options: Options): () => Promise<void> {
  const latest = useRef(options);
  latest.current = options;
  const running = useRef(false);

  const runNow = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const results: ScheduledResult[] = [];
    try {
      for (const tab of latest.current.tabs) {
        if (tab.path === latest.current.activePath) {
          const ok = await latest.current.fetchActive();
          results.push({ name: tab.name, ok, message: ok ? "Fetched." : "Stopped: its tab says why." });
          continue;
        }
        try {
          const state = await remoteState(tab.path);
          if (!state.upstream) {
            results.push({ name: tab.name, ok: false, message: "Its branch isn't on a remote" });
            continue;
          }
          results.push({ name: tab.name, ok: true, message: await runAction(tab.path, { kind: "fetchLatest" }) });
        } catch (error) {
          results.push({ name: tab.name, ok: false, message: whyNot(String(error)) });
        }
      }
    } finally {
      running.current = false;
    }
    const run = { time: Date.now(), results };
    latest.current.setRun(run);
    latest.current.notify({ text: describeRun(run) });
    if (!document.hasFocus()) void notifySystem("Tributary", describeRun(run));
  }, []);

  const { days, time } = options;
  useEffect(() => {
    if (days === "off") return;
    const check = () => {
      const due = dueRun(days, time, new Date());
      if (!due || due === latest.current.last) return;
      latest.current.setLast(due);
      void runNow();
    };
    // Not at once: the open repository loads first, to be done the usual way.
    const first = window.setTimeout(check, FIRST_AUTO_FETCH_DELAY);
    const timer = window.setInterval(check, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [days, time, runNow]);

  return runNow;
}
