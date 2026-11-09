import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { onProgress, PAGE_SIZE, runActionFor, type Action, type Outcome, type Progress, type RepoSnapshot } from "../api";
import { hookFailure, involvesUntrackedFiles, isLocalChangesError } from "../lib/errors";
import { undoFor } from "../lib/undo";
import { openInBrowser } from "../lib/weblinks";
import { notifySystem } from "../lib/notify";
import type { ToastMessage } from "../components/Toast";
import { splitRemoteBranch, type OpenDialog } from "../menus";
import { checkoutTarget, LONG_ACTION, PROGRESS_DELAY, RETRYABLE, RUNNING_LABELS, type Running } from "./constants";
import type { LoadMode, RepoError } from "./useRepository";

export interface ActOptions {
  /** Don't show the message (or its undo) when it works. */
  quiet?: boolean;
  /** The user already confirmed (rewriting a protected branch, an undo). */
  confirmed?: boolean;
}

interface Options {
  snapshot: RepoSnapshot | null;
  load: (path: string, mode: LoadMode, limit?: number) => Promise<void>;
  /** The checked-out branch, if it's protected: rewriting it needs its name typed first. */
  protectedHead: string | null;
  openDialog: (dialog: OpenDialog) => void;
  setError: (error: RepoError | null) => void;
  notify: (toast: ToastMessage) => void;
  blockFocusRefresh: MutableRefObject<boolean>;
  /** After an action and the reload, with how it ran and what it reported (to refresh locks, pull requests…). */
  after: (action: Action, kind: Running, outcome: Outcome | null) => void;
  /** A squash merge waits to be committed: show the uncommitted changes. */
  showChanges: () => void;
  /** Keep what was done, with its undo, in the repository's history. */
  record?: (path: string, text: string, action: Action, undo: Action | null) => void;
}

/** A progress bar for a fetch, pull, push or Git LFS download. */
export interface ProgressState {
  label: string;
  value: Progress | null;
  /** Only shown when it takes a moment. */
  visible: boolean;
  /** It can be stopped halfway (a checkout can't: the files would be half switched). */
  cancellable: boolean;
}

/**
 * Running git actions: what's running, its progress, and after it ran, a reload and a
 * message (with Undo, Stash changes and retry, or Create pull request).
 */
