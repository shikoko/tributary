// Git LFS: file locks, big files, local copies, and whether it works here.
import { invoke } from "@tauri-apps/api/core";
import type { FileChecks, LargeFile, LfsFolder, LfsHealth, LfsSettings, LfsStorage, Lock, Locks, MetaProblem, NameProblem } from "./generated";
export type { FileChecks, LargeFile, LfsFolder, LfsHealth, LfsSettings, LfsStorage, Lock, Locks, MetaProblem, NameProblem };

/** The files locked with Git LFS (asks the server, so it can take a moment). */
export function lfsLocks(path: string): Promise<Locks> {
  return invoke<Locks>("lfs_locks", { path });
}

/** `deleted`: the deleted files too, for Unity's `.meta` files left behind. */
export function fileChecks(path: string, files: string[], threshold: number, deleted: string[] = []): Promise<FileChecks> {
  return invoke<FileChecks>("file_checks", { path, files, threshold, deleted });
}

export function lfsSettings(path: string): Promise<LfsSettings> {
  return invoke<LfsSettings>("lfs_settings", { path });
}

/** Null when the repository doesn't use Git LFS. */
export function lfsStorage(path: string): Promise<LfsStorage | null> {
  return invoke<LfsStorage | null>("lfs_storage", { path });
}

/** Null when the repository doesn't use Git LFS. */
export function lfsHealth(path: string): Promise<LfsHealth | null> {
  return invoke<LfsHealth | null>("lfs_health", { path });
}
