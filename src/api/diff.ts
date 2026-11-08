// What changed in a file, line by line or (for images and other binary files) before and after.
import { invoke } from "@tauri-apps/api/core";

/** Which change to a file. */
export type DiffSource =
  /** What a commit changed, compared to its first parent. */
  | { kind: "commit"; id: string }
  /** Staged changes, compared to the last commit. */
  | { kind: "staged" }
  /** Changes not staged yet (new files: compared to nothing). */
  | { kind: "unstaged" };

export interface DiffLine {
  kind: "context" | "added" | "removed";
  /** Line numbers before and after. */
  old: number | null;
  new: number | null;
  text: string;
}

export interface Hunk {
  /** What git says the lines are in, like a function's name. */
  section: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  /** Not text: shown by its sizes (or as images), not line by line. */
  binary: boolean;
  /** Stored with Git LFS. */
  lfs: boolean;
  /** Too long to show line by line. */
  tooLarge: boolean;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  /** In bytes; null where the file doesn't exist. */
  sizeBefore: number | null;
  sizeAfter: number | null;
  /** For images: before and after, as data: URLs. */
  images: { before: string | null; after: string | null } | null;
  /** For a submodule: the commits it moved by. */
  submodule: SubmoduleChange | null;
}

/** A submodule moved from one commit to another. */
export interface SubmoduleChange {
  before: string | null;
  after: string | null;
  /** Its own files have uncommitted changes. */
  dirty: boolean;
  /** The commits it moved forward by, newest first (or back by, when `rewound`). */
  commits: { id: string; summary: string }[];
  rewound: boolean;
  /** There are more commits than listed. */
  more: boolean;
}

export function fileDiff(path: string, source: DiffSource, file: string, oldPath?: string, ignoreWhitespace = false): Promise<FileDiff> {
  return invoke<FileDiff>("file_diff", { path, source, file, oldPath: oldPath ?? null, ignoreWhitespace });
}
