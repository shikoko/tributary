// Cleaning up branches, and putting them back: prune candidates, backups and lost commits.
import { invoke } from "@tauri-apps/api/core";

/** A local branch, where it points, and (to restore it) its upstream configuration. */
export interface BranchTip {
  name: string;
  id: string;
  remote?: string | null;
  merge?: string | null;
}

/** A local branch that could be pruned. */
export interface PruneCandidate {
  name: string;
  id: string;
  summary: string;
  time: number;
  /** Like "origin/feat/x". */
  upstream: string | null;
  /** Its remote branch was deleted. */
  gone: boolean;
  /** All its commits are in the base branch. */
  merged: boolean;
  /** Commits not in the base branch. */
  unmerged: number;
  remote: string | null;
  merge: string | null;
}

export interface PruneInfo {
  /** What "merged" means: merged into this, like "origin/main". */
  base: string | null;
  candidates: PruneCandidate[];
}

/** What happened to a branch that Tributary kept a backup of. */
export type BackupEvent = "deleted" | "deletedFromRemote" | "forcePushed" | "reset" | "rebased";

/** Where a branch was before Tributary deleted, reset, rebased or force-pushed it. */
export interface Backup {
  reference: string;
  event: BackupEvent;
  /** "feat/x", or "origin/feat/x" for a remote branch. */
  name: string;
  remote: boolean;
  id: string;
  summary: string;
  /** When the backup was made (seconds). */
  time: number;
  /** Where the branch points now, or null if it's gone. */
  current: string | null;
}

/** Backups from the last 30 days, newest first. */
export function branchBackups(path: string): Promise<Backup[]> {
  return invoke<Backup[]>("branch_backups", { path });
}

export interface CommitBrief {
  id: string;
  summary: string;
  time: number;
}

/** Commits on a branch that are on no other branch, remote branch or tag. */
export interface LostCommits {
  count: number;
  /** The newest few. */
  commits: CommitBrief[];
}

/** What deleting `reference` ("refs/heads/…" or "refs/remotes/…") would lose. */
export function lostCommits(path: string, reference: string): Promise<LostCommits> {
  return invoke<LostCommits>("lost_commits", { path, reference });
}

/** Local branches that could be pruned: gone from the remote, or merged. Changes nothing. */
export function pruneCandidates(path: string): Promise<PruneInfo> {
  return invoke<PruneInfo>("prune_candidates", { path });
}
