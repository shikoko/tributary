import type { CommitRow, DiffSource, FileChange, WorktreeStatus } from "../api";
import { shortId } from "./format";

/** A file's change to show: which file, and against what. */
export interface DiffTarget {
  file: FileChange;
  source: DiffSource;
  /** Like "In 1a2b3c4" or "Staged". */
  label: string;
}

/** The commit a file's changes are from, among the list's commits, and the way to the one before or after it. */
export interface CommitSteps {
  commit: CommitRow;
  /** Its place in the list, from 0 (the newest). */
  position: number;
  /** How many commits the list has, and whether there are more not loaded yet. */
  total: number;
  more: boolean;
  /** The same file in the newer (-1) or older (1) commit, or else that commit's first file. */
  onStep: (delta: 1 | -1) => void;
}

/** Untracked folders ("dir/") are listed whole: there's no one file to show. */
const showable = (file: FileChange) => !file.path.endsWith("/");

/** The highlighted files first (like those in a highlighted file's history), keeping the order otherwise. */
export function highlightedFirst(files: FileChange[], isHighlighted?: (path: string) => boolean): FileChange[] {
  if (!isHighlighted) return files;
  const hit = (file: FileChange) => isHighlighted(file.path) || (file.oldPath !== null && isHighlighted(file.oldPath));
  return [...files.filter(hit), ...files.filter((file) => !hit(file))];
}

/** A commit's (or stash's) files, in the order they're listed. */
export function commitTargets(id: string, files: FileChange[], stash = false): DiffTarget[] {
  const label = stash ? "In the stash" : `In ${shortId(id)}`;
  return files.filter(showable).map((file) => ({ file, source: { kind: "commit", id }, label }));
}

/** The files that differ between two commits, from `from` to `to`; labelled like "main → feature". */
export function rangeTargets(from: string, to: string, files: FileChange[], label: string): DiffTarget[] {
  return files.filter(showable).map((file) => ({ file, source: { kind: "range", from, to }, label }));
}

/** Your changes in the order the panel lists them: conflicts, staged, then the rest. */
export function worktreeTargets(status: WorktreeStatus | null | undefined): DiffTarget[] {
  if (!status) return [];
  const conflicted = status.unstaged.filter((file) => file.status === "conflicted");
  const unstaged = status.unstaged.filter((file) => file.status !== "conflicted");
  return [
    ...conflicted.filter(showable).map((file) => ({ file, source: { kind: "unstaged" } as DiffSource, label: "Conflicted" })),
    ...status.staged.filter(showable).map((file) => ({ file, source: { kind: "staged" } as DiffSource, label: "Staged" })),
    ...unstaged.filter(showable).map((file) => ({ file, source: { kind: "unstaged" } as DiffSource, label: file.status === "untracked" ? "New, not staged" : "Not staged" })),
  ];
}

const sameSource = (a: DiffSource, b: DiffSource) =>
  a.kind === "commit"
    ? b.kind === "commit" && a.id === b.id
    : a.kind === "range"
      ? b.kind === "range" && a.from === b.from && a.to === b.to
      : a.kind === b.kind;

/**
 * Where `path` (shown from `source`) is among `targets`. A file you just staged or unstaged
 * is found on its other side, so the view follows it; -1 once it's gone.
 */
export function findTarget(targets: DiffTarget[], source: DiffSource, path: string): number {
  const exact = targets.findIndex((target) => target.file.path === path && sameSource(target.source, source));
  return exact >= 0 ? exact : targets.findIndex((target) => target.file.path === path);
}

/** The file whose changes are shown, and against what. */
export interface ShownDiff {
  source: DiffSource;
  path: string;
}

/** Whether a file in a list (from `source`) is the one being shown. */
export function isShown(shown: ShownDiff | null, source: DiffSource, path: string): boolean {
  return shown !== null && shown.path === path && sameSource(shown.source, source);
}
