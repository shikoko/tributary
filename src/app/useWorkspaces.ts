import { useCallback, useRef, useState } from "react";
import { errorKind, remoteState, runAction, type Action } from "../api";
import type { Tab } from "../components/TabBar";
import type { ToastMessage } from "../components/Toast";
import { useStoredState } from "../lib/settings";
import {
  addWorkspace,
  currentWorkspace,
  editWorkspace,
  everyTab,
  foldersToGroup,
  freeColor,
  groupByFolder,
  moveTab,
  readWorkspaces,
  removeWorkspace,
  switchTo,
  tabsOf,
  workspaceOf,
} from "../lib/workspaces";

interface Options {
  /** The open workspace's tabs: the tab bar's. */
  tabs: Tab[];
  setTabs: (tabs: Tab[]) => void;
  /** The open repository. */
  openPath: string | null;
  load: (path: string, mode: "open") => void;
  /** Close the repository, showing the start screen. */
  close: () => void;
  rememberPlace: () => void;
  /** An action in the open repository, the usual way (its progress, its errors shown there). */
  act: (action: Action) => Promise<unknown>;
  notify: (toast: ToastMessage) => void;
}

/** Fetch every repository in a workspace, or bring each up to date where that's a fast-forward. */
export type RunAll = "fetch" | "pull";

/** Why a repository wasn't brought up to date, in a sentence. */
function whyNot(error: unknown): string {
  const kind = errorKind(error)?.kind;
  if (kind === "changesInTheWay") return "its uncommitted changes were in the way";
  if (kind === "notEnoughSpace") return "there isn't enough space on the disk";
  return String(error).split("\n")[0];
}

/**
 * Workspaces (src/lib/workspaces.ts): which is open, switching between them (each keeps its
 * tabs and the repository open in it), moving tabs, and fetching or pulling each one's
 * repositories together.
 */
export function useWorkspaces({ tabs, setTabs, openPath, load, close, rememberPlace, act, notify }: Options) {
  const [stored, setStored] = useStoredState<unknown>("tabs.workspaces", null);
  const state = readWorkspaces(stored);
  const current = currentWorkspace(state);
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  /** Goes up when a Fetch all or Pull all ends, for the overview to ask again where each stands. */
  const [ran, setRan] = useState(0);
  const latest = useRef({ state, tabs, openPath });
  latest.current = { state, tabs, openPath };

  /** Switch to workspace `id`, opening `path` in it (or what was open in it). */
  const switchWorkspace = useCallback(
    (id: string, path?: string) => {
      const { state, tabs, openPath } = latest.current;
      const switched = switchTo(state, id, tabs, openPath);
      if (!switched) {
        if (path) load(path, "open");
        return;
      }
      rememberPlace();
      setStored(switched.state);
      setTabs(switched.tabs);
      const open = path ?? switched.open;
      if (open) load(open, "open");
      else close();
    },
    [load, close, rememberPlace, setStored, setTabs],
  );

  /** A repository opened in the workspace it's in (switching to it), or in the open one. */
  const openRepository = useCallback(
    (path: string) => {
      const { state, tabs } = latest.current;
      const holder = workspaceOf(state, path, tabs);
      if (holder && holder.id !== state.current) switchWorkspace(holder.id, path);
      else load(path, "open");
    },
    [switchWorkspace, load],
  );

  /** A new, empty workspace, switched to (the start screen, to open repositories in it). */
  const create = useCallback(
    (name: string, color: number) => {
      const added = addWorkspace(latest.current.state, name, color);
      setStored(added.state);
      // Once it's stored: switching reads it.
      latest.current = { ...latest.current, state: added.state };
      switchWorkspace(added.id);
    },
    [setStored, switchWorkspace],
  );

  const edit = useCallback((id: string, change: { name?: string; color?: number }) => setStored(editWorkspace(latest.current.state, id, change)), [setStored]);

  /** Workspace `id` gone, its tabs brought into the open one. */
  const remove = useCallback(
    (id: string) => {
      const { state, tabs } = latest.current;
      const removed = removeWorkspace(state, id, tabs);
      if (!removed) return;
      setStored(removed.state);
      setTabs(removed.tabs);
    },
    [setStored, setTabs],
  );

  /** The open workspace's tab for `path` moved into workspace `id`; the next tab opens if it was the open one. */
  const moveTabTo = useCallback(
    (path: string, id: string) => {
      const { state, tabs, openPath } = latest.current;
      const moved = moveTab(state, path, id, tabs);
      if (!moved) return;
      setStored(moved.state);
      setTabs(moved.tabs);
      if (openPath !== path) return;
      rememberPlace();
      const index = tabs.findIndex((tab) => tab.path === path);
      const next = moved.tabs[Math.min(index, moved.tabs.length - 1)];
      if (next) load(next.path, "open");
      else close();
    },
    [setStored, setTabs, rememberPlace, load, close],
  );

  /** A workspace for each folder the open tabs are in (when that makes two or more). */
  const groupOffer = state.list.length === 1 ? foldersToGroup(tabs) : null;
  const group = useCallback(() => {
    const { state, tabs, openPath } = latest.current;
    const grouped = groupByFolder(state, tabs, openPath);
    if (!grouped) return;
    setStored(grouped.state);
    setTabs(grouped.tabs);
  }, [setStored, setTabs]);

  /** Fetch every repository in workspace `id`, or pull each where that's a fast-forward, one after another; then say how it went. */
  const runAll = useCallback(
    async (id: string, what: RunAll) => {
      const { state, tabs, openPath } = latest.current;
      const workspace = state.list.find((each) => each.id === id);
      if (!workspace) return;
      setRunning((now) => new Set(now).add(id));
      const failed: string[] = [];
      let done = 0;
      const list = tabsOf(state, id, tabs);
      for (const tab of list) {
        try {
          if (tab.path === openPath) {
            if (await act(what === "fetch" ? { kind: "fetch" } : { kind: "fetchLatest" })) done++;
            else failed.push(`${tab.name} (its tab says why)`);
            continue;
          }
          const remote = await remoteState(tab.path);
          if (remote.remotes.length === 0) {
            failed.push(`${tab.name} (it has no remote)`);
            continue;
          }
          if (what === "pull" && !remote.upstream) {
            failed.push(`${tab.name} (its branch isn't on a remote)`);
            continue;
          }
          await runAction(tab.path, what === "fetch" ? { kind: "fetch", background: true } : { kind: "fetchLatest" });
          done++;
        } catch (error) {
          failed.push(`${tab.name} (${whyNot(error)})`);
        }
      }
      setRunning((now) => {
        const next = new Set(now);
        next.delete(id);
        return next;
      });
      setRan((count) => count + 1);
      const verb = what === "fetch" ? "Fetched" : "Pulled";
      const text =
        list.length === 0
          ? `${workspace.name} has no repositories yet`
          : failed.length === 0
            ? `${workspace.name}: ${verb.toLowerCase()} ${list.length === 1 ? list[0].name : `all ${list.length} repositories`}`
            : `${workspace.name}: ${verb.toLowerCase()} ${done} of ${list.length}; not ${failed.join(", ")}`;
      notify({ text });
    },
    [act, notify],
  );

  return {
    state,
    current,
    /** Every repository in every workspace, each once: for fetching them in the background, say. */
    all: everyTab(state, tabs),
    running,
    ran,
    switchWorkspace,
    openRepository,
    create,
    edit,
    remove,
    moveTabTo,
    groupOffer,
    group,
    runAll,
    freeColor: () => freeColor(state),
  };
}

export type WorkspacesHandle = ReturnType<typeof useWorkspaces>;
