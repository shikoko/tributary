// Where the user's git is, and getting it when it isn't there.
import { invoke } from "./invoke";
import type { GitInstall } from "./generated";
export type { GitInstall };

/** Where git is (found once, then remembered). */
export function gitInstall(): Promise<GitInstall> {
  return invoke("git_install");
}

/** Look for git again, after installing it. */
export function lookForGit(): Promise<GitInstall> {
  return invoke("look_for_git");
}

/** Open Apple's installer for the Command Line Tools (macOS). */
export function installCommandLineTools(): Promise<void> {
  return invoke("install_command_line_tools");
}
