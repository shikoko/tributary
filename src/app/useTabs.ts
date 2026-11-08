import { useCallback, useEffect, useState } from "react";
import type { RepoSnapshot } from "../api";
import type { Tab } from "../components/TabBar";
import type { LoadMode } from "./useRepository";

interface Options {
  tabs: Tab[];
  setTabs: (tabs: Tab[]) => void;
  snapshot: RepoSnapshot | null;
  load: (path: string, mode: LoadMode) => void;
  /** Close the repository, showing the start screen. */
  close: () => void;
  /** Remember where you are in the open repository, before leaving it. */
  rememberPlace: () => void;
}

/**
 * Tabs: one per open repository, plus the "New tab" start screen (open, clone, create,
 * or a recent repository) in a tab of its own, which opening anything replaces.
 */
export function useTabs({ tabs, setTabs, snapshot, load, close, rememberPlace }: Options) {
  /** The start screen's tab, and the tab it was opened from, to go back to if it's closed. */
  const [startTab, setStartTab] = useState<{ returnTo: string } | null>(null);
  useEffect(() => {
    if (snapshot) setStartTab(null);
  }, [snapshot]);

  const switchTab = useCallback(
    (path: string) => {
      if (snapshot?.path === path) return;
      rememberPlace();
      load(path, "open");
    },
    [snapshot, rememberPlace, load],
  );

  const closeTab = useCallback(
    (path: string) => {
      const index = tabs.findIndex((tab) => tab.path === path);
      const remaining = tabs.filter((tab) => tab.path !== path);
      setTabs(remaining);
      if (snapshot?.path !== path) return;
      rememberPlace();
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next) load(next.path, "open");
      else close();
    },
    [tabs, setTabs, snapshot, rememberPlace, load, close],
  );

  const newTab = useCallback(() => {
    // Without a repository open, the start screen is already showing.
    if (!snapshot) return;
    rememberPlace();
    setStartTab({ returnTo: snapshot.path });
    close();
  }, [snapshot, rememberPlace, close]);

  const closeStartTab = useCallback(() => {
    const back = startTab && tabs.find((tab) => tab.path === startTab.returnTo);
    setStartTab(null);
    const next = back ?? tabs[tabs.length - 1];
    if (next) load(next.path, "open");
  }, [startTab, tabs, load]);

  /** ⌘W: the open repository's tab, or the start screen's. */
  const closeCurrent = () => {
    if (snapshot) closeTab(snapshot.path);
    else if (startTab) closeStartTab();
  };

  /** Ctrl+Tab and Ctrl+Shift+Tab. */
  const cycle = (backwards: boolean) => {
    if (tabs.length < 2 || !snapshot) return;
    const index = tabs.findIndex((tab) => tab.path === snapshot.path);
    switchTab(tabs[(index + (backwards ? tabs.length - 1 : 1)) % tabs.length].path);
  };

  return { startTab: startTab !== null, switchTab, closeTab, newTab, closeStartTab, closeCurrent, cycle };
}
