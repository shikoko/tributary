// Cleaning up branches, and putting them back: prune candidates, backups and lost commits.
import { invoke } from "./invoke";
import type {
  Backup,
  BackupEvent,
  BranchTip,
  CommitBrief,
  LostCommits,
  PruneCandidate,
  PruneInfo,
  RemoteBranchChoice,
  UnseenCommit,
  UnseenCommits,
  UpstreamChoices,
} from "./generated";
export type { Backup, BackupEvent, BranchTip, CommitBrief, LostCommits, PruneCandidate, PruneInfo, RemoteBranchChoice, UnseenCommit, UnseenCommits, UpstreamChoices };

/** Backups from the last 30 days, newest first. */
export function branchBackups(path: string): Promise<Backup[]> {
  return invoke("branch_backups", { path });
}

/** What deleting `reference` ("refs/heads/…" or "refs/remotes/…") would lose. */
export function lostCommits(path: string, reference: string): Promise<LostCommits> {
  return invoke("lost_commits", { path, reference });
}

/**
 * What someone else pushed to `reference` (a remote branch: "origin/main") that the
 * checked-out branch doesn't have, leaving out what was on it at `since`.
 */
export function unseenCommits(path: string, reference: string, since: string | null): Promise<UnseenCommits> {
  return invoke("unseen_commits", { path, reference, since });
}

/**
 * Local branches that could be pruned: gone from the remote, merged, or with `idleDays`, with
 * no commits for that long. Changes nothing.
 */
export function pruneCandidates(path: string, idleDays: number | null = null): Promise<PruneInfo> {
  return invoke("prune_candidates", { path, idleDays });
}

/** What `branch`, whose remote branch is gone (renamed or deleted on the remote), could go with instead. */
export function upstreamChoices(path: string, branch: string): Promise<UpstreamChoices> {
  return invoke("upstream_choices", { path, branch });
}
