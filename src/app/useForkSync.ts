import { useCallback, useEffect, useRef } from "react";
import { forkStatus, gitHubForks, syncFork } from "../api";
import type { ToastMessage } from "../components/Toast";
import { describeForkRun, forkKey, syncDue, type ForkRun, type ForkRunResult, type ForkSyncEvery } from "../lib/forks";
import { notifySystem } from "../lib/notify";
import { FIRST_AUTO_FETCH_DELAY } from "./constants";

/** How often it looks whether the forks are due to be synced. */
const LOOK_EVERY = 5 * 60_000;

interface Options {
  /** Whether Settings shows your forks at all. */
  shown: boolean;
  /** The forks with Auto on, as "owner/name". */
  auto: string[];
  every: ForkSyncEvery;
  /** How the last time went, and saying so. */
  run: ForkRun | null;
  setRun: (run: ForkRun) => void;
  notify: (toast: ToastMessage) => void;
  /** Open the Forks screen, from what's said about them (none without a repository open). */
  onShow: (() => void) | null;
}

/**
 * Your forks with Auto on, synced by themselves while Tributary is open: a minute after it
 * starts, then every hour or day, as Settings says. Each one behind its original is synced
 * on GitHub, as its Sync fork button does; then it says what happened, when anything did. A
 * fork whose own changes clash with its original's is left as it is.
 */
export function useForkSync(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const running = useRef(false);

  const runNow = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const results: ForkRunResult[] = [];
    try {
      const wanted = new Set(latest.current.auto);
      const { forks } = await gitHubForks();
      for (const fork of forks.filter((each) => wanted.has(forkKey(each)))) {
        try {
          const status = await forkStatus(fork);
          if (status.new === 0) {
            results.push({ name: fork.name, outcome: "upToDate", message: "" });
            continue;
          }
          const sync = await syncFork(fork);
          results.push({ name: fork.name, outcome: sync.outcome, message: sync.message });
        } catch (error) {
          results.push({ name: fork.name, outcome: "failed", message: String(error) });
        }
      }
    } catch {
      // Couldn't list them (offline, say): it tries again when it next looks.
      return;
    } finally {
      running.current = false;
    }
    const run = { time: Date.now(), results };
    latest.current.setRun(run);
    const said = describeForkRun(run);
    if (!said) return;
    const show = latest.current.onShow;
    latest.current.notify({ text: said, action: show ? { label: "Your forks", onClick: show } : undefined });
    if (!document.hasFocus()) void notifySystem("Tributary", said);
  }, []);

  const { shown, every } = options;
  const anyAuto = options.auto.length > 0;
  useEffect(() => {
    if (!shown || every === "off" || !anyAuto) return;
    const check = () => {
      if (syncDue(latest.current.every, latest.current.run?.time ?? null, Date.now())) void runNow();
    };
    // Not at once: the open repository loads first.
    const first = window.setTimeout(check, FIRST_AUTO_FETCH_DELAY);
    const timer = window.setInterval(check, LOOK_EVERY);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [shown, every, anyAuto, runNow]);
}
