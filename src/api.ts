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
}

export type OperationKind = "merge" | "rebase" | "cherryPick" | "revert" | "other";

export interface Operation {
  kind: OperationKind;
  /** The commit message git prepared, for a merge, cherry-pick or revert. */
  message: string | null;
  /** For a rebase: the branch being rebased (HEAD is detached while it runs). */
  branch: string | null;
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
): Promise<RepoSnapshot> {
  return invoke<RepoSnapshot>("open_repository", { path, limit, includeStatus, firstParent });
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
  | { kind: "renameBranch"; name: string; newName: string }
  | { kind: "merge"; target: string }
  | { kind: "rebase"; onto: string }
  | { kind: "cherryPick"; id: string }
  | { kind: "revert"; id: string }
  | { kind: "continueOperation" }
  | { kind: "skipCommit" }
  | { kind: "abortOperation" };

/** How far a fetch, pull or push has got. */
export interface Progress {
  /** Like "Receiving objects". */
  phase: string;
  percent: number | null;
}

/** Stop the fetch, pull or push that is running. */
export function cancelAction(): Promise<boolean> {
  return invoke<boolean>("cancel_action");
}

/** Calls `handler` with progress updates; resolves to a function that stops listening. */
export function onProgress(handler: (progress: Progress) => void): Promise<() => void> {
  return listen<Progress>("action-progress", (event) => handler(event.payload));
}

/** Run `action`; resolves to a short message saying what happened. */
export function runAction(path: string, action: Action): Promise<string> {
  return invoke<string>("run_action", { path, action });
}

export function commitDetails(path: string, id: string): Promise<CommitDetails> {
  return invoke<CommitDetails>("commit_details", { path, id });
}
