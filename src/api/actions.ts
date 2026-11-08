// Changing a repository: actions run the installed git, with progress, cancelling and an activity log.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BranchTip } from "./branches";
import type { DiffSource } from "./diff";

/** Something that changes the repository. These run the installed git. */
/** What to do with some changed lines: stage them, unstage them, or undo them in the file. */
export type LineMode = "stage" | "unstage" | "discard";

export type Action =
  | { kind: "resetHard"; id: string }
  | { kind: "checkoutBranch"; name: string }
  | { kind: "checkoutRemoteBranch"; name: string }
  | { kind: "checkoutCommit"; id: string }
  | { kind: "createBranch"; name: string; id: string; checkout: boolean }
  | { kind: "fetch"; background?: boolean }
  | { kind: "pull" }
  | { kind: "push"; force: boolean }
  /** Stash uncommitted changes, run `action`, then put the changes back. */
  | { kind: "stashAndRetry"; action: Action; includeUntracked: boolean }
  /** `paths`: only these files (all changes when left out). */
  | { kind: "stashPush"; message: string | null; includeUntracked: boolean; paths?: string[] }
  | { kind: "stashApply"; index: number; id: string }
  | { kind: "stashPop"; index: number; id: string }
  | { kind: "stashDrop"; index: number; id: string }
  | { kind: "stage"; paths: string[] }
  | { kind: "unstage"; paths: string[] }
  | { kind: "stageAll" }
  | { kind: "unstageAll" }
  | { kind: "commit"; message: string; amend: boolean }
  | { kind: "resetSoft"; id: string }
  | { kind: "deleteBranch"; name: string; force: boolean }
  | { kind: "deleteRemoteBranch"; name: string }
  /** Prune: delete these branches, each only if it still points at `id`. */
  | { kind: "deleteBranches"; branches: BranchTip[] }
  | { kind: "restoreBranches"; branches: BranchTip[] }
  /** Push a deleted remote branch (like "origin/feat/x") back, at `id`. */
  | { kind: "restoreRemoteBranch"; name: string; id: string }
  | { kind: "restoreBackup"; reference: string }
  | { kind: "removeBackup"; reference: string }
  | { kind: "renameBranch"; name: string; newName: string }
  /** `mode`: "noFastForward" always makes a merge commit; "squash" stages the changes to commit as one. */
  | { kind: "merge"; target: string; mode?: "default" | "noFastForward" | "squash" }
  | { kind: "rebase"; onto: string }
  | { kind: "cherryPick"; id: string }
  | { kind: "revert"; id: string }
  | { kind: "continueOperation" }
  | { kind: "skipCommit" }
  | { kind: "abortOperation" }
  /** Oldest first. */
  | { kind: "cherryPickMany"; ids: string[] }
  /** Newest first. */
  | { kind: "revertMany"; ids: string[] }
  /** Every commit after `onto` on the checked-out branch, oldest first. */
  | { kind: "interactiveRebase"; onto: string; steps: RebaseStep[] }
  | { kind: "createTag"; name: string; id: string; message: string | null }
  | { kind: "deleteTag"; name: string }
  | { kind: "restoreTag"; name: string; id: string }
  | { kind: "pushTag"; name: string; remote: string | null }
  | { kind: "deleteRemoteTag"; name: string; remote: string }
  /** Take one side's version of whole conflicted files. */
  | { kind: "resolveConflicts"; paths: string[]; keep: "mine" | "theirs" }
  /** Undo resolveConflicts: put the conflicts back. */
  | { kind: "recreateConflicts"; paths: string[] }
  | { kind: "lockFiles"; paths: string[] }
  /** Store files matching `patterns` with Git LFS, turning the staged `paths` into LFS files. */
  | { kind: "trackWithLfs"; patterns: string[]; paths?: string[] }
  /** Stop storing files matching these with Git LFS (files already stored with it stay so). */
  | { kind: "untrackWithLfs"; patterns: string[] }
  /** Throw away changes to files; the outcome's `backup` brings them back. */
  | { kind: "discardFiles"; paths: string[] }
  | { kind: "restoreDiscarded"; reference: string }
  /** Stage, unstage or throw away some changed lines: added ones by their number after the change, removed ones before it. */
  | { kind: "applyLines"; file: string; mode: LineMode; added: number[]; removed: number[] }
  | { kind: "ignorePaths"; patterns: string[] }
  | { kind: "unignorePaths"; patterns: string[] }
  | { kind: "pruneLfs" }
  | { kind: "downloadLfsFiles" }
  | { kind: "setUpLfs" }
  | { kind: "addWorktree"; path: string; branch: string; create: boolean; start?: string | null }
  | { kind: "removeWorktree"; path: string; force?: boolean }
  | { kind: "pruneWorktrees" }
  | { kind: "openInDiffTool"; source: DiffSource; path: string }
  | { kind: "openInMergeTool"; path: string }
  /** Commit as this name and email in this repository; both empty go back to the usual ones. */
  | { kind: "setIdentity"; name: string; email: string }
  /** Check out the recorded commit in these submodules (all when empty), setting up those that aren't. */
  | { kind: "updateSubmodules"; paths: string[] }
  | { kind: "unlockFiles"; locks: { id: string; path: string }[]; force?: boolean };

