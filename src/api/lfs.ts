// Git LFS: file locks, big files, local copies, and whether it works here.
import { invoke } from "@tauri-apps/api/core";

/** A file locked with Git LFS. */
export interface Lock {
  id: string;
  /** Relative to the repository's root. */
  path: string;
  /** Who holds it: their name on the server (on GitHub, their username). */
  owner: string;
  /** Like "2026-05-17T15:49:06Z". */
  lockedAt: string | null;
  mine: boolean;
}

export interface Locks {
  /** The repository uses Git LFS and its server supports locking. */
  supported: boolean;
  /** Yours first. */
  locks: Lock[];
  /** Why the locks couldn't be listed this time. */
  error: string | null;
}

/** The files locked with Git LFS (asks the server, so it can take a moment). */
export function lfsLocks(path: string): Promise<Locks> {
  return invoke<Locks>("lfs_locks", { path });
}

/** A big file that isn't stored with Git LFS. */
export interface LargeFile {
  path: string;
  /** In bytes. */
  size: number;
}

/** Changed files to look at before committing. */
export interface FileChecks {
  /** Big files that aren't stored with Git LFS. */
  large: LargeFile[];
  /** Files marked lockable. */
  lockable: string[];
  usesLfs: boolean;
}

export function fileChecks(path: string, files: string[], threshold: number): Promise<FileChecks> {
  return invoke<FileChecks>("file_checks", { path, files, threshold });
}

/** The Git LFS files kept on this computer. */
export interface LfsStorage {
  bytes: number;
  files: number;
  folder: string;
}

/** Null when the repository doesn't use Git LFS. */
export function lfsStorage(path: string): Promise<LfsStorage | null> {
  return invoke<LfsStorage | null>("lfs_storage", { path });
}

/** What's wrong with Git LFS in a repository that uses it, if anything. */
export interface LfsHealth {
  /** Git LFS isn't installed: its files are pointer files, and locking doesn't work. */
  notInstalled: boolean;
  /** Installed, but git doesn't use it (`git lfs install` was never run). */
  notSetUp: boolean;
  /** Files whose contents weren't downloaded: they're still small pointer files. */
  pointers: number;
  /** A few of those. */
  examples: string[];
}

/** Null when the repository doesn't use Git LFS. */
export function lfsHealth(path: string): Promise<LfsHealth | null> {
  return invoke<LfsHealth | null>("lfs_health", { path });
}
