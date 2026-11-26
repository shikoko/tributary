// Cleaning up branches, and putting them back: prune candidates, backups and lost commits.
import { invoke } from "./invoke";
import type {
  Backup,
  BackupEvent,
  BranchTip,
  BranchToPush,
  BranchesToPush,
  CommitBrief,
  LostCommits,
  MoveCheck,
  PruneCandidate,
  PruneInfo,
  PushReason,
  Rebased,
  RebasedCommit,
  RebasedUpstream,
  RememberedBranch,
  RememberedChoice,
  RemoteBranchChoice,
  TagToPush,
  TagsToPush,
  UnseenCommit,
  UnseenCommits,
  UpstreamChoices,
} from "./generated";
export type {
  Backup,
  BackupEvent,
  BranchTip,
  BranchToPush,
  BranchesToPush,
  CommitBrief,
  LostCommits,
  MoveCheck,
  PruneCandidate,
  PruneInfo,
  PushReason,
  Rebased,
  RebasedCommit,
  RebasedUpstream,
  RememberedBranch,
  RememberedChoice,
  RemoteBranchChoice,
  TagToPush,
  TagsToPush,
  UnseenCommit,
  UnseenCommits,
  UpstreamChoices,
};

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

/** The tags here that `remote` (the default remote when `null`) doesn't have yet: asked over the network. */
export function tagsToPush(path: string, remote: string | null = null): Promise<TagsToPush> {
  return invoke("tags_to_push", { path, remote });
}

/** The branches with commits the remote (the default one when none is given) doesn't have, asked of it (or, unreachable, as of the last fetch). */
export function branchesToPush(path: string, remote: string | null = null): Promise<BranchesToPush> {
  return invoke("branches_to_push", { path, remote });
}

/** Branches a fetch set aside: the remote no longer has them, and their work is nowhere else here. */
export function setAsideBranches(path: string): Promise<RememberedBranch[]> {
  return invoke("set_aside_branches", { path });
}

/** Whether `branch`'s remote branch was rebased elsewhere with its commits: each of them, and its version there (null when it hasn't diverged, or none are there). */
export function rebasedUpstream(path: string, branch: string): Promise<RebasedUpstream | null> {
  return invoke("rebased_upstream", { path, branch });
}

/** Before a remote moves to `url`: which of its remembered branches the new address doesn't have, with work found nowhere else. */
export function moveCheck(path: string, remote: string, url: string): Promise<MoveCheck> {
  return invoke("move_check", { path, remote, url });
}
