// What Copy Diagnostics shows.
import { invoke } from "@tauri-apps/api/core";
import type { Diagnostics, ThirdPartyNotices } from "./generated";
export type { Diagnostics, ThirdPartyNotices };

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

export function thirdPartyNotices(): Promise<ThirdPartyNotices> {
  return invoke<ThirdPartyNotices>("third_party_notices");
}
