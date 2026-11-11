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
  /** What went wrong in the window lately, and the crash reports saved for sending. */
  problems: {
    /** The folder with the problems log and the saved crash reports (in "crashes"). */
    folder: string | null;
    /** The log's last few lines, oldest first. */
    recent: string[];
    /** The saved crash reports' names, newest first (macOS only). */
    crashReports: string[];
  };
}

export function diagnostics(path: string | null): Promise<Diagnostics> {
  return invoke<Diagnostics>("diagnostics", { path });
}

/**
 * Keep a problem with the interface (an error that stopped it) in the problems log, to send
 * with a report later. Where the log is, once the app knows.
 */
export function reportProblem(what: string): Promise<string | null> {
  return invoke<string | null>("report_problem", { what });
}

/** Why the window was loaded again (WebKit's web content process stopped), once, if it was. */
export function takeRecoveryNote(): Promise<string | null> {
  return invoke<string | null>("take_recovery_note");
}

/** The licences of the software Tributary is made with, and Tributary's own. */
export interface ThirdPartyNotices {
  /** THIRD_PARTY_NOTICES.txt, as tools/notices.mjs writes it (see lib/notices.ts). */
  notices: string;
  license: string | null;
}

export function thirdPartyNotices(): Promise<ThirdPartyNotices> {
  return invoke<ThirdPartyNotices>("third_party_notices");
}
