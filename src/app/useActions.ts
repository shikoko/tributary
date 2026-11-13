import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { onProgress, PAGE_SIZE, runActionFor, type Action, type Outcome, type Progress, type RepoSnapshot } from "../api";
import { hookFailure, involvesUntrackedFiles, isLocalChangesError, NOT_ENOUGH_SPACE } from "../lib/errors";
import { undoFor } from "../lib/undo";
import { openInBrowser } from "../lib/weblinks";
import { notifySystem } from "../lib/notify";
import { overallPercent } from "../lib/progress";
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

/** What undoes `action`, which reported `outcome`, in the repository as it was `before`. */
function undoOf(action: Action, outcome: Outcome, before: RepoSnapshot): Action | null {
  const { backup } = outcome;
  // Discarded files and lines are kept for a while, to put back.
  const discarded = action.kind === "discardFiles" || action.kind === "discardAll" || action.kind === "applyLines" || (action.kind === "shelve" && !action.keep);
  if (backup && discarded) return { kind: "restoreDiscarded", reference: backup };
  // Restored from the local history: what the files were just before was kept too.
  if (backup && action.kind === "restoreFromHistory") return { kind: "restoreFromHistory", reference: backup, paths: action.paths };
  return undoFor(action, before);
}

/** For the tabs: what's running in each repository whose progress shows, and how far it is. */
export function busyTabs(runs: ReadonlyMap<string, Run>): Record<string, { label: string; percent: number | null }> {
  const busy: Record<string, { label: string; percent: number | null }> = {};
  for (const [path, { progress }] of runs) if (progress?.visible) busy[path] = { label: progress.label, percent: overallPercent(progress.value) };
  return busy;
}

/** An action running in a repository, and its progress. */
export interface Run {
  kind: Running;
  progress: ProgressState | null;
}

/**
 * Running git actions, one at a time in each repository and in several at once: what's
 * running, its progress, and after it ran, a reload and a message (with Undo, Stash changes
 * and retry, or Create pull request).
 */
export function useActions({ snapshot, load, protectedHead, openDialog, setError, notify, blockFocusRefresh, after, showChanges, record }: Options) {
  // What's running, by repository.
  const [runs, setRuns] = useState<ReadonlyMap<string, Run>>(new Map());
  const change = useCallback((path: string, update: (run: Run | undefined) => Run | undefined) => {
    setRuns((current) => {
      const next = new Map(current);
      const run = update(current.get(path));
      if (run) next.set(path, run);
      else next.delete(path);
      return next;
    });
  }, []);
  // The repository on screen, now: an action can finish after you've gone to another.
  const shown = useRef(snapshot?.path ?? null);
  shown.current = snapshot?.path ?? null;
  // What to do after actions that finished in repositories you'd left, for when you're back.
  const waiting = useRef(new Map<string, (() => void)[]>());
  useEffect(() => {
    const path = snapshot?.path;
    const later = path ? waiting.current.get(path) : undefined;
    if (!path || !later) return;
    waiting.current.delete(path);
    for (const work of later) work();
  }, [snapshot?.path]);
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
      change(before.path, () => ({ kind, progress: null }));
      setError(null);
      blockFocusRefresh.current = true;
      const setProgress = (update: (current: ProgressState | null) => ProgressState | null) =>
        change(before.path, (run) => run && { ...run, progress: update(run.progress) });

      // Fetches, pulls, pushes and downloads show a progress bar, unless they finish quickly.
      let stopListening: (() => void) | undefined;
      let showTimer: number | undefined;
      if (kind && kind !== "other") {
        setProgress(() => ({ label: kind === "checkout" ? `Checking out ${target}` : RUNNING_LABELS[kind], value: null, visible: false, cancellable: kind !== "checkout" }));
        showTimer = window.setTimeout(() => setProgress((current) => current && { ...current, visible: true }), PROGRESS_DELAY);
        stopListening = await onProgress((value, path) => {
          // Another repository's, or a clone's.
          if (path !== before.path) return;
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
      change(before.path, () => undefined);
      // A long one, finished while you were elsewhere: say so.
      if (kind && kind !== "other" && Date.now() - started > LONG_ACTION && !document.hasFocus() && failure !== "Cancelled.") {
        const files = (last as Progress | null)?.files;
        const count = files && files.total > 1 ? ` · ${files.total.toLocaleString()} Git LFS files` : "";
        const minutes = Math.round((Date.now() - started) / 60_000);
        const took = minutes >= 1 ? ` in ${minutes} min` : "";
        void notifySystem(before.name, failure ? `Didn't finish: ${failure.split("\n")[0]}` : `${outcome?.message ?? "Done"}${count}${took}`);
      }
      // You went to another repository while it ran: it's reloaded when you're back there
      // (and what follows an action waits for then), and a message says how it went. Its
      // undo is in that repository's history: the message's would run in this one.
      if (shown.current !== before.path) {
        const later = waiting.current.get(before.path) ?? [];
        later.push(() => after(action, kind, outcome));
        waiting.current.set(before.path, later);
        const text = failure === "Cancelled." ? "Cancelled" : (failure?.split("\n")[0] ?? outcome?.message ?? "Done");
        notify({ text: `${before.name}: ${text}` });
        if (outcome?.message) callbacks.current.record?.(before.path, outcome.message, action, undoOf(action, outcome, before));
        return failure === null;
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
        // Too little disk space, it seemed: offer to go ahead all the same.
        const anyway: Action | undefined = message.startsWith(NOT_ENOUGH_SPACE) && action.kind !== "anyDiskSpace" ? { kind: "anyDiskSpace", action } : undefined;
        setError({ message, retry: anyway ? undefined : retry, worktree, skipHooks, anyway });
        return false;
      }
      const { message, pullRequest } = outcome;
      const undo = undoOf(action, outcome, before);
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
    [snapshot, load, protectedHead, blockFocusRefresh, change],
  );

  /** A dialog did its own action: show its message, with an undo, and reload. */
  const finished = useCallback(
    (message: string, undo: Action | undefined, refresh: () => void) => {
      callbacks.current.notify({ text: message, action: undo ? { label: "Undo", onClick: () => act(undo, "other", { confirmed: true }) } : undefined });
      refresh();
    },
    [act],
  );

  // The repository on screen's.
  const run = snapshot ? runs.get(snapshot.path) : undefined;
  return { act, running: run?.kind ?? null, progress: run?.progress ?? null, runs, finished };
}

export type Actions = ReturnType<typeof useActions>;
