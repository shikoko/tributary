import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { initRepository, openRepository, PAGE_SIZE, type Action, type RepoSnapshot } from "../api";
import { loadPlace, type Place } from "../lib/place";
import { loadRecent, noteBranch, rememberRepo } from "../lib/recent";
import { readVisibility } from "../lib/repoPrefs";
import { readSetting } from "../lib/settings";
import type { Tab } from "../components/TabBar";
import type { Busy } from "./constants";
import { setWindowTitle } from "./window";

export type LoadMode = "open" | "refresh" | "more";

/** An error shown above the commit list, with what can be done about it. */
export interface RepoError {
  message: string;
  /** Stash the changes in the way and run this again. */
  retry?: Action;
  /** The branch is checked out in this other working tree. */
  worktree?: string;
  /** A hook stopped this commit or push: it again, without the hook. */
  skipHooks?: Action;
}

/** What the rest of the app does when the open repository changes. */
export interface RepositoryEvents {
  /** A repository was opened (a new one, or another tab): start fresh, back at `place`. Comes after `shown`. */
  opened: (next: RepoSnapshot, place: Place | null) => void;
  /** New data for the open repository: after opening, refreshing or loading more. */
  shown: (next: RepoSnapshot, mode: LoadMode) => void;
  /** No repository is open any more. */
  closed: () => void;
  /** Something to tell the user, like "Created a repository in …". */
  notify: (text: string) => void;
}

interface Options {
  setTabs: (update: (tabs: Tab[]) => Tab[]) => void;
  setActiveTab: (path: string | null) => void;
  /** Load only the checked-out branch's first-parent history. */
  firstParentOnly: boolean;
  events: RepositoryEvents;
}

/**
 * The open repository: loading it (graph first, then uncommitted changes), refreshing it,
 * opening, creating and closing repositories, and reopening the last one on launch.
 */
export function useRepository({ setTabs, setActiveTab, firstParentOnly, events }: Options) {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<RepoError | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  /** Increases with every load, so answers to older loads can be ignored. */
  const loadCount = useRef(0);
  /** When the last load finished, in milliseconds. */
  const lastLoad = useRef(0);
  /** True while something loads or a file picker is open: refreshing on focus waits. */
  const blockFocusRefresh = useRef(false);
  // The latest options, so `load` stays the same function.
  const latest = useRef({ firstParentOnly, events, setTabs, setActiveTab });
  latest.current = { firstParentOnly, events, setTabs, setActiveTab };

  const load = useCallback(async (path: string, mode: LoadMode, limit = PAGE_SIZE) => {
    const { firstParentOnly: firstParent, events, setTabs, setActiveTab } = latest.current;
    const request = ++loadCount.current;
    blockFocusRefresh.current = true;
    setBusy(mode === "open" ? { kind: "open", path } : { kind: mode });
    setError(null);
    const current = () => request === loadCount.current;
    const show = (next: RepoSnapshot) => {
      setSnapshot(next);
      events.shown(next, mode);
      setRecent(noteBranch(next.path, next.headBranch));
    };
    try {
      if (mode === "open") {
        // Show the graph first: reading uncommitted changes can take a while in big
        // working trees, so they follow in a second load.
        const next = await openRepository(path, limit, false, firstParent, readVisibility(path));
        if (!current()) return;
        show(next);
        events.opened(next, loadPlace(next.path));
        setRecent(rememberRepo(next.path, next.name, next.headBranch));
        setTabs((tabs) => {
          const tab = { path: next.path, name: next.name };
          const index = tabs.findIndex((t) => t.path === next.path || t.path === path);
          return index < 0 ? [...tabs, tab] : tabs.map((t, i) => (i === index ? tab : t));
        });
        setActiveTab(next.path);
        setWindowTitle(`${next.name} — Tributary`);
        setBusy(null);
        const full = await openRepository(path, limit, true, firstParent, readVisibility(next.path)).catch(() => null);
        if (current() && full?.worktree) setSnapshot(full);
      } else {
        // The graph is already on screen, so load everything at once to avoid flicker.
        const next = await openRepository(path, limit, true, firstParent, readVisibility(path));
        if (current()) show(next);
      }
    } catch (e) {
      if (current()) setError({ message: String(e) });
    } finally {
      if (current()) {
        setBusy(null);
        blockFocusRefresh.current = false;
        lastLoad.current = Date.now();
      }
    }
  }, []);

  /** Reload the open repository, keeping as many commits as are loaded now. */
  const refresh = useCallback(() => {
    if (snapshot) load(snapshot.path, "refresh", Math.max(PAGE_SIZE, snapshot.commits.length));
  }, [snapshot, load]);

  /** Run `work` (which shows a file picker) without refreshing when the window gets the focus back. */
  const whilePicking = useCallback(async (work: () => Promise<void>) => {
    blockFocusRefresh.current = true;
    try {
      await work();
    } catch (e) {
      setError({ message: String(e) });
    } finally {
      blockFocusRefresh.current = false;
    }
  }, []);

  const pick = useCallback(
    () =>
      whilePicking(async () => {
        const path = await open({ directory: true, multiple: false, title: "Open a git repository" });
        if (typeof path === "string") await load(path, "open");
      }),
    [whilePicking, load],
  );

  /** Create a repository in a folder you choose, and open it. */
  const create = useCallback(
    () =>
      whilePicking(async () => {
        const path = await open({ directory: true, multiple: false, title: "Choose a folder for the new repository" });
        if (typeof path !== "string") return;
        const message = await initRepository(path);
        await load(path, "open");
        latest.current.events.notify(message);
      }),
    [whilePicking, load],
  );

  /** Close the repository, for the start screen. */
  const close = useCallback(() => {
    loadCount.current++;
    setSnapshot(null);
    setError(null);
    setBusy(null);
    blockFocusRefresh.current = false;
    latest.current.events.closed();
    latest.current.setActiveTab(null);
    setWindowTitle("Tributary");
  }, []);

  // Reopen your tabs (or the last repository) on launch.
  useEffect(() => {
    if (!readSetting("reopenLast", true)) return;
    const active = readSetting<string | null>("tabs.active", null);
    const tabs = readSetting<Tab[]>("tabs.list", []);
    const path = active ?? tabs[0]?.path ?? loadRecent()[0]?.path;
    if (path) load(path, "open");
  }, [load]);

  return { snapshot, busy, error, setError, recent, setRecent, load, refresh, pick, create, close, whilePicking, blockFocusRefresh, lastLoad };
}

export type Repository = ReturnType<typeof useRepository>;
