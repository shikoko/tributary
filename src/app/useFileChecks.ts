import { useEffect, useMemo, useRef, useState } from "react";
import { fileChecks, type FileChecks, type Lock, type RepoSnapshot } from "../api";

/** The changed files that are big and not in Git LFS, and those that are lockable. */
export function useFileChecks(snapshot: RepoSnapshot | null, largeFileMB: number): FileChecks | null {
  const [checks, setChecks] = useState<FileChecks | null>(null);
  const repoPath = snapshot?.path ?? null;
  const changedFiles = useMemo(
    () =>
      snapshot?.worktree
        ? [...snapshot.worktree.staged, ...snapshot.worktree.unstaged]
            .filter((file) => file.status !== "deleted" && file.status !== "conflicted")
            .map((file) => file.path)
        : [],
    [snapshot],
  );
  const deletedFiles = useMemo(
    () =>
      snapshot?.worktree
        ? [...snapshot.worktree.staged, ...snapshot.worktree.unstaged].filter((file) => file.status === "deleted").map((file) => file.path)
        : [],
    [snapshot],
  );
  const signature = `${changedFiles.join("\n")}\n--\n${deletedFiles.join("\n")}`;
  useEffect(() => {
    if (!repoPath || changedFiles.length + deletedFiles.length === 0) {
      setChecks(null);
      return;
    }
    let live = true;
    fileChecks(repoPath, changedFiles, Math.max(1, largeFileMB) * 1_000_000, deletedFiles)
      .then((found) => live && setChecks(found))
      .catch(() => live && setChecks(null));
    return () => {
      live = false;
    };
    // The signature stands for the list of files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, signature, largeFileMB]);
  return checks;
}

/**
 * With "lock files when I change them" on: lock the lockable files you've changed that
 * nobody holds. Each file is tried once per session, even if locking it fails.
 */
export function useAutoLock(options: {
  enabled: boolean;
  repoPath: string | null;
  checks: FileChecks | null;
  /** Null while locks aren't known, or the repository doesn't use them. */
  locks: Map<string, Lock> | null;
  busy: boolean;
  lock: (paths: string[]) => void;
}) {
  const { enabled, repoPath, checks, locks, busy } = options;
  const tried = useRef(new Set<string>());
  const lock = useRef(options.lock);
  lock.current = options.lock;
  useEffect(() => {
    if (!enabled || !repoPath || !locks || busy || !checks) return;
    const toLock = checks.lockable.filter((path) => !locks.has(path) && !tried.current.has(`${repoPath}\n${path}`));
    if (toLock.length === 0) return;
    for (const path of toLock) tried.current.add(`${repoPath}\n${path}`);
    lock.current(toLock);
    // Runs when what's changed, or the locks, are known again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, checks, locks]);
}
