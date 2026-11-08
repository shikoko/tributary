import { useCallback, useRef } from "react";
import { commitDetails, type CommitDetails, type CommitRow } from "../api";

/** Commits' full messages and changed files, asked for once and kept. */
export function useCommitDetails(repoPath: string | null, commits: CommitRow[] | undefined) {
  const cache = useRef(new Map<string, CommitDetails>());

  const load = useCallback(
    async (id: string) => {
      const cached = cache.current.get(id);
      if (cached) return cached;
      if (!repoPath) throw new Error("No repository");
      const details = await commitDetails(repoPath, id);
      cache.current.set(id, details);
      return details;
    },
    [repoPath],
  );

  /** An abbreviated commit id in a message → a loaded commit, if there is exactly one. */
  const resolve = useCallback(
    (prefix: string) => {
      const found = (commits ?? []).filter((commit) => commit.kind === "commit" && commit.id.startsWith(prefix));
      return found.length === 1 ? found[0].id : null;
    },
    [commits],
  );

  /** Another repository was opened. */
  const reset = useCallback(() => {
    cache.current = new Map();
  }, []);

  return { cache, load, resolve, reset };
}

export type CommitDetailsCache = ReturnType<typeof useCommitDetails>;
