import type { Action } from "../api";
import type { RemoteAction } from "../components/Toolbar";

/** What's loading. */
export type Busy = { kind: "open"; path: string } | { kind: "refresh" } | { kind: "more" } | null;
/** What's running: a fetch, pull or push (with a progress bar), or anything else. */
export type Running = RemoteAction | "other" | null;
/** What's highlighted: a branch's (or commit's) history, an author's commits, or the commits that changed a file or folder. */
export type Focus =
  | { kind: "history"; name: string; commitId: string }
  | { kind: "author"; name: string; email: string }
  | { kind: "path"; path: string; folder: boolean; ids: string[]; names: string[]; truncated: boolean };

/** Don't refresh on window focus more often than this, in milliseconds. */
export const FOCUS_REFRESH_INTERVAL = 2000;
/** How often to fetch in the background, in minutes, to choose from. */
export const FETCH_MINUTES = [1, 2, 5, 10, 15, 30];
/** The first background fetch after opening a repository. */
export const FIRST_AUTO_FETCH_DELAY = 5000;
/** Fetches, pulls and pushes that finish faster than this don't show a progress bar. */
export const PROGRESS_DELAY = 300;
export const ZOOM_LEVELS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** How many git commands the activity log keeps. */
export const ACTIVITY_SIZE = 300;
/** Actions that can be retried after stashing when uncommitted changes are in the way. */
export const RETRYABLE = new Set<Action["kind"]>([
  "pull",
  "checkoutBranch",
  "checkoutRemoteBranch",
  "checkoutCommit",
  "createBranch",
  "merge",
  "rebase",
  "cherryPick",
  "revert",
  "cherryPickMany",
  "revertMany",
  "interactiveRebase",
]);
export const RUNNING_LABELS: Record<RemoteAction, string> = { fetch: "Fetching", pull: "Pulling", push: "Pushing" };
