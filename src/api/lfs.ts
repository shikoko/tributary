// Git LFS: file locks, big files, local copies, and whether it works here.
import { invoke } from "./invoke";
import type { FileChecks, LargeFile, LfsFolder, LfsHealth, LfsSettings, LfsStorage, Lock, Locks, MetaProblem, NameProblem } from "./generated";
export type { FileChecks, LargeFile, LfsFolder, LfsHealth, LfsSettings, LfsStorage, Lock, Locks, MetaProblem, NameProblem };

/** The files locked with Git LFS (asks the server, so it can take a moment). */
export function lfsLocks(path: string): Promise<Locks> {
  return invoke("lfs_locks", { path });
}

/** `deleted`: the deleted files too, for Unity's `.meta` files left behind. */
export function fileChecks(path: string, files: string[], threshold: number, deleted: string[] = []): Promise<FileChecks> {
  return invoke("file_checks", { path, files, threshold, deleted });
}

export function lfsSettings(path: string): Promise<LfsSettings> {
  return invoke("lfs_settings", { path });
}

/** Null when the repository doesn't use Git LFS. */
export function lfsStorage(path: string): Promise<LfsStorage | null> {
  return invoke("lfs_storage", { path });
}

/** Null when the repository doesn't use Git LFS. */
export function lfsHealth(path: string): Promise<LfsHealth | null> {
  return invoke("lfs_health", { path });
}
