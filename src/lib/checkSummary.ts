// A commit's checks summed up in words, for its details and a pull request's (CommitChecks).
import type { RequestCheck } from "../api";
import { checkName, describeCheckProgress, formatElapsed } from "./pullRequests";
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

/** Names, as a short list: "Lint", "Lint and Build", "Lint and 2 more". */
function shortList(names: string[]): string {
  return names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more`;
}

/**
 * How long the checks that passed took, from the first to start to the last to finish (cancelled
 * ones were most likely replaced by these), like "8m 2s"; null without their times.
 */
function tookToPass(checks: RequestCheck[]): string | null {
  const passed = checks.filter((check) => check.state === "success");
  const starts = passed.map((check) => Date.parse(check.startedAt ?? "")).filter((time) => !Number.isNaN(time));
  const ends = passed.map((check) => Date.parse(check.finishedAt ?? "")).filter((time) => !Number.isNaN(time));
  return starts.length > 0 && ends.length > 0 ? formatElapsed(Math.max(...ends) - Math.min(...starts)) : null;
}

/**
 * What a pull request's checks say beside its river, under its word (Passing, Failing,
 * Running): first what needs looking at (the checks that failed, like "Audio loudness failed",
 * else the ones still running; once they've passed, how many and how long they took, like "All
 * 12 checks passed in 8m 2s"), then, muted, the rest of the counts with the skipped ones.
 * When none ran, the title says they were skipped.
 */
export function riverWords(checks: RequestCheck[], gitlab: boolean): { title: string; detail: string | null } {
  const what = gitlab ? "jobs" : "checks";
  const named = (state: RequestCheck["state"]) => checks.filter((check) => check.state === state).map((check) => checkName(check.name));
  const skipped = named(null).length;
  const also = (...parts: (string | null)[]) => [...parts, skipped > 0 ? `${skipped} skipped` : null].filter(Boolean).join(", ") || null;
  const progress = describeCheckProgress(checks, gitlab);
  if (!progress) return { title: skipped === 1 ? `The ${what.slice(0, -1)} was skipped` : `All ${skipped} ${what} were skipped`, detail: null };
  const [failed, running, cancelled] = [named("failure"), named("pending"), named("cancelled")];
  if (failed.length > 0) return { title: `${shortList(failed)} failed`, detail: also(progress) };
  if (running.length > 0) return { title: `${shortList(running)} ${running.length === 1 ? "is" : "are"} still running`, detail: also(progress) };
  const took = tookToPass(checks);
  if (named("success").length === 0) return { title: `${shortList(cancelled)} ${cancelled.length === 1 ? "was" : "were"} cancelled`, detail: also() };
  if (cancelled.length === 0) return { title: took ? `${progress} in ${took}` : progress, detail: also() };
  return { title: progress, detail: also(took && `Took ${took}`) };
}
