import type { CommitRow } from "../api";

/** Ids of the loaded commits reachable from `start` (including it), following parents. */
export function ancestors(start: string | null | undefined, byId: Map<string, CommitRow>): Set<string> {
  const seen = new Set<string>();
  const stack = start ? [start] : [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const commit = byId.get(id);
    if (seen.has(id) || !commit || commit.kind !== "commit") continue;
    seen.add(id);
    stack.push(...commit.parents);
  }
  return seen;
}

/** How many commits `a` has that `b` doesn't. */
export function countMissing(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const id of a) if (!b.has(id)) count++;
  return count;
}

/**
 * The commits after `commit` on the checked-out branch (newest first), which an
 * interactive rebase or a reword would rewrite, or why they can't be.
 */
export function rewritable(
  commit: CommitRow,
  snapshot: { headBranch: string | null; headCommit: string | null; commits: CommitRow[] },
  headHistory: Set<string>,
  byId: Map<string, CommitRow>,
): CommitRow[] | string {
  const branch = snapshot.headBranch;
  if (!branch) return "check out a branch first";
  if (commit.id === snapshot.headCommit) return `${branch} has nothing after this commit`;
  if (!headHistory.has(commit.id)) return `not part of ${branch}`;
  const before = ancestors(commit.id, byId);
  const after = snapshot.commits.filter((c) => headHistory.has(c.id) && !before.has(c.id));
  if (after.some((c) => c.parents.length > 1)) return "the commits after it include merges";
  return after;
}
