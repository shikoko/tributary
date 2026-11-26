import { createContext } from "react";
import type { Rebased } from "../api";
import { plural } from "./format";

/**
 * How far a local branch is ahead of and behind the remote branch it tracks: along each
 * one's own line, so a merged pull request counts once.
 */
export interface BranchSync {
  ahead: number;
  behind: number;
  /** Every commit, as git counts them (more than the above when merges brought some in). */
  aheadCommits?: number;
  behindCommits?: number;
  /** Like "origin/main". */
  upstream: string;
  /** Diverged, as its upstream was rebased elsewhere with some of its commits. */
  rebased?: Rebased;
}

/** Local branches' counts by name, for their labels in the graph. */
export const BranchSyncContext = createContext<Map<string, BranchSync>>(new Map());

/** "3 commits", or "1 change (2 commits)" when merges brought in more commits than that. */
export function describeCount(count: number, commits?: number): string {
  return commits !== undefined && commits > count ? `${plural(count, "change")} (${plural(commits, "commit")})` : plural(count, "commit");
}

/** "1 commit behind origin/main", "2 commits ahead of and 3 behind origin/main", or null when level. */
export function describeSync({ ahead, behind, aheadCommits, behindCommits, upstream }: BranchSync): string | null {
  if (ahead > 0 && behind > 0) {
    // "2 commits ahead of and 5 behind": the second count's word only when it isn't "commits".
    const second = behindCommits !== undefined && behindCommits > behind ? describeCount(behind, behindCommits) : String(behind);
    return `${describeCount(ahead, aheadCommits)} ahead of and ${second} behind ${upstream}`;
  }
  if (ahead > 0) return `${describeCount(ahead, aheadCommits)} ahead of ${upstream} (not pushed yet)`;
  if (behind > 0) return `${describeCount(behind, behindCommits)} behind ${upstream} (pull to bring them in)`;
  return null;
}

/**
 * What the rebased mark on a branch says: its upstream was rebased elsewhere with its
 * commits, and how to take that version (null when it wasn't).
 */
export function describeRebased({ rebased, upstream }: BranchSync): string | null {
  if (!rebased) return null;
  const { inUpstream, onlyHere } = rebased;
  const there =
    onlyHere === 0
      ? `${inUpstream === 1 ? "your commit is" : `all ${inUpstream} of your commits are`} in its version`
      : `${inUpstream} of your commits ${inUpstream === 1 ? "is" : "are"} in its version, and ${onlyHere} ${onlyHere === 1 ? "isn't" : "aren't"}`;
  return `Rebased on ${upstream}: ${there}. Double-click ${upstream} to take it.`;
}
