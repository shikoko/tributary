import { createContext } from "react";
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
