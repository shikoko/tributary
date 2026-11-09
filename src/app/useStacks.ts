import { useEffect, useState } from "react";
import { branchStacks, type RepoSnapshot, type Stacked } from "../api";

/**
 * Which local branches are built on other unmerged ones (stacked), by branch name. Asked
 * again when a branch moves.
 */
export function useStacks(snapshot: RepoSnapshot): Map<string, Stacked> {
  const [stacks, setStacks] = useState<Map<string, Stacked>>(new Map());
  // Where each branch points: a new commit, a rebase or a fetch changes it.
  const signature = snapshot.commits
    .flatMap((commit) => commit.refs.filter((ref) => ref.kind === "branch").map((ref) => `${ref.name}@${commit.id}`))
    .join("\n");
  useEffect(() => {
    let current = true;
    branchStacks(snapshot.path)
      .then((found) => current && setStacks(new Map(found.map((stacked) => [stacked.branch, stacked]))))
      .catch(() => current && setStacks(new Map()));
    return () => {
      current = false;
    };
    // The signature stands for where the branches are.
  }, [snapshot.path, signature]);
  return stacks;
}
