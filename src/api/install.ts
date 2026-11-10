// Where the user's git is, and getting it when it isn't there.
import { invoke } from "@tauri-apps/api/core";

export interface GitInstall {
  /** The git that runs, when there is one. */
  path: string | null;
  /** Like "2.39.3". */
  version: string | null;
  /** Older than what everything needs (2.38): it works, but not everything does. */
  old: boolean;
  /** On a Mac: Apple's Command Line Tools (which bring git) aren't installed. */
  needsCommandLineTools: boolean;
}

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
