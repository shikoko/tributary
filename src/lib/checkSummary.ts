// A commit's checks summed up in words, for its details and a pull request's (CommitChecks).
import type { RequestCheck } from "../api";
import { checkName, formatElapsed } from "./pullRequests";
import { STATE_WORDS, type RunState } from "./runGraph";

/** A check's state as the details count it: skipped ones have none. */
export type CountedState = "failure" | "pending" | "success" | "cancelled" | "skipped";

/** How the checks went, overall: failed if any did, running while any are, then passed. */
export function checksVerdict(counts: Map<CountedState, number>): RunState {
  if (counts.get("failure")) return "failure";
  if (counts.get("pending")) return "running";
  if (counts.get("success")) return "success";
  return counts.get("cancelled") ? "cancelled" : "skipped";
}

/**
 * How they went, in words: "All 22 checks passed", "13 of 20 checks passed" (the rest
 * cancelled or skipped), "1 of 7 checks failed", "2 of 7 jobs running" (GitLab's are jobs).
 */
export function checksHeadline(counts: Map<CountedState, number>, gitlab: boolean): string {
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const jobs = gitlab ? "jobs" : "checks";
  const state = checksVerdict(counts);
  if (state === "failure") return `${counts.get("failure")} of ${total} ${jobs} failed`;
  if (state === "running") return `${counts.get("pending")} of ${total} ${jobs} running`;
  if (state === "success") {
    const passed = counts.get("success") ?? 0;
    if (passed < total) return `${passed} of ${total} ${jobs} passed`;
    return total === 1 ? `The ${jobs.slice(0, -1)} passed` : `All ${total} ${jobs} passed`;
  }
  return total === 1 ? `The ${jobs.slice(0, -1)} was ${STATE_WORDS[state]}` : `All ${total} ${jobs} ${STATE_WORDS[state]}`;
}

/**
 * The title over a pull request's checks, whose river already counts them in its caption: it
 * names what needs looking at instead. Which failed ("Audio loudness failed", "Audio loudness
 * and 2 more failed"), else which are still running, else which were cancelled; once they've
 * passed, how long they took ("Passed in 5m 9s"). Null when it has nothing to name, like when
 * every check was skipped or the site gave no times, for the counted headline to stand in.
 */
export function checksTitle(checks: RequestCheck[]): string | null {
  const named = (state: RequestCheck["state"]) => checks.filter((check) => check.state === state).map((check) => checkName(check.name));
  const list = (names: string[]) => (names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more`);
  const failed = named("failure");
  if (failed.length > 0) return `${list(failed)} failed`;
  const running = named("pending");
  if (running.length > 0) return `${list(running)} ${running.length === 1 ? "is" : "are"} still running`;
  const passed = checks.filter((check) => check.state === "success");
  const cancelled = named("cancelled");
  if (passed.length === 0) return cancelled.length > 0 ? `${list(cancelled)} ${cancelled.length === 1 ? "was" : "were"} cancelled` : null;
  // From the first to start to the last to finish (cancelled ones were most likely replaced by these).
  const starts = passed.map((check) => Date.parse(check.startedAt ?? "")).filter((time) => !Number.isNaN(time));
  const ends = passed.map((check) => Date.parse(check.finishedAt ?? "")).filter((time) => !Number.isNaN(time));
  if (starts.length === 0 || ends.length === 0) return null;
  return `Passed in ${formatElapsed(Math.max(...ends) - Math.min(...starts))}`;
}
