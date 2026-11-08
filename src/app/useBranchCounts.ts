import { useMemo } from "react";
import type { CommitRow, RepoSnapshot } from "../api";
import { ancestors, countMissing } from "../lib/graph";

/**
 * How far branches are ahead of and behind their upstreams, among the loaded commits: the
 * checked-out one (for the toolbar and status bar) and every local branch (for the sidebar).
 */
export function useBranchCounts(snapshot: RepoSnapshot | null, byId: Map<string, CommitRow>) {
  const headHistory = useMemo(() => ancestors(snapshot?.headCommit, byId), [snapshot, byId]);
  const { ahead, behind } = useMemo(() => {
    if (!snapshot?.upstream?.commit || !snapshot.headCommit) return { ahead: 0, behind: 0 };
    const remote = ancestors(snapshot.upstream.commit, byId);
    return { ahead: countMissing(headHistory, remote), behind: countMissing(remote, headHistory) };
  }, [snapshot, byId, headHistory]);

  const aheadBehind = useMemo(() => {
    const result = new Map<string, { ahead: number; behind: number }>();
    if (!snapshot) return result;
    const remoteTips = new Map<string, string>();
    const branches: { name: string; id: string; upstream: string }[] = [];
    for (const commit of snapshot.commits) {
      for (const ref of commit.refs) {
        if (ref.kind === "remote") remoteTips.set(ref.name, commit.id);
        if (ref.kind === "branch" && ref.upstream) branches.push({ name: ref.name, id: commit.id, upstream: ref.upstream });
      }
    }
    for (const branch of branches) {
      const upstreamId = remoteTips.get(branch.upstream);
      if (!upstreamId) continue;
      const local = ancestors(branch.id, byId);
      const remote = ancestors(upstreamId, byId);
      result.set(branch.name, { ahead: countMissing(local, remote), behind: countMissing(remote, local) });
    }
    return result;
  }, [snapshot, byId]);

  // Local branch names anywhere in the history, to know which remote branches can be checked out.
  const localBranches = useMemo(
    () =>
      new Set([
        ...(snapshot?.commits ?? []).flatMap((commit) => commit.refs.filter((ref) => ref.kind === "branch").map((ref) => ref.name)),
        ...(snapshot?.hiddenRefs ?? []).filter((ref) => ref.kind === "branch").map((ref) => ref.name),
      ]),
    [snapshot],
  );

  return { headHistory, ahead, behind, aheadBehind, localBranches };
}
export type BranchCounts = ReturnType<typeof useBranchCounts>;
