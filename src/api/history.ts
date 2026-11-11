import { invoke } from "@tauri-apps/api/core";
import type { Snapshot, SnapshotFile } from "./generated";
export type { Snapshot, SnapshotFile };

/** Snapshot the uncommitted changes (files up to `maxBytes`), forgetting those older than `keepDays`. */
export function takeSnapshot(path: string, maxBytes: number, keepDays: number): Promise<Snapshot | null> {
  return invoke<Snapshot | null>("take_snapshot", { path, maxBytes, keepDays });
}

/** The snapshots there are, newest first. */
export function localHistory(path: string): Promise<Snapshot[]> {
  return invoke<Snapshot[]>("local_history", { path });
}
