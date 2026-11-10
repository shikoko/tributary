// What Copy Diagnostics shows.
import { invoke } from "@tauri-apps/api/core";
import type { LfsHealth } from "./lfs";

/** For reporting a problem: versions, the platform, and how the repository is set up. */
export interface Diagnostics {
  version: string;
  platform: string;
  git: string;
  gitPath: string | null;
  gitLfs: string | null;
  repository: {
    path: string;
    head: string;
    remotes: string[];
    shallow: boolean;
    sparse: boolean;
    partial: boolean;
    operation: string | null;
    lfs: LfsHealth | null;
    error: string | null;
  } | null;
}

export function diagnostics(path: string | null): Promise<Diagnostics> {
  return invoke<Diagnostics>("diagnostics", { path });
}

/** Opens the licences of the software Tributary is made with, in the system's text viewer. */
export function openNotices(): Promise<void> {
  return invoke<void>("open_notices");
}
