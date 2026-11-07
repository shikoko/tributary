import type { CommitRow } from "../api";

/** How a click changes the selection: a range from the last one, or adding / removing one. */
export interface SelectHow {
  /** Shift: select everything between the last commit chosen and this one. */
  extend?: boolean;
  /** ⌘ or Ctrl: add this commit to the selection, or take it out. */
  toggle?: boolean;
}

export interface Selection {
  /** The commit (or uncommitted changes) shown in the details panel. */
  selectedId: string | null;
  /** Several commits, when more than one is selected. */
  ids: string[] | null;
  /** Where a shift-click range starts. */
  anchor: string | null;
}

export const NO_SELECTION: Selection = { selectedId: null, ids: null, anchor: null };

/** The selection after choosing `id` (or nothing) in the list of `commits`. */
export function selectCommit(
  current: Selection,
  id: string | null,
  how: SelectHow,
  commits: CommitRow[],
  indexById: Map<string, number>,
): Selection {
  if (!id) return { ...current, selectedId: null, ids: null };
  const selectable = (commitId: string) => {
    const index = indexById.get(commitId);
    return index !== undefined && commits[index].kind !== "worktree";
  };
  const { anchor } = current;
  if (how.extend && anchor && anchor !== id && selectable(id) && selectable(anchor)) {
    const [from, to] = [indexById.get(anchor)!, indexById.get(id)!].sort((a, b) => a - b);
    const range = commits
      .slice(from, to + 1)
      .filter((commit) => commit.kind !== "worktree")
      .map((commit) => commit.id);
    return { selectedId: id, ids: range.length > 1 ? range : null, anchor };
  }
  if (how.toggle && selectable(id)) {
    const base = current.ids ?? (current.selectedId && selectable(current.selectedId) ? [current.selectedId] : []);
    const next = base.includes(id) ? base.filter((other) => other !== id) : [...base, id];
    return {
      selectedId: next.includes(id) ? id : (next[next.length - 1] ?? null),
      ids: next.length > 1 ? next : null,
      anchor: id,
    };
  }
  return { selectedId: id, ids: null, anchor: id };
}
