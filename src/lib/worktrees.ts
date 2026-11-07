import type { Worktree } from "../api";
import { folderSlug } from "./paths";

/** A working tree's folder name, like "notebook-feature-tags". */
export function worktreeName(worktree: Worktree): string {
  return worktree.path.split(/[\\/]/).filter(Boolean).pop() ?? worktree.path;
}

/** What's checked out in a working tree, unless its folder name already says so. */
export function worktreeNote(worktree: Worktree): string | null {
  if (worktree.prunable) return "gone";
  if (!worktree.branch) return "detached";
  const name = worktreeName(worktree).toLowerCase();
  return name.includes(folderSlug(worktree.branch).toLowerCase()) ? null : worktree.branch;
}
