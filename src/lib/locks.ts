import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lfsLocks, type Lock, type Locks } from "../api";

/** Don't ask the server for locks more often than this, unless asked to. */
const MIN_INTERVAL = 30_000;

export interface LfsLocks {
  /** Null until the first answer, and for repositories without LFS locking. */
  locks: Locks | null;
  /** By path. */
  byPath: Map<string, Lock>;
  /** Ask the server again. Unless `force`, only if the last time was a while ago. */
  refresh: (force?: boolean) => void;
}

/**
 * The repository's Git LFS locks. They're read when the repository opens, and again
 * when `refresh` is called (after fetching, locking, unlocking, or coming back to the
 * window). Answers are kept per repository, so switching tabs shows them right away.
 */
export function useLfsLocks(path: string | null): LfsLocks {
  const cache = useRef(new Map<string, { locks: Locks; at: number }>());
  const [locks, setLocks] = useState<Locks | null>(null);
  const latestPath = useRef(path);
  latestPath.current = path;
  const asking = useRef(new Set<string>());

  const refresh = useCallback((force = false) => {
    const repo = latestPath.current;
    if (!repo || asking.current.has(repo)) return;
    const known = cache.current.get(repo);
    // Repositories without locking stay that way; no need to ask again.
    if (known && !known.locks.supported) return;
    if (!force && known && Date.now() - known.at < MIN_INTERVAL) return;
    asking.current.add(repo);
    lfsLocks(repo)
      .then((answer) => {
        // Keep the last good list when the server can't be reached this time.
        const next = answer.error && known ? { ...known.locks, error: answer.error } : answer;
        cache.current.set(repo, { locks: next, at: Date.now() });
        if (latestPath.current === repo) setLocks(next);
      })
      .catch(() => {})
      .finally(() => asking.current.delete(repo));
  }, []);

  useEffect(() => {
    setLocks(path ? (cache.current.get(path)?.locks ?? null) : null);
    if (path) refresh();
  }, [path, refresh]);

  const byPath = useMemo(() => new Map((locks?.supported ? locks.locks : []).map((lock) => [lock.path, lock])), [locks]);
  return { locks: locks?.supported ? locks : null, byPath, refresh };
}

/** "you" or the owner's name. */
export function lockOwner(lock: Lock): string {
  return lock.mine ? "you" : lock.owner || "someone else";
}
