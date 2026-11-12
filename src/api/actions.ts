// Changing a repository: actions run the installed git, with progress, cancelling and an activity log.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Action, CloneOptions, LineMode, LogEntry, Outcome, Progress, RebaseStep, StepAction } from "./generated";
export type { Action, CloneOptions, LineMode, LogEntry, Outcome, Progress, RebaseStep, StepAction };

/** Something that changes the repository. These run the installed git. */

/** Stop the fetch, pull or push running in the repository at `path`, or without one, everything (a clone). */
export function cancelAction(path?: string): Promise<boolean> {
  return invoke<boolean>("cancel_action", { path: path ?? null });
}

/** Watch the open repository for changes made outside the app (one at a time). */
export function watchRepository(path: string): Promise<void> {
  return invoke<void>("watch_repository", { path });
}

export function stopWatching(): Promise<void> {
  return invoke<void>("stop_watching");
}

/** Calls `handler` with a repository's path when its files change outside the app. */
export function onRepoChanged(handler: (path: string) => void): Promise<() => void> {
  return listen<string>("repo-changed", (event) => handler(event.payload));
}

/**
 * Calls `handler` with progress updates, and the repository they're about (null for a
 * clone): actions can run in several at once. Resolves to a function that stops listening.
 */
export function onProgress(handler: (progress: Progress, path: string | null) => void): Promise<() => void> {
  return listen<Progress & { path?: string | null }>("action-progress", (event) => {
    const { path, ...progress } = event.payload;
    handler(progress, path ?? null);
  });
}

/** Run `action`; resolves to a short message saying what happened. */
export async function runAction(path: string, action: Action): Promise<string> {
  return (await runActionFor(path, action)).message;
}

/** Like `runAction`, with everything the action reported. */
export function runActionFor(path: string, action: Action): Promise<Outcome> {
  return invoke<Outcome>("run_action", { path, action });
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
