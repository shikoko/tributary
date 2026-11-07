import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type RefKind = "head" | "branch" | "remote" | "tag" | "stash";

/** What a row in the graph stands for. */
export type RowKind = "commit" | "stash" | "worktree";

/** The id of the row for uncommitted changes. */
export const WORKTREE_ID = "worktree";

export interface RefLabel {
  name: string;
  kind: RefKind;
  /** True for the branch that is checked out. */
  current: boolean;
  /** For a local branch: the remote branch it tracks, like "origin/main". */
  upstream?: string;
  /** For an annotated tag: the id of the tag object (the label sits on its commit). */
  target?: string;
}

/** The full name of a branch, remote branch or tag, like "refs/heads/main". */
export function fullRefName(ref: { kind: RefKind; name: string }): string | null {
  switch (ref.kind) {
    case "branch":
      return `refs/heads/${ref.name}`;
    case "remote":
      return `refs/remotes/${ref.name}`;
    case "tag":
      return `refs/tags/${ref.name}`;
    default:
      return null;
  }
}

/**
 * One line segment inside a graph row, as `[kind, from, to]` columns:
 * - 0: a lane passing straight through the row
 * - 1: a lane coming in from the top and ending in the row's node
 * - 2: a line leaving the row's node towards a parent's lane at the bottom
 *
 * The fourth element is the row of the commit whose parent link this line draws (a
 * list of rows when several links share the lane). A fifth element of `1` means the
 * line is dashed (it belongs to a stash or to uncommitted changes).
 */
export type GraphLine =
  | [0 | 1 | 2, number, number, number | number[]]
  | [0 | 1 | 2, number, number, number | number[], 1];

export interface GraphRow {
  column: number;
  lines: GraphLine[];
}

export interface CommitRow {
  /** The commit id, or WORKTREE_ID for uncommitted changes. */
  id: string;
  kind: RowKind;
  summary: string;
  authorName: string;
  authorEmail: string;
  /** Author time in seconds since the Unix epoch. */
  time: number;
  /** Commit time in seconds since the Unix epoch. */
  commitTime: number;
  parents: string[];
  refs: RefLabel[];
  graph: GraphRow;
}

export interface RepoSnapshot {
  path: string;
  name: string;
  /** True for a repository without a working tree. */
  bare: boolean;
  headBranch: string | null;
  /** The remote branch the checked-out branch pulls from, if it has one. */
  upstream: Upstream | null;
  /** Names of the configured remotes, like "origin". */
  remotes: string[];
  /** A merge, rebase, cherry-pick or revert that stopped, usually because of conflicts. */
  operation: Operation | null;
  /** Only the checked-out branch's own history (first parents) was loaded. */
  firstParent: boolean;
  headCommit: string | null;
  /** Commits, plus rows for uncommitted changes and stashes. */
  commits: CommitRow[];
  /** Uncommitted changes, or null when the working tree is clean. */
  worktree: WorktreeStatus | null;
  laneCount: number;
  /** True when the repository has more commits than were loaded. */
  truncated: boolean;
  /** Branches, remote branches and tags left out of the graph (hidden, or not soloed). */
  hiddenRefs: HiddenRef[];
  /** Remotes whose repository has a web page. */
  webRemotes: WebRemote[];
  /** The name and email commits are made with here. */
  user: { name: string | null; email: string | null } | null;
  /** When the repository was last fetched from, in seconds since the Unix epoch. */
  lastFetched: number | null;
  /** Local branches whose remote branch was deleted (usually merged pull requests). */
  goneBranches: string[];
}

export interface HiddenRef {
  name: string;
  kind: RefKind;
  /** The commit it points to. */
  commit: string;
  upstream?: string;
}

export type WebHost = "github" | "gitlab" | "bitbucket" | "gitea" | "other";

export interface WebRemote {
  /** Like "origin". */
  name: string;
  host: WebHost;
  /** The repository's page, like "https://github.com/owner/repo". */
  url: string;
}

/** Which branches the graph shows: hidden ones are left out; if any are soloed, only those. */
export interface Visibility {
  hidden: string[];
  solo: string[];
}

export type OperationKind = "merge" | "rebase" | "cherryPick" | "revert" | "other";

