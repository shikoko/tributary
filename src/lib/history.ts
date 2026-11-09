// What you did in a repository with Tributary, each with its undo: kept for a while, and
// undoable as long as what it changed is still as it left it.
import type { Action, RepoSnapshot } from "../api";

/** How to tell an undo is still safe: what the action changed must be as it left it. */
export type UndoCheck = "head" | "conflicts" | "remote" | "always";

export interface HistoryEntry {
  id: string;
  /** When it ran (milliseconds since the epoch). */
  time: number;
  /** The repository it ran in. */
  path: string;
  /** What Tributary said, like "Committed 3f2a1bc". */
  text: string;
  action: Action;
  undo: Action | null;
  check: UndoCheck;
  /** Where HEAD was just after it (read once the repository reloaded). */
  after: { headBranch: string | null; headCommit: string | null } | null;
  undone: boolean;
}

/** How many actions are kept for each repository. */
export const KEPT = 50;

/** What has to be unchanged for `action`'s undo to be safe. */
export function checkFor(action: Action): UndoCheck {
  switch (action.kind) {
    case "stashAndRetry":
    case "anyDiskSpace":
      return checkFor(action.action);
    case "resolveConflicts":
    case "resolveWithText":
    case "unitySmartMerge":
      return "conflicts";
    case "addRemote":
    case "renameRemote":
      return "remote";
    case "deleteBranches":
    case "shelve":
    case "ignorePaths":
    case "discardFiles":
    case "applyLines":
      return "always";
    default:
      return "head";
  }
}

/** Whether `entry` can still be undone in the repository as it is now, and if not, why. */
export function undoState(entry: HistoryEntry, now: Pick<RepoSnapshot, "headBranch" | "headCommit" | "operation" | "remotes">): { ok: boolean; why?: string } {
  if (!entry.undo) return { ok: false, why: "This can't be undone" };
  if (entry.undone) return { ok: false, why: "Undone" };
  const sameHead = !entry.after || (entry.after.headBranch === now.headBranch && entry.after.headCommit === now.headCommit);
  switch (entry.check) {
    case "head":
      if (sameHead) return { ok: true };
      return entry.after && entry.after.headBranch !== now.headBranch
        ? { ok: false, why: `You've switched to ${now.headBranch ?? "a commit"} since: switch back to ${entry.after.headBranch ?? "it"} to undo this` }
        : { ok: false, why: "The branch has moved since: undoing this now would lose what came after" };
    case "conflicts":
      return sameHead && now.operation ? { ok: true } : { ok: false, why: "The merge or rebase is over" };
    case "remote": {
      const name = entry.action.kind === "addRemote" ? entry.action.name : entry.action.kind === "renameRemote" ? entry.action.to.trim() : "";
      return now.remotes.includes(name) ? { ok: true } : { ok: false, why: `There's no remote called ${name} any more` };
    }
    default:
      return { ok: true };
  }
}

/** A new entry first in its repository's list, keeping the newest. */
export function withEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...entries].slice(0, KEPT);
}
