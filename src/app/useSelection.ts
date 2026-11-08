import { useCallback, useMemo, useRef, useState } from "react";
import type { CommitRow, RepoSnapshot } from "../api";
import { selectCommit, type SelectHow } from "../lib/selection";
import type { LoadMode } from "./useRepository";

/** The selected commit (shown in the details panel), or several selected commits. */
export function useSelection(commits: CommitRow[] | undefined) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** When several commits are selected: all of them, in the order they were added. */
  const [selection, setSelection] = useState<string[] | null>(null);
  /** Where a shift-click selection starts. */
  const anchor = useRef<string | null>(null);

  const indexById = useMemo(() => new Map((commits ?? []).map((commit, index) => [commit.id, index])), [commits]);
  const byId = useMemo(() => new Map((commits ?? []).map((commit) => [commit.id, commit])), [commits]);
  const selectedIndex = selectedId ? indexById.get(selectedId) : undefined;
  const selected = selectedIndex !== undefined ? commits?.[selectedIndex] : undefined;
  const selectedIds = useMemo(() => (selection ? new Set(selection) : null), [selection]);
  /** The selected commits in list order, newest first. */
  const selectedCommits = useMemo(
    () => (selection && commits ? commits.filter((commit) => selection.includes(commit.id)) : []),
    [selection, commits],
  );

  /** Select a commit: alone, a range from the last one (shift), or adding / removing it (⌘ or Ctrl). */
  const select = useCallback(
    (id: string | null, how: SelectHow = {}) => {
      const next = selectCommit({ selectedId, ids: selection, anchor: anchor.current }, id, how, commits ?? [], indexById);
      anchor.current = next.anchor;
      setSelectedId(next.selectedId);
      setSelection(next.ids);
    },
    [commits, indexById, selectedId, selection],
  );

  /**
   * The repository was (re)loaded: keep what's selected if it's still there (not when
   * opening), otherwise select the checked-out commit, or the newest.
   */
  const keep = useCallback((next: RepoSnapshot, mode: LoadMode) => {
    const loaded = (id: string | null) => (id && next.commits.some((c) => c.id === id) ? id : null);
    setSelectedId((current) => (mode !== "open" && loaded(current)) || loaded(next.headCommit) || next.commits[0]?.id || null);
    setSelection((current) => {
      const still = current?.filter((id) => next.commits.some((c) => c.id === id)) ?? [];
      return mode !== "open" && still.length > 1 ? still : null;
    });
  }, []);

  /** Esc: drop a multiple selection, or else close the details. */
  const clearStep = () => (selection ? setSelection(null) : setSelectedId(null));

  const clear = useCallback(() => {
    setSelectedId(null);
    setSelection(null);
  }, []);

  return {
    selectedId,
    setSelectedId,
    selectedIndex,
    selected,
    selectedIds,
    selectedCommits,
    /** More than one commit is selected. */
    multi: selectedCommits.length > 1,
    indexById,
    byId,
    select,
    keep,
    clear,
    clearStep,
    dropMultiple: () => setSelection(null),
  };
}

export type Selection = ReturnType<typeof useSelection>;
