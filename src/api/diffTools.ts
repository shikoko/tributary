// The diff and merge tools git opens (git difftool, git mergetool).
import { invoke } from "@tauri-apps/api/core";

export interface DiffToolSettings {
  /** The tools set (diff.tool, merge.tool), like "meld" or "vscode". */
  diff: string | null;
  merge: string | null;
  /** Their commands, when set up with one. */
  diffCommand: string | null;
  mergeCommand: string | null;
  /** The tools git can open here (when asked for). */
  available: { name: string; label: string; diff: boolean; merge: boolean }[];
}

/** With `list`, also the tools git finds on this computer (slower). */
export function diffToolSettings(path: string | null, list: boolean): Promise<DiffToolSettings> {
  return invoke<DiffToolSettings>("diff_tool_settings", { path, list });
}

/** Open diffs (or, with `merge`, conflicts) in `tool` from now on: a tool git knows, "vscode", or "custom" with `command`; null for git's default. */
export function setDiffTool(path: string | null, merge: boolean, tool: string | null, command: string | null = null): Promise<string> {
  return invoke<string>("set_diff_tool", { path, merge, tool, command });
}
