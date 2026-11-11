import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pullRequests, type CommitMessage, type PullRequest, type RequestCheck, type RequestDetails, type RequestReview } from "../api";

/** Asked for again this often while a repository is open: cheap, since the app asks with
 * each answer's ETag, and an unchanged one costs nothing against GitHub's hourly limit. */
const POLL = 60_000;
/** Don't ask more often than this, unless asked to (a little under POLL, so a timer that
 * fires a moment early still asks). */
const MIN_INTERVAL = 50_000;

/** Finds the pull request for a branch label. */
export interface PullRequestLookup {
  /**
   * A local branch (with the remotes that have it) or a remote branch like "origin/feat/x".
   * `upstream` is the remote branch a local branch tracks, when it's known.
   */
  find(name: string, local: boolean, remotes: string[], upstream?: string): PullRequest | undefined;
  /** Show it in the app. */
  open(pr: PullRequest): void;
}

export const PullRequestsContext = createContext<PullRequestLookup | null>(null);

export function makeLookup(list: PullRequest[], open: (pr: PullRequest) => void): PullRequestLookup {
  const byRemoteBranch = new Map(list.map((pr) => [`${pr.remote}/${pr.branch}`, pr]));
  return {
    find(name, local, remotes, upstream) {
      if (!local) return byRemoteBranch.get(name);
      if (upstream && byRemoteBranch.has(upstream)) return byRemoteBranch.get(upstream);
      for (const remote of remotes) {
        const found = byRemoteBranch.get(`${remote}/${name}`);
        if (found) return found;
      }
      return undefined;
    },
    open,
  };
}

/** "#12" for a pull request, "!12" for a GitLab merge request. */
export function requestNumber(pr: PullRequest): string {
  return `${pr.forge === "gitlab" ? "!" : "#"}${pr.number}`;
}

/** What a pull request is called where it is: "pull request", or "merge request" on GitLab. */
export function requestNoun(forge: "github" | "gitlab" | undefined): string {
  return forge === "gitlab" ? "merge request" : "pull request";
}

/** "feat/sync-retry" → "Sync retry": a title from a branch's name. */
export function titleFromBranch(branch: string): string {
  const name = branch.slice(branch.lastIndexOf("/") + 1).replace(/[-_]+/g, " ").trim();
  return name ? name[0].toUpperCase() + name.slice(1) : branch;
}

/**
 * A new pull request's title and description: one commit's own message, or for several,
 * a title from the branch's name and the commits listed.
 */
export function suggestRequest(branch: string, commits: CommitMessage[]): { title: string; body: string } {
  if (commits.length === 1) return { title: commits[0].summary, body: commits[0].body };
  return { title: titleFromBranch(branch), body: commits.map((commit) => `- ${commit.summary}`).join("\n") };
}

