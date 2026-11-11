// What changed in a file: line by line, or (for pictures, sounds, videos, 3D models and other binary files) before and after.
import { invoke } from "@tauri-apps/api/core";
import type { Blame, BlameCommit, BlameLine, ConflictText, DiffLine, DiffSource, FileDiff, Hunk, Media, MediaKind, SubmoduleChange } from "./generated";
export type { Blame, BlameCommit, BlameLine, ConflictText, DiffLine, DiffSource, FileDiff, Hunk, Media, MediaKind, SubmoduleChange };

export function fileDiff(path: string, source: DiffSource, file: string, oldPath?: string, ignoreWhitespace = false): Promise<FileDiff> {
  return invoke<FileDiff>("file_diff", { path, source, file, oldPath: oldPath ?? null, ignoreWhitespace });
}

export function conflictText(path: string, file: string): Promise<ConflictText> {
  return invoke<ConflictText>("conflict_text", { path, file });
}

/** Who changed each line of `file` last: as it is now, or at commit `at`. */
export function blameFile(path: string, file: string, at?: string | null): Promise<Blame> {
  return invoke<Blame>("blame_file", { path, file, at: at ?? null });
}
