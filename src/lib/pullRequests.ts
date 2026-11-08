import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pullRequests, type PullRequest } from "../api";

/** Don't ask GitHub more often than this, unless asked to. */
const MIN_INTERVAL = 60_000;

/** Finds the pull request for a branch label. */
export interface PullRequestLookup {
  /**
   * A local branch (with the remotes that have it) or a remote branch like "origin/feat/x".
   * `upstream` is the remote branch a local branch tracks, when it's known.
   */
  find(name: string, local: boolean, remotes: string[], upstream?: string): PullRequest | undefined;
  open(url: string): void;
}

export const PullRequestsContext = createContext<PullRequestLookup | null>(null);

export function makeLookup(list: PullRequest[], open: (url: string) => void): PullRequestLookup {
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
