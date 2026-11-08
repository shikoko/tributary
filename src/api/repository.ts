// Reading a repository: its history and graph, refs, uncommitted changes and commit details.
import { invoke } from "@tauri-apps/api/core";

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

/** The name and email address commits are made with (`user.name`, `user.email`). */
export interface Identity {
  name: string | null;
  email: string | null;
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
  user: Identity | null;
  /** When the repository was last fetched from, in seconds since the Unix epoch. */
  lastFetched: number | null;
  /** Local branches whose remote branch was deleted (usually merged pull requests). */
  goneBranches: string[];
  /** After a squash merge: the message prepared for committing it. */
  squashMessage: string | null;
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

export function commitDetails(path: string, id: string): Promise<CommitDetails> {
  return invoke<CommitDetails>("commit_details", { path, id });
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

/** A working tree of the repository: the main one, or one linked with `git worktree add`. */
export interface Worktree {
  path: string;
  /** The checked-out branch, or null when HEAD is detached. */
  branch: string | null;
  head: string | null;
  main: boolean;
  /** The one that's open. */
  current: boolean;
  locked: boolean;
  /** Its folder is gone. */
  prunable: boolean;
}

export function worktrees(path: string): Promise<Worktree[]> {
  return invoke<Worktree[]>("worktrees", { path });
}

/** Something that moved HEAD: a commit, checkout, reset, rebase, … */
export interface ReflogEntry {
  id: string;
  previous: string | null;
  /** As git wrote it, like "reset: moving to HEAD~2". */
  message: string;
  /** Seconds since the Unix epoch. */
  time: number;
  summary: string;
  authorName: string;
}

export function reflog(path: string, limit?: number): Promise<ReflogEntry[]> {
  return invoke<ReflogEntry[]>("reflog", { path, limit });
}

/** Where the remote branches point, and which one the checked-out branch tracks. */
export interface RemoteState {
  tips: Record<string, string>;
  upstream: string | null;
  remotes: string[];
}

export function remoteState(path: string): Promise<RemoteState> {
  return invoke<RemoteState>("remote_state", { path });
}

export function commitsBetween(path: string, from: string, to: string): Promise<{ count: number; authors: string[] }> {
  return invoke("commits_between", { path, from, to });
}

/** The latest change to a file on another branch. */
export interface OtherChange {
  /** Like "origin/art/lighting" or "feature/tags". */
  branch: string;
  commit: string;
  summary: string;
  author: string;
  /** Seconds since the Unix epoch. */
  time: number;
}

/** A file you're working on that another branch also changed since yours split off from it. */
export interface Overlap {
  path: string;
  /** It can't be merged (Git LFS, lockable or binary): one version will have to win. */
  unmergeable: boolean;
  /** Your change is uncommitted (otherwise it's in a commit on your branch). */
  uncommitted: boolean;
  /** The other branches' latest changes to it, newest first. */
  elsewhere: OtherChange[];
}

/** Of `changed` (your uncommitted changes) and your branch's own changes: the files recently changed branches also changed. */
export function changedElsewhere(path: string, changed: string[]): Promise<Overlap[]> {
  return invoke<Overlap[]>("changed_elsewhere", { path, changed });
}