/** "2 failed, 1 running, 5 passed": how a request's checks went, worst first. */
export function summarizeChecks(checks: RequestCheck[]): string {
  const count = (state: RequestCheck["state"]) => checks.filter((check) => check.state === state).length;
  const parts = [
    [count("failure"), "failed"],
    [count("pending"), "running"],
    [count("success"), "passed"],
    [count(null), "skipped"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}`)
    .join(", ");
}

/** A length of time, short: "45s", "4m 12s", "1h 3m". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * How long a check has been running (at `now`), or how long it took once it's done. Null
 * when it hasn't started, like one still queued, or the site didn't say.
 */
export function checkTime(check: RequestCheck, now: number): string | null {
  const start = check.startedAt ? Date.parse(check.startedAt) : NaN;
  const end = check.finishedAt ? Date.parse(check.finishedAt) : check.state === "pending" ? now : NaN;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return formatElapsed(end - start);
}

/** One clock for a request's checks: where each one's bar starts and ends on it, from 0 to 1. */
export interface CheckTimeline {
  /** A bar for each check, in order, or null for one that hasn't started (or has no times). */
  bars: ({ from: number; to: number } | null)[];
  /** When the first one started and the last one ended (or now, if one is running), in ms. */
  first: number;
  last: number;
}

/** Lays the checks out on one clock, or null when none of them has times to show. */
export function checkTimeline(checks: RequestCheck[], now: number): CheckTimeline | null {
  const spans = checks.map((check) => {
    const start = check.startedAt ? Date.parse(check.startedAt) : NaN;
    const end = check.finishedAt ? Date.parse(check.finishedAt) : check.state === "pending" ? now : NaN;
    // A clock a little behind the site's could put a running check's start after now.
    return Number.isNaN(start) || Number.isNaN(end) ? null : { start, end: Math.max(end, start) };
  });
  const known = spans.filter((span) => span !== null);
  if (known.length === 0) return null;
  const first = Math.min(...known.map((span) => span.start));
  const last = Math.max(...known.map((span) => span.end));
  const length = Math.max(last - first, 1);
  return {
    bars: spans.map((span) => span && { from: (span.start - first) / length, to: (span.end - first) / length }),
    first,
    last,
  };
}

/** Whether any of these checks is running, so its time keeps growing. */
export const anyRunning = (checks: RequestCheck[]) => checks.some((check) => check.state === "pending" && check.startedAt && !check.finishedAt);

/** A list of names in words: "maya", "maya and theo", "maya, theo and sam". */
function names(list: string[]): string {
  return list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** Where a request's reviews stand, in words, like "Approved by maya · waiting for sam". */
export function describeReviews(reviews: RequestReview[]): string | null {
  const who = (state: RequestReview["state"]) => reviews.filter((review) => review.state === state).map((review) => review.author);
  const parts = [
    who("changesRequested").length > 0 && `${names(who("changesRequested"))} asked for changes`,
    who("approved").length > 0 && `approved by ${names(who("approved"))}`,
    who("commented").length > 0 && `${names(who("commented"))} commented`,
    who("requested").length > 0 && `waiting for ${names(who("requested"))}`,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  const text = parts.join(" · ");
  // A capital for "Approved by" and "Waiting for", but a username stays as it's written.
  return /^(approved|waiting) /.test(text) ? text[0].toUpperCase() + text.slice(1) : text;
}

/** How far a request's checks have got, like "3 of 5 checks passed, 2 still running". Skipped ones don't count. */
export function describeCheckProgress(checks: RequestCheck[], gitlab = false): string | null {
  const counted = checks.filter((check) => check.state !== null);
  if (counted.length === 0) return null;
  const what = gitlab ? "jobs" : "checks";
  const count = (state: RequestCheck["state"]) => counted.filter((check) => check.state === state).length;
  const [failed, running, passed] = [count("failure"), count("pending"), count("success")];
  const still = running > 0 ? `, ${running} still running` : "";
  if (failed > 0) return `${failed} of ${counted.length} ${what} failed${still}`;
  if (running > 0) return `${passed} of ${counted.length} ${what} passed${still}`;
  return counted.length === 1 ? `The ${what.slice(0, -1)} passed` : `All ${counted.length} ${what} passed`;
}

/** Whether a request can be merged, in words, and how it looks: good, bad or waiting. */
export function describeMergeable(details: RequestDetails): { text: string; tone: "good" | "bad" | "waiting" } | null {
  const base = details.base;
  switch (details.mergeable) {
    case "ready":
      return { text: `Ready to merge into ${base}`, tone: "good" };
    case "conflicts":
      return { text: `Conflicts with ${base}: merge ${base} into ${details.branch} (or rebase it) and resolve them`, tone: "bad" };
    case "behind":
      return { text: `Behind ${base}: bring ${base}'s new commits into ${details.branch} first`, tone: "waiting" };
    case "blocked": {
      const changes = details.reviews.some((review) => review.state === "changesRequested");
      const failed = details.checks.some((check) => check.state === "failure");
      const reason = changes ? "changes were asked for" : failed ? "checks failed" : "it needs approvals or passing checks";
      return { text: `Can't be merged yet: ${reason}`, tone: changes || failed ? "bad" : "waiting" };
    }
    case "checking":
      return { text: `Checking whether it can be merged into ${base}…`, tone: "waiting" };
    default:
      return null;
  }
}

/** "Checks passed", for a pull request's badge. */
export function describeChecks(pr: PullRequest): string {
  const gitlab = pr.forge === "gitlab";
  const what = gitlab ? "pipeline" : "checks";
  const checks =
    pr.checks === "success"
      ? `${what} passed`
      : pr.checks === "failure"
        ? `${what} failed`
        : pr.checks === "pending"
          ? `${what} running`
          : null;
  return `${gitlab ? "Merge request" : "Pull request"} ${requestNumber(pr)}${pr.draft ? " (draft)" : ""}: ${pr.title}${pr.author ? ` by ${pr.author}` : ""}${checks ? ` · ${checks}` : ""}`;
}

/**
 * The open pull requests of the repository's GitHub remote (or merge requests of its GitLab one), kept per repository and asked
 * for again every minute, and when `refresh` is called (after fetching or coming back to the window).
 */
export function usePullRequests(path: string | null, enabled: boolean) {
  const cache = useRef(new Map<string, { list: PullRequest[]; at: number }>());
  const [list, setList] = useState<PullRequest[]>([]);
  const latest = useRef({ path, enabled });
  latest.current = { path, enabled };
  const asking = useRef(new Set<string>());

  const refresh = useCallback((force = false) => {
    const { path: repo, enabled } = latest.current;
    if (!repo || !enabled || asking.current.has(repo)) return;
    const known = cache.current.get(repo);
    if (!force && known && Date.now() - known.at < MIN_INTERVAL) return;
    asking.current.add(repo);
    pullRequests(repo)
      .then((found) => {
        cache.current.set(repo, { list: found, at: Date.now() });
        if (latest.current.path === repo) setList(found);
      })
      .catch(() => {})
      .finally(() => asking.current.delete(repo));
  }, []);

  useEffect(() => {
    setList(path && enabled ? (cache.current.get(path)?.list ?? []) : []);
    if (!path || !enabled) return;
    refresh();
    const timer = window.setInterval(() => refresh(), POLL);
    return () => window.clearInterval(timer);
  }, [path, enabled, refresh]);

  return useMemo(() => ({ list, refresh }), [list, refresh]);
}
