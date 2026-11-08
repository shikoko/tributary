import { useCallback, useEffect, useRef, useState } from "react";
import { compareCommits, type Comparison } from "../api";

/** One side of a comparison: a commit, and what to call it (a branch's name, or a short id). */
export interface CompareSide {
  id: string;
  label: string;
}

/** Compare `to` with `from`: since they split (what `to` adds, like a pull request), or directly. */
export interface CompareRequest {
  from: CompareSide;
  to: CompareSide;
  split: boolean;
}

/**
 * The comparison shown in the details panel, if any, loaded as it changes. Selecting
 * another commit goes back to that commit's details.
 */
export function useComparison(repoPath: string, selectedId: string | null) {
  const [request, setRequest] = useState<CompareRequest | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; comparison: Comparison | null; error: string | null } | null>(null);
  const key = request ? JSON.stringify([repoPath, request.from.id, request.to.id, request.split]) : null;

  useEffect(() => {
    if (!request || !key) return;
    let current = true;
    compareCommits(repoPath, request.from.id, request.to.id, request.split)
      .then((comparison) => current && setLoaded({ key, comparison, error: null }))
      .catch((e) => current && setLoaded({ key, comparison: null, error: String(e) }));
    return () => {
      current = false;
    };
    // `key` covers the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const lastSelected = useRef(selectedId);
  useEffect(() => {
    if (selectedId === lastSelected.current) return;
    lastSelected.current = selectedId;
    setRequest(null);
  }, [selectedId]);

  const shown = loaded && loaded.key === key ? loaded : null;
  const close = useCallback(() => setRequest(null), []);
  return {
    request,
    /** Changes with each request: diffs from one comparison aren't shown for another. */
    key,
    comparison: shown?.comparison ?? null,
    error: shown?.error ?? null,
    compare: setRequest,
    close,
    setSplit: (split: boolean) => setRequest((current) => current && { ...current, split }),
    swap: () => setRequest((current) => current && { ...current, from: current.to, to: current.from }),
  };
}
export type Comparing = ReturnType<typeof useComparison>;
