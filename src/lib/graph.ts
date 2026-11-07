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