export type StepAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export interface RebaseStep {
  id: string;
  action: StepAction;
  /** The new message, for "reword". */
  message?: string;
}

/** What an action did. */
export interface Outcome {
  message: string;
  /** After pushing a new branch: the page the remote suggested for opening a pull request. */
  pullRequest?: string;
  /** Where what the action threw away was kept, to undo it (like discarded changes). */
  backup?: string;
  /** After a push: the files the pushed commits changed. */
  pushedFiles?: string[];
}

/** A git command Tributary ran. */
export interface LogEntry {
  id: number;
  /** Milliseconds since the Unix epoch. */
  started: number;
  durationMs: number;
  folder: string;
  /** Everything after `git`. */
  args: string[];
  success: boolean;
  output: string;
  /** Run by Tributary on its own, like the regular background fetch. */
  background: boolean;
}

/** How far a fetch, pull or push has got. */
export interface Progress {
  /** Like "Receiving objects". */
  phase: string;
  percent: number | null;
  /** More about it, like "2 of 5 files · 56 MB of 80 MB · 12 MB/s". */
  detail?: string;
}

/** Stop the fetch, pull, push or clone that is running. */
export function cancelAction(): Promise<boolean> {
  return invoke<boolean>("cancel_action");
}

/** Calls `handler` with progress updates; resolves to a function that stops listening. */
export function onProgress(handler: (progress: Progress) => void): Promise<() => void> {
  return listen<Progress>("action-progress", (event) => handler(event.payload));
}

/** Run `action`; resolves to a short message saying what happened. */
export async function runAction(path: string, action: Action): Promise<string> {
  return (await runActionFor(path, action)).message;
}

/** Like `runAction`, with everything the action reported. */
export function runActionFor(path: string, action: Action): Promise<Outcome> {
  return invoke<Outcome>("run_action", { path, action });
}

/** Ways to make a clone of a big repository smaller and quicker. */
export interface CloneOptions {
  /** Leave files stored with Git LFS as pointer files, to download later. */
  skipLfs?: boolean;
  /** Only check out these folders; the contents of other files aren't downloaded. */
  folders?: string[];
  /** Only download this many of the latest commits. */
  depth?: number | null;
  /** Also clone its submodules, each at the commit it records. */
  submodules?: boolean;
}

/** Clone `url` into a new folder `name` inside `parent`; resolves to the new folder. */
export function cloneRepository(url: string, parent: string, name: string, options: CloneOptions = {}): Promise<string> {
  return invoke<string>("clone_repository", { url, parent, name, options });
}

/** Create a repository in an existing folder. */
export function initRepository(path: string): Promise<string> {
  return invoke<string>("init_repository", { path });
}

/** The git commands Tributary ran recently, oldest first. */
export function activityLog(): Promise<LogEntry[]> {
  return invoke<LogEntry[]>("activity_log");
}

/** Calls `handler` for every git command Tributary runs from now on. */
export function onActivity(handler: (entry: LogEntry) => void): Promise<() => void> {
  return listen<LogEntry>("activity", (event) => handler(event.payload));
}
