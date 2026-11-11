// Cleaning up branches, and putting them back: prune candidates, backups and lost commits.
import { invoke } from "@tauri-apps/api/core";
import type { Backup, BackupEvent, BranchTip, CommitBrief, LostCommits, PruneCandidate, PruneInfo } from "./generated";
export type { Backup, BackupEvent, BranchTip, CommitBrief, LostCommits, PruneCandidate, PruneInfo };

/** Backups from the last 30 days, newest first. */
export function branchBackups(path: string): Promise<Backup[]> {
  return invoke<Backup[]>("branch_backups", { path });
}

/** What deleting `reference` ("refs/heads/…" or "refs/remotes/…") would lose. */
export function lostCommits(path: string, reference: string): Promise<LostCommits> {
  return invoke<LostCommits>("lost_commits", { path, reference });
}

/** Local branches that could be pruned: gone from the remote, or merged. Changes nothing. */
export function pruneCandidates(path: string): Promise<PruneInfo> {
  return invoke<PruneInfo>("prune_candidates", { path });
}
