import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pullRequests, type CommitMessage, type PullRequest, type RequestCheck, type RequestDetails } from "../api";

/** Don't ask GitHub more often than this, unless asked to. */
const MIN_INTERVAL = 60_000;

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
 * for again when `refresh` is called (after fetching or coming back to the window).
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
    if (path && enabled) refresh();
  }, [path, enabled, refresh]);

  return useMemo(() => ({ list, refresh }), [list, refresh]);
}