export function useActions({ snapshot, load, protectedHead, openDialog, setError, notify, blockFocusRefresh, after, showChanges, record }: Options) {
  const [running, setRunning] = useState<Running>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  // The repository the action runs in (its progress shows there, and on its tab).
  const [runningPath, setRunningPath] = useState<string | null>(null);
  // The latest callbacks, so `act` only changes with the repository.
  const callbacks = useRef({ openDialog, setError, notify, after, showChanges, record });
  callbacks.current = { openDialog, setError, notify, after, showChanges, record };

  /** Run a git action, reload, then show what happened. Resolves to true when it worked. */
  const act = useCallback(
    async (action: Action, requested: Running = "other", options: ActOptions = {}): Promise<boolean> => {
      if (!snapshot) return false;
      // Checkouts show their progress too (big ones, and Git LFS files, take a while).
      const target = checkoutTarget(action);
      const kind: Running = requested === "other" && target !== null ? "checkout" : requested;
      const { openDialog, setError, notify, after, showChanges } = callbacks.current;
      if (!options.confirmed && protectedHead && (action.kind === "rebase" || action.kind === "interactiveRebase" || action.kind === "fixupInto" || action.kind === "splitCommit" || action.kind === "restack" || action.kind === "migrateToLfs")) {
        openDialog({ kind: "protectedAction", action, branch: protectedHead });
        return false;
      }
      const before = snapshot;
      const started = Date.now();
      let last: Progress | null = null;
      setRunning(kind);
      setRunningPath(before.path);
      setError(null);
      blockFocusRefresh.current = true;

      // Fetches, pulls, pushes and downloads show a progress bar, unless they finish quickly.
      let stopListening: (() => void) | undefined;
      let showTimer: number | undefined;
      if (kind && kind !== "other") {
        setProgress({ label: kind === "checkout" ? `Checking out ${target}` : RUNNING_LABELS[kind], value: null, visible: false, cancellable: kind !== "checkout" });
        showTimer = window.setTimeout(() => setProgress((current) => current && { ...current, visible: true }), PROGRESS_DELAY);
        stopListening = await onProgress((value) => {
          last = value;
          setProgress((current) => current && { ...current, value });
        }).catch(() => undefined);
      }

      let outcome: Outcome | null = null;
      let failure: string | null = null;
      try {
        outcome = await runActionFor(before.path, action);
      } catch (e) {
        failure = String(e);
      }
      window.clearTimeout(showTimer);
      stopListening?.();
      setProgress(null);
      setRunning(null);
      setRunningPath(null);
      // A long one, finished while you were elsewhere: say so.
      if (kind && kind !== "other" && Date.now() - started > LONG_ACTION && !document.hasFocus() && failure !== "Cancelled.") {
        const files = (last as Progress | null)?.files;
        const count = files && files.total > 1 ? ` · ${files.total.toLocaleString()} Git LFS files` : "";
        const minutes = Math.round((Date.now() - started) / 60_000);
        const took = minutes >= 1 ? ` in ${minutes} min` : "";
        void notifySystem(before.name, failure ? `Didn't finish: ${failure.split("\n")[0]}` : `${outcome?.message ?? "Done"}${count}${took}`);
      }
      // Reload even after a failure (a pull with conflicts still changes things), and only
      // then show the result, since reloading clears old errors.
      await load(before.path, "refresh", Math.max(PAGE_SIZE, before.commits.length));
      after(action, kind, outcome);

      if (failure === "Cancelled.") {
        notify({ text: "Cancelled" });
        return false;
      }
      if (failure || !outcome) {
        const message = failure ?? "Something went wrong";
        const retry: Action | undefined =
          RETRYABLE.has(action.kind) && isLocalChangesError(message)
            ? { kind: "stashAndRetry", action, includeUntracked: involvesUntrackedFiles(message) }
            : undefined;
        // The branch is checked out in another working tree: offer to open that.
        const worktree = /already (?:used by worktree|checked out) at '([^']+)'/.exec(message)?.[1];
        // A hook stopped it: offer to go ahead without it.
        const skipHooks: Action | undefined =
          hookFailure(message) && (action.kind === "commit" || action.kind === "push") ? { ...action, noVerify: true } : undefined;
        setError({ message, retry, worktree, skipHooks });
        return false;
      }
      const { message, pullRequest, backup } = outcome;
      // Discarded files and lines are kept for a while, to put back.
      const discarded = action.kind === "discardFiles" || action.kind === "applyLines";
      const undo = backup && discarded ? { kind: "restoreDiscarded" as const, reference: backup } : undoFor(action, before);
      if (message) callbacks.current.record?.(before.path, message, action, undo);
      if (action.kind === "merge" && action.mode === "squash") showChanges();
      if (pullRequest) {
        // Open it here: the branch as it's called on the remote it was pushed to.
        const local = before.headBranch;
        const branch = local && before.upstream ? splitRemoteBranch(before.upstream.name, before.remotes).branch : local;
        const gitlab = pullRequest.includes("merge_requests");
        notify({
          text: message ?? "Pushed",
          action: {
            label: gitlab ? "Create merge request" : "Create pull request",
            onClick: () => (branch ? openDialog({ kind: "createPullRequest", branch, local, url: pullRequest }) : openInBrowser(pullRequest)),
          },
        });
      } else if (!options.quiet && message) {
        notify({ text: message, action: undo ? { label: "Undo", onClick: () => act(undo, "other", { confirmed: true }) } : undefined });
      }
      return true;
    },
    [snapshot, load, protectedHead, blockFocusRefresh],
  );

  /** A dialog did its own action: show its message, with an undo, and reload. */
  const finished = useCallback(
    (message: string, undo: Action | undefined, refresh: () => void) => {
      callbacks.current.notify({ text: message, action: undo ? { label: "Undo", onClick: () => act(undo, "other", { confirmed: true }) } : undefined });
      refresh();
    },
    [act],
  );

  return { act, running, runningPath, progress, finished };
}

export type Actions = ReturnType<typeof useActions>;
