import type { Action, WorktreeStatus } from "../api";
import type { RemoteAction } from "../components/Toolbar";
import { plural } from "../lib/format";

/** What's loading. */
export type Busy = { kind: "open"; path: string } | { kind: "refresh" } | { kind: "more" } | null;
/** A fetch, pull or push, downloading Git LFS files, a checkout, discarding changes (all with a progress bar), or anything else. */
export type Running = RemoteAction | "download" | "submodules" | "checkout" | "discard" | "other" | null;

/** Whether an action of this kind went to a remote, so locks and pull requests may have changed. */
export function reachedRemote(kind: Running): boolean {
  return kind !== null && kind !== "other" && kind !== "checkout" && kind !== "discard";
}
/** What's highlighted: a branch's (or commit's) history, an author's commits, or the commits that changed a file or folder. */
export type Focus =
  | { kind: "history"; name: string; commitId: string }
  | { kind: "author"; name: string; email: string }
  | { kind: "path"; path: string; folder: boolean; ids: string[]; names: string[]; truncated: boolean };

/** Don't refresh on window focus more often than this, in milliseconds. */
export const FOCUS_REFRESH_INTERVAL = 2000;
/** The times Fetch latest can be scheduled at: every half hour. */
export const SCHEDULE_TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
/** How often local history keeps a snapshot of uncommitted work, in minutes, to choose from. */
export const HISTORY_MINUTES = [5, 10, 15, 30];
/** How often to fetch in the background, in minutes, to choose from. */
export const FETCH_MINUTES = [1, 2, 5, 10, 15, 30];
/** The first background fetch after opening a repository. */
export const FIRST_AUTO_FETCH_DELAY = 5000;
/** Fetches, pulls and pushes that finish faster than this don't show a progress bar. */
export const PROGRESS_DELAY = 300;
/** Actions that take longer than this (ms) say so with a system notification when they finish while Tributary is in the background. */
export const LONG_ACTION = 30_000;
export const ZOOM_LEVELS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** How many git commands the activity log keeps. */
export const ACTIVITY_SIZE = 300;
/** Actions that can be retried after stashing when uncommitted changes are in the way. */
export const RETRYABLE = new Set<Action["kind"]>([
  "pull",
  "sync",
  "fetchLatest",
  "checkoutBranch",
  "checkoutRemoteBranch",
  "checkoutCommit",
  "createBranch",
  "merge",
  "rebase",
  "cherryPick",
  "cherryPickOnto",
  "revert",
  "cherryPickMany",
  "revertMany",
  "interactiveRebase",
  "bisectStart",
  "bisectMark",
]);
export const RUNNING_LABELS: Record<Exclude<Running, "other" | null>, string> = {
  fetch: "Fetching",
  pull: "Pulling",
  push: "Pushing",
  sync: "Syncing",
  download: "Downloading Git LFS files",
  submodules: "Updating submodules",
  checkout: "Checking out",
  discard: "Discarding changes",
};

/**
 * For Discard all, or discarding chosen files or folders, its progress bar's label: how many
 * of the uncommitted files go, as `worktree` lists them ("Discarding 12,345 files"). A new
 * folder is listed as itself, however many files are in it, so it's counted as a folder
 * ("Discarding 4 files and 1 new folder"). git says nothing while it stashes them away, so
 * the bar shows it's working, not how far it is. `null` for any other action.
 */
export function discardLabel(action: Action, worktree: WorktreeStatus | null): string | null {
  if (action.kind !== "discardAll" && action.kind !== "discardFiles") return null;
  const chosen = action.kind === "discardFiles" ? action.paths.map((path) => path.replace(/\/+$/, "")) : null;
  const goes = (path: string | null) => path !== null && (chosen === null || chosen.some((place) => path === place || path.startsWith(`${place}/`)));
  const files = new Set([...(worktree?.staged ?? []), ...(worktree?.unstaged ?? [])].filter((file) => goes(file.path) || goes(file.oldPath)).map((file) => file.path));
  if (files.size === 0) return RUNNING_LABELS.discard;
  const folders = [...files].filter((path) => path.endsWith("/")).length;
  const what = [files.size > folders && plural(files.size - folders, "file"), folders > 0 && plural(folders, "new folder")];
  return `Discarding ${what.filter(Boolean).join(" and ")}`;
}

/** What a checkout is checking out, for its progress bar: "Checking out art/barber-v2". */
export function checkoutTarget(action: Action): string | null {
  switch (action.kind) {
    case "checkoutBranch":
      return action.name;
    case "checkoutRemoteBranch":
      return action.name.slice(action.name.indexOf("/") + 1);
    case "checkoutCommit":
      return action.id.slice(0, 7);
    case "createBranch":
      return action.checkout ? action.name : null;
    case "stashAndRetry":
    case "anyDiskSpace":
      return checkoutTarget(action.action);
    default:
      return null;
  }
}
