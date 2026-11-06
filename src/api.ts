import { invoke } from "@tauri-apps/api/core";

export type RefKind = "head" | "branch" | "remote" | "tag";

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
 */
export type GraphLine = [0 | 1 | 2, number, number];

export interface GraphRow {
  column: number;
  lines: GraphLine[];
}

export interface CommitRow {
  id: string;
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
  commits: CommitRow[];
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

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied";

export interface FileChange {
  path: string;
  oldPath: string | null;
  status: FileStatus;
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

export function openRepository(path: string, limit = PAGE_SIZE): Promise<RepoSnapshot> {
  return invoke<RepoSnapshot>("open_repository", { path, limit });
}

export function commitDetails(path: string, id: string): Promise<CommitDetails> {
  return invoke<CommitDetails>("commit_details", { path, id });
}
