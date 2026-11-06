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
}

/**
 * One line segment inside a graph row, as `[kind, from, to]` columns:
 * - 0: a lane passing straight through the row
 * - 1: a lane coming in from the top and ending in the row's node
 * - 2: a line leaving the row's node towards a parent's lane at the bottom
 *
 * A fourth element of `1` means the line is dashed (it belongs to a stash or to
 * uncommitted changes).
 */
export type GraphLine = [0 | 1 | 2, number, number] | [0 | 1 | 2, number, number, 1];

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
  headBranch: string | null;
  headCommit: string | null;
  /** Commits, plus rows for uncommitted changes and stashes. */
  commits: CommitRow[];
  /** Uncommitted changes, or null when the working tree is clean. */
  worktree: WorktreeStatus | null;
  laneCount: number;
  /** True when the repository has more commits than were loaded. */
  truncated: boolean;
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
export function openRepository(path: string, limit = PAGE_SIZE, includeStatus = true): Promise<RepoSnapshot> {
  return invoke<RepoSnapshot>("open_repository", { path, limit, includeStatus });
}

export function commitDetails(path: string, id: string): Promise<CommitDetails> {
  return invoke<CommitDetails>("commit_details", { path, id });
}
