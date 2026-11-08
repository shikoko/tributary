import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { onProgress, PAGE_SIZE, runActionFor, type Action, type Outcome, type Progress, type RepoSnapshot } from "../api";
import { involvesUntrackedFiles, isLocalChangesError } from "../lib/errors";
import { undoFor } from "../lib/undo";
import { openInBrowser } from "../lib/weblinks";
import type { ToastMessage } from "../components/Toast";
import type { OpenDialog } from "../menus";
import { PROGRESS_DELAY, RETRYABLE, RUNNING_LABELS, type Running } from "./constants";
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
}

/** A progress bar for a fetch, pull, push or Git LFS download. */
export interface ProgressState {
  label: string;
  value: Progress | null;
  /** Only shown when it takes a moment. */
  visible: boolean;
}

/**
 * Running git actions: what's running, its progress, and after it ran, a reload and a
 * message (with Undo, Stash changes and retry, or Create pull request).
 */
export function useActions({ snapshot, load, protectedHead, openDialog, setError, notify, blockFocusRefresh, after, showChanges }: Options) {
  const [running, setRunning] = useState<Running>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  // The latest callbacks, so `act` only changes with the repository.
  const callbacks = useRef({ openDialog, setError, notify, after, showChanges });
  callbacks.current = { openDialog, setError, notify, after, showChanges };

  /** Run a git action, reload, then show what happened. Resolves to true when it worked. */
  const act = useCallback(
    async (action: Action, kind: Running = "other", options: ActOptions = {}): Promise<boolean> => {
      if (!snapshot) return false;
      const { openDialog, setError, notify, after, showChanges } = callbacks.current;
      if (!options.confirmed && protectedHead && (action.kind === "rebase" || action.kind === "interactiveRebase" || action.kind === "fixupInto")) {
        openDialog({ kind: "protectedAction", action, branch: protectedHead });
        return false;
      }
      const before = snapshot;
      setRunning(kind);
      setError(null);
      blockFocusRefresh.current = true;

      // Fetches, pulls, pushes and downloads show a progress bar, unless they finish quickly.
      let stopListening: (() => void) | undefined;
      let showTimer: number | undefined;
      if (kind && kind !== "other") {
        setProgress({ label: RUNNING_LABELS[kind], value: null, visible: false });
        showTimer = window.setTimeout(() => setProgress((current) => current && { ...current, visible: true }), PROGRESS_DELAY);
        stopListening = await onProgress((value) => setProgress((current) => current && { ...current, value })).catch(() => undefined);
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
        setError({ message, retry, worktree });
        return false;
      }
      const { message, pullRequest, backup } = outcome;
      if (action.kind === "merge" && action.mode === "squash") showChanges();
      if (pullRequest) {
        notify({ text: message ?? "Pushed", action: { label: "Create pull request", onClick: () => openInBrowser(pullRequest) } });
      } else if (!options.quiet && message) {
        // Discarded files and lines are kept for a while, to put back.
        const discarded = action.kind === "discardFiles" || action.kind === "applyLines";
        const undo = backup && discarded ? { kind: "restoreDiscarded" as const, reference: backup } : undoFor(action, before);
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

  return { act, running, progress, finished };
}

export type Actions = ReturnType<typeof useActions>;