export interface Operation {
  kind: OperationKind;
  /** The commit message git prepared, for a merge, cherry-pick or revert. */
  message: string | null;
  /** For a rebase: the branch being rebased (HEAD is detached while it runs). */
  branch: string | null;
  /**
   * The two sides of a conflict: yours (the checked-out branch, or the branch being
   * rebased) and theirs (what's merged, picked, reverted or rebased onto), like "main"
   * and "feat/x" or "commit a1b2c3d".
   */
  mine: string | null;
  theirs: string | null;
}

export interface Upstream {
  /** Like "origin/main". */
  name: string;
  /** Where it points, or null if it hasn't been fetched yet. */
  commit: string | null;
}

export interface Person {
  name: string;
  email: string;
  time: number;
  /** Timezone offset from UTC in seconds. */
  offset: number;
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted";

export interface FileChange {
  path: string;
  oldPath: string | null;
  status: FileStatus;
}

export interface WorktreeStatus {
  /** Changes in the index, compared to HEAD. */
  staged: FileChange[];
  /** Changes in the working tree compared to the index, and untracked files. */
  unstaged: FileChange[];
}

export interface CommitDetails {
  id: string;
  summary: string;
  body: string;
  author: Person;
  committer: Person;
  parents: string[];
  files: FileChange[];
}

/** How many commits are loaded at a time. */
export const PAGE_SIZE = 10_000;

/**
 * Load a repository. Reading uncommitted changes (`includeStatus`) can take a while in
 * large working trees, so the app loads without them first and then again with them.
 */
export function openRepository(
  path: string,
  limit = PAGE_SIZE,
  includeStatus = true,
  firstParent = false,
  visibility: Visibility = { hidden: [], solo: [] },
): Promise<RepoSnapshot> {
  return invoke<RepoSnapshot>("open_repository", {
    path,
    limit,
    includeStatus,
    firstParent,
    hidden: visibility.hidden,
    solo: visibility.solo,
  });
}

/** Something that changes the repository. These run the installed git. */
export type Action =
  | { kind: "resetHard"; id: string }
  | { kind: "checkoutBranch"; name: string }
  | { kind: "checkoutRemoteBranch"; name: string }
  | { kind: "checkoutCommit"; id: string }
  | { kind: "createBranch"; name: string; id: string; checkout: boolean }
  | { kind: "fetch"; background?: boolean }
  | { kind: "pull" }
  | { kind: "push"; force: boolean }
  /** Stash uncommitted changes, run `action`, then put the changes back. */
  | { kind: "stashAndRetry"; action: Action; includeUntracked: boolean }
  | { kind: "stashPush"; message: string | null; includeUntracked: boolean }
  | { kind: "stashApply"; index: number; id: string }
  | { kind: "stashPop"; index: number; id: string }
  | { kind: "stashDrop"; index: number; id: string }
  | { kind: "stage"; paths: string[] }
  | { kind: "unstage"; paths: string[] }
  | { kind: "stageAll" }
  | { kind: "unstageAll" }
  | { kind: "commit"; message: string; amend: boolean }
  | { kind: "resetSoft"; id: string }
  | { kind: "deleteBranch"; name: string; force: boolean }
  | { kind: "deleteRemoteBranch"; name: string }
  /** Prune: delete these branches, each only if it still points at `id`. */
  | { kind: "deleteBranches"; branches: BranchTip[] }
  | { kind: "restoreBranches"; branches: BranchTip[] }
  /** Push a deleted remote branch (like "origin/feat/x") back, at `id`. */
  | { kind: "restoreRemoteBranch"; name: string; id: string }
  | { kind: "restoreBackup"; reference: string }
  | { kind: "removeBackup"; reference: string }
  | { kind: "renameBranch"; name: string; newName: string }
  | { kind: "merge"; target: string }
  | { kind: "rebase"; onto: string }
  | { kind: "cherryPick"; id: string }
  | { kind: "revert"; id: string }
  | { kind: "continueOperation" }
  | { kind: "skipCommit" }
  | { kind: "abortOperation" }
  /** Oldest first. */
  | { kind: "cherryPickMany"; ids: string[] }
  /** Newest first. */
  | { kind: "revertMany"; ids: string[] }
  /** Every commit after `onto` on the checked-out branch, oldest first. */
  | { kind: "interactiveRebase"; onto: string; steps: RebaseStep[] }
  | { kind: "createTag"; name: string; id: string; message: string | null }
  | { kind: "deleteTag"; name: string }
  | { kind: "restoreTag"; name: string; id: string }
  | { kind: "pushTag"; name: string; remote: string | null }
  | { kind: "deleteRemoteTag"; name: string; remote: string }
  /** Take one side's version of whole conflicted files. */
  | { kind: "resolveConflicts"; paths: string[]; keep: "mine" | "theirs" }
  /** Undo resolveConflicts: put the conflicts back. */
  | { kind: "recreateConflicts"; paths: string[] }
  | { kind: "lockFiles"; paths: string[] }
  | { kind: "unlockFiles"; locks: { id: string; path: string }[]; force?: boolean };

export type StepAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export interface RebaseStep {
  id: string;
  action: StepAction;
  /** The new message, for "reword". */
  message?: string;
}

/** What an action did. */
export interface Outcome {
  message: string;
  /** After pushing a new branch: the page the remote suggested for opening a pull request. */
  pullRequest?: string;
}

/** A git command Tributary ran. */
export interface LogEntry {
  id: number;
  /** Milliseconds since the Unix epoch. */
  started: number;
  durationMs: number;
  folder: string;
  /** Everything after `git`. */
  args: string[];
  success: boolean;
  output: string;
  /** Run by Tributary on its own, like the regular background fetch. */
  background: boolean;
}

/** How far a fetch, pull or push has got. */
export interface Progress {
  /** Like "Receiving objects". */
  phase: string;
  percent: number | null;
  /** More about it, like "2 of 5 files · 56 MB of 80 MB · 12 MB/s". */
  detail?: string;
}

/** Stop the fetch, pull, push or clone that is running. */
export function cancelAction(): Promise<boolean> {
  return invoke<boolean>("cancel_action");
}

/** Calls `handler` with progress updates; resolves to a function that stops listening. */
export function onProgress(handler: (progress: Progress) => void): Promise<() => void> {
  return listen<Progress>("action-progress", (event) => handler(event.payload));
}

/** Run `action`; resolves to a short message saying what happened. */
export async function runAction(path: string, action: Action): Promise<string> {
  return (await runActionFor(path, action)).message;
}

/** Like `runAction`, with everything the action reported. */
export function runActionFor(path: string, action: Action): Promise<Outcome> {
  return invoke<Outcome>("run_action", { path, action });
}

/** Clone `url` into a new folder `name` inside `parent`; resolves to the new folder. */
export function cloneRepository(url: string, parent: string, name: string): Promise<string> {
  return invoke<string>("clone_repository", { url, parent, name });
}

/** Create a repository in an existing folder. */
export function initRepository(path: string): Promise<string> {
  return invoke<string>("init_repository", { path });
}

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

/** The git commands Tributary ran recently, oldest first. */
export function activityLog(): Promise<LogEntry[]> {
  return invoke<LogEntry[]>("activity_log");
}

/** Calls `handler` for every git command Tributary runs from now on. */
export function onActivity(handler: (entry: LogEntry) => void): Promise<() => void> {
  return listen<LogEntry>("activity", (event) => handler(event.payload));
}

export function commitDetails(path: string, id: string): Promise<CommitDetails> {
  return invoke<CommitDetails>("commit_details", { path, id });
}

/** A file locked with Git LFS. */
export interface Lock {
  id: string;
  /** Relative to the repository's root. */
  path: string;
  /** Who holds it: their name on the server (on GitHub, their username). */
  owner: string;
  /** Like "2026-05-17T15:49:06Z". */
  lockedAt: string | null;
  mine: boolean;
}

export interface Locks {
  /** The repository uses Git LFS and its server supports locking. */
  supported: boolean;
  /** Yours first. */
  locks: Lock[];
  /** Why the locks couldn't be listed this time. */
  error: string | null;
}

/** The files locked with Git LFS (asks the server, so it can take a moment). */
export function lfsLocks(path: string): Promise<Locks> {
  return invoke<Locks>("lfs_locks", { path });
}

/** The commits that changed a file or folder. */
export interface FileHistory {
  /** Relative to the repository's root, without a trailing slash. */
  path: string;
  folder: boolean;
  /** Newest first. */
  ids: string[];
  /** For a file: every path it had, following renames. */
  names: string[];
  truncated: boolean;
}

/** `file` is relative to the repository's root, or an absolute path inside it. */
export function fileHistory(path: string, file: string): Promise<FileHistory> {
  return invoke<FileHistory>("file_history", { path, file });
}
