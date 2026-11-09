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
  /** New files whose names will cause trouble on Windows or macOS. */
  names: NameProblem[];
}

/** A new file whose name won't work on everyone's computer. */
export interface NameProblem {
  path: string;
  /**
   * caseClash: another file or folder has the same name but for capitals (`detail`: its path);
   * reserved: a name Windows keeps for devices, like CON (`detail`: the name);
   * character: a character Windows doesn't allow (`detail`: it);
   * trailingDot: a name ending in a dot or space (`detail`: the name);
   * tooLong: a long path (`detail`: its length).
   */
  problem: "caseClash" | "reserved" | "character" | "trailingDot" | "tooLong";
  detail: string;
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

/** Which files a repository stores with Git LFS, and which big ones it could. */
export interface LfsSettings {
  /** Git LFS is installed on this computer. */
  installed: boolean;
  /** The patterns stored with it, like "*.psd". */
  patterns: string[];
  /** Kinds of big files here that aren't, biggest first. */
  suggestions: { pattern: string; files: number; bytes: number }[];
  /** Download only the Git LFS files in these folders (or matching these patterns)… */
  fetchInclude: string[];
  /** …and not those in these. */
  fetchExclude: string[];
  /** The folders with files stored with Git LFS, biggest first. */
  folders: LfsFolder[];
}

/** A folder with files stored with Git LFS: how many, how big (their latest versions), and how many are downloaded. */
export interface LfsFolder {
  path: string;
  files: number;
  bytes: number;
  downloaded: number;
}

export function lfsSettings(path: string): Promise<LfsSettings> {
  return invoke<LfsSettings>("lfs_settings", { path });
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
