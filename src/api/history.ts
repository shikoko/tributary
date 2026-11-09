import { invoke } from "@tauri-apps/api/core";

/** A local history snapshot of uncommitted work. */
export interface Snapshot {
  reference: string;
  id: string;
  /** When it was taken, in milliseconds since the epoch. */
  time: number;
  /** The files that were changed then, compared with the commit checked out then. */
  files: SnapshotFile[];
}

export interface SnapshotFile {
  path: string;
  change: "added" | "modified" | "deleted";
}

/** Snapshot the uncommitted changes (files up to `maxBytes`), forgetting those older than `keepDays`. */
export function takeSnapshot(path: string, maxBytes: number, keepDays: number): Promise<Snapshot | null> {
  return invoke<Snapshot | null>("take_snapshot", { path, maxBytes, keepDays });
}

/** The snapshots there are, newest first. */
export function localHistory(path: string): Promise<Snapshot[]> {
  return invoke<Snapshot[]>("local_history", { path });
}
