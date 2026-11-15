// A commit's CI runs laid out as graphs (ChecksView): each run's groups of jobs in columns,
// each after the groups it waits for, as GitHub draws a workflow run.
import type { CheckState, CommitRuns, Job, JobGroup, Run } from "../api";
import { formatElapsed } from "./pullRequests";

/** How a job, a group or a run is doing, as the graph shows it. */
export type RunState = "success" | "failure" | "running" | "queued" | "waiting" | "cancelled" | "skipped";

/**
 * A run's groups in columns: each group as far left as it can be, one column after the last
 * of the groups it waits for, in the workflow file's order within a column. A loop (a broken
 * file) is cut where it closes.
 */
export function runColumns(run: Run): JobGroup[][] {
  const byKey = new Map(run.groups.map((group) => [group.key, group]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (group: JobGroup): number => {
    const known = depth.get(group.key);
    if (known !== undefined) return known;
    if (visiting.has(group.key)) return 0;
    visiting.add(group.key);
    let deepest = 0;
    for (const key of group.needs) {
      const need = byKey.get(key);
      if (need) deepest = Math.max(deepest, depthOf(need) + 1);
    }
    visiting.delete(group.key);
    depth.set(group.key, deepest);
    return deepest;
  };
  const columns: JobGroup[][] = [];
  for (const group of run.groups) (columns[depthOf(group)] ??= []).push(group);
  return columns.filter(Boolean);
}

/** How a job is doing: queued until it has started. */
export function jobState(job: Job): RunState {
  if (job.state === null) return "skipped";
  if (job.state === "pending") return job.startedAt ? "running" : "queued";
  return job.state;
}

/**
 * How a group is doing: as its jobs (failed before running before cancelled before passed),
 * or, with none yet, waiting while its run goes on and skipped once it's over.
 */
export function groupState(group: JobGroup, run: Run): RunState {
  if (group.jobs.length === 0) return run.state === "pending" ? "waiting" : "skipped";
  const states = group.jobs.map(jobState);
  for (const state of ["failure", "running", "queued", "cancelled", "success"] as const) if (states.includes(state)) return state;
  return "skipped";
}

/** How a run is doing. */
export function runState(state: CheckState | null): RunState {
  if (state === null) return "skipped";
  return state === "pending" ? "running" : state;
}

/**
 * A job's name in its group's box, without what the box already says: "Analyze (rust)" in
 * Analyze's is "rust".
 */
export function memberName(group: JobGroup, job: Job): string {
  const prefix = `${group.name} (`;
  return job.name.startsWith(prefix) && job.name.endsWith(")") && job.name.length > prefix.length + 1 ? job.name.slice(prefix.length, -1) : job.name;
}

/** How long something with these times has run (at `now`) or took, or null without a start. */
export function elapsed(startedAt: string | null, finishedAt: string | null, now: number): string | null {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const end = finishedAt ? Date.parse(finishedAt) : now;
  return Number.isNaN(start) || Number.isNaN(end) ? null : formatElapsed(Math.max(0, end - start));
}

/** How long a job has run or took, or null when it was skipped (whatever times the site gives it) or hasn't started. */
export function jobTime(job: Job, now: number): string | null {
  return jobState(job) === "skipped" ? null : elapsed(job.startedAt, job.finishedAt, now);
}

/** How far through its steps a running job is (0 to 1), or null when its steps aren't known. */
export function stepProgress(job: Job): number | null {
  return job.steps > 0 ? Math.min(1, job.stepsDone / job.steps) : null;
}

/** How many of a commit's jobs (and other checks) are in each state, and groups still waiting, in a fixed order. */
export function countStates(runs: CommitRuns): [RunState, number][] {
  const counts = new Map<RunState, number>();
  const add = (state: RunState) => counts.set(state, (counts.get(state) ?? 0) + 1);
  for (const run of runs.runs)
    for (const group of run.groups) {
      if (group.jobs.length === 0) {
        if (run.state === "pending") add("waiting");
      } else for (const job of group.jobs) add(jobState(job));
    }
  for (const check of runs.others) add(check.state === "pending" ? (check.startedAt ? "running" : "queued") : check.state === null ? "skipped" : check.state);
  const order: RunState[] = ["failure", "running", "queued", "waiting", "success", "cancelled", "skipped"];
  return order.filter((state) => counts.has(state)).map((state) => [state, counts.get(state)!]);
}

/** Whether anything is still going: worth asking again soon. */
export function anyGoing(runs: CommitRuns): boolean {
  return runs.runs.some((run) => run.state === "pending") || runs.others.some((check) => check.state === "pending");
}

/** In words, for a count: "3 running", "12 passed". */
export const STATE_WORDS: Record<RunState, string> = {
  success: "passed",
  failure: "failed",
  running: "running",
  queued: "queued",
  waiting: "waiting",
  cancelled: "cancelled",
  skipped: "skipped",
};
