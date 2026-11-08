import type { Action, RepoSnapshot } from "../api";

/** The action that undoes `action`, given the repository as it was before it, if there is one. */
export function undoFor(action: Action, before: Pick<RepoSnapshot, "headBranch" | "headCommit">): Action | null {
  const back: Action | null = before.headBranch
    ? { kind: "checkoutBranch", name: before.headBranch }
    : before.headCommit
      ? { kind: "checkoutCommit", id: before.headCommit }
      : null;
  switch (action.kind) {
    case "checkoutBranch":
    case "checkoutRemoteBranch":
    case "checkoutCommit":
      return back;
    case "resetHard":
    case "merge":
    case "rebase":
    case "cherryPick":
    case "revert":
    case "cherryPickMany":
    case "revertMany":
    case "interactiveRebase":
      return before.headCommit ? { kind: "resetHard", id: before.headCommit } : null;
    case "commit":
      return before.headCommit ? { kind: "resetSoft", id: before.headCommit } : null;
    case "deleteBranches":
      // Branches that weren't deleted are skipped when restoring.
      return { kind: "restoreBranches", branches: action.branches };
    case "resolveConflicts":
      return { kind: "recreateConflicts", paths: action.paths };
    case "resolveWithText":
      return { kind: "recreateConflicts", paths: [action.file] };
    case "ignorePaths":
      return { kind: "unignorePaths", patterns: action.patterns };
    case "stashAndRetry": {
      // Undo the same way: put the changes aside, undo, and put them back.
      const inner = undoFor(action.action, before);
      return inner && inner.kind !== "resetSoft"
        ? { kind: "stashAndRetry", action: inner, includeUntracked: action.includeUntracked }
        : null;
    }
    default:
      return null;
  }
}
