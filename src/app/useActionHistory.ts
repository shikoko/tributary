import { useCallback, useEffect } from "react";
import type { Action, RepoSnapshot } from "../api";
import { checkFor, withEntry, type HistoryEntry } from "../lib/history";
import { useStoredState } from "../lib/settings";

/** Repositories whose history is kept (the most recently used). */
const REPOSITORIES_KEPT = 20;
/** Actions bigger than this (like discarding thousands of files) aren't kept: the toast's Undo still works. */
const LARGEST_KEPT = 20_000;

/** What you did with Tributary, in each repository, with an undo for each. */
export function useActionHistory(snapshot: RepoSnapshot | null) {
  const [all, setAll] = useStoredState<Record<string, HistoryEntry[]>>("history", {});

  const record = useCallback(
    (path: string, text: string, action: Action, undo: Action | null) => {
      if (JSON.stringify(action).length + JSON.stringify(undo).length > LARGEST_KEPT) return;
      const entry: HistoryEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time: Date.now(), path, text, action, undo, check: checkFor(action), after: null, undone: false };
      setAll((map) => {
        const next = { ...map, [path]: withEntry(map[path] ?? [], entry) };
        // Only the repositories used most recently.
        const newest = Object.entries(next)
          .sort((a, b) => (b[1][0]?.time ?? 0) - (a[1][0]?.time ?? 0))
          .slice(0, REPOSITORIES_KEPT);
        return Object.fromEntries(newest);
      });
    },
    [setAll],
  );

  // Once the repository has reloaded after an action: where it left HEAD (its undo is safe
  // while HEAD is still there).
  const pending = snapshot ? (all[snapshot.path] ?? []).some((entry) => entry.after === null) : false;
  useEffect(() => {
    if (!snapshot || !pending) return;
    const after = { headBranch: snapshot.headBranch, headCommit: snapshot.headCommit };
    setAll((map) => ({ ...map, [snapshot.path]: (map[snapshot.path] ?? []).map((entry) => (entry.after === null ? { ...entry, after } : entry)) }));
  }, [snapshot, pending, setAll]);

  const markUndone = useCallback(
    (path: string, id: string) => setAll((map) => ({ ...map, [path]: (map[path] ?? []).map((entry) => (entry.id === id ? { ...entry, undone: true } : entry)) })),
    [setAll],
  );
  const clear = useCallback((path: string) => setAll((map) => ({ ...map, [path]: [] })), [setAll]);

  return { entries: snapshot ? (all[snapshot.path] ?? []) : [], record, markUndone, clear };
}

export type ActionHistory = ReturnType<typeof useActionHistory>;
