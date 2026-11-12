// Where the user's git is, and getting it when it isn't there.
import { invoke } from "@tauri-apps/api/core";
import type { GitInstall } from "./generated";
export type { GitInstall };

/** Where git is (found once, then remembered). */
export function gitInstall(): Promise<GitInstall> {
  return invoke<GitInstall>("git_install");
}

/** Look for git again, after installing it. */
export function lookForGit(): Promise<GitInstall> {
  return invoke<GitInstall>("look_for_git");
}

/** Open Apple's installer for the Command Line Tools (macOS). */
export function installCommandLineTools(): Promise<void> {
  return invoke<void>("install_command_line_tools");
}
