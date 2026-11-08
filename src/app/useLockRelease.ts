import { useCallback, useEffect, useMemo, useState } from "react";
import type { Action, Lock, RepoSnapshot } from "../api";
import type { ReleaseLocks } from "./usePreferences";

interface Options {
  snapshot: RepoSnapshot | null;
  /** Git LFS locks by path, or null when the repository doesn't use locking. */
  locks: Map<string, Lock> | null;
  mode: ReleaseLocks;
  act: (action: Action) => Promise<boolean>;
}

/**
 * After a push, the locks you hold on the files you pushed and aren't changing any more:
 * offered to release (so your teammates can work on them), released right away, or kept,
 * as the setting says.
 */
export function useLockRelease({ snapshot, locks, mode, act }: Options) {
  const [pushed, setPushed] = useState<{ path: string; files: string[] } | null>(null);
  const repoPath = snapshot?.path ?? null;

  const releasable = useMemo(() => {
    if (!pushed || pushed.path !== repoPath || !locks) return [];
    const changing = new Set(
      [...(snapshot?.worktree?.staged ?? []), ...(snapshot?.worktree?.unstaged ?? [])].map((file) => file.path),
    );
    return pushed.files.flatMap((file) => {
      const lock = locks.get(file);
      return lock && lock.mine && !changing.has(file) ? [lock] : [];
    });
  }, [pushed, repoPath, locks, snapshot]);

  const release = useCallback(
    (which: Lock[]) => {
      setPushed(null);
      if (which.length > 0) act({ kind: "unlockFiles", locks: which.map(({ id, path }) => ({ id, path })), force: false });
    },
    [act],
  );

  // Releasing without asking.
  useEffect(() => {
    if (mode === "always" && releasable.length > 0) release(releasable);
  }, [mode, releasable, release]);

  return {
    /** The locks to offer to release (none unless the setting is to ask). */
    offered: mode === "ask" ? releasable : [],
    /** A push went through: these are the files it pushed. */
    pushedFiles: useCallback(
      (files: string[]) => {
        if (repoPath && mode !== "never" && files.length > 0) setPushed({ path: repoPath, files });
      },
      [repoPath, mode],
    ),
    release: () => release(releasable),
    keep: () => setPushed(null),
  };
}

export type LockRelease = ReturnType<typeof useLockRelease>;
