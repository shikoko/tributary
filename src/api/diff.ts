// What changed in a file: line by line, or (for pictures, sounds, videos, 3D models and other binary files) before and after.
import { invoke } from "./invoke";
import type { Blame, BlameCommit, BlameLine, ConflictText, DiffLine, DiffSource, FileDiff, Hunk, Media, MediaKind, SubmoduleChange } from "./generated";
export type { Blame, BlameCommit, BlameLine, ConflictText, DiffLine, DiffSource, FileDiff, Hunk, Media, MediaKind, SubmoduleChange };

export function fileDiff(path: string, source: DiffSource, file: string, oldPath?: string, ignoreWhitespace = false): Promise<FileDiff> {
  return invoke("file_diff", { path, source, file, oldPath: oldPath ?? null, ignoreWhitespace });
}

export function conflictText(path: string, file: string): Promise<ConflictText> {
  return invoke("conflict_text", { path, file });
}

/** Who changed each line of `file` last: as it is now, or at commit `at`. */
export function blameFile(path: string, file: string, at?: string | null): Promise<Blame> {
  return invoke("blame_file", { path, file, at: at ?? null });
}

// The commits whose Git LFS files were asked for already: each is asked for once.
const lfsAsked = new Set<string>();

/**
 * Download a commit's Git LFS files that aren't here yet (as they are in it, and before it), all
 * at once, in the background: looking through its files then doesn't wait for each to download.
 */
export function prefetchLfs(path: string, commit: string): void {
  const key = `${path}\0${commit}`;
  if (lfsAsked.has(key)) return;
  lfsAsked.add(key);
  // A failure is left to opening the file, which downloads it then; it's asked for again next time.
  invoke("prefetch_lfs", { path, commit }).catch(() => lfsAsked.delete(key));
}
