import { useMemo } from "react";
import type { CommitRow, RepoSnapshot } from "../api";
import type { BranchSync } from "../lib/branchSync";
import { ancestors, countMissing } from "../lib/graph";

/**
 * How far branches are ahead of and behind their upstreams: the checked-out one (for the
 * toolbar and status bar) and every local branch (for the sidebar and the graph's labels).
 * git counts them over the whole history (on each branch's label); among the loaded
 * commits is the fallback, when it didn't.
 */
export function useBranchCounts(snapshot: RepoSnapshot | null, byId: Map<string, CommitRow>) {
  const headHistory = useMemo(() => ancestors(snapshot?.headCommit, byId), [snapshot, byId]);
  const { ahead, behind } = useMemo(() => {
    if (!snapshot?.upstream?.commit || !snapshot.headCommit) return { ahead: 0, behind: 0 };
    const label = snapshot.commits.find((commit) => commit.id === snapshot.headCommit)?.refs.find((ref) => ref.kind === "branch" && ref.current);
    if (label?.ahead !== undefined && label.behind !== undefined) return { ahead: label.ahead, behind: label.behind };
    const remote = ancestors(snapshot.upstream.commit, byId);
    return { ahead: countMissing(headHistory, remote), behind: countMissing(remote, headHistory) };
  }, [snapshot, byId, headHistory]);

  const aheadBehind = useMemo(() => {
    const result = new Map<string, BranchSync>();
    if (!snapshot) return result;
    const remoteTips = new Map<string, string>();
    const branches: { name: string; id: string; upstream: string }[] = [];
    for (const commit of snapshot.commits) {
      for (const ref of commit.refs) {
        if (ref.kind === "remote") remoteTips.set(ref.name, commit.id);
        if (ref.kind === "branch" && ref.upstream) {
          if (ref.ahead !== undefined && ref.behind !== undefined) result.set(ref.name, { ahead: ref.ahead, behind: ref.behind, upstream: ref.upstream });
          else branches.push({ name: ref.name, id: commit.id, upstream: ref.upstream });
        }
      }
    }
    for (const branch of branches) {
      const upstreamId = remoteTips.get(branch.upstream);
      if (!upstreamId) continue;
      const local = ancestors(branch.id, byId);
      const remote = ancestors(upstreamId, byId);
      result.set(branch.name, { ahead: countMissing(local, remote), behind: countMissing(remote, local), upstream: branch.upstream });
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
