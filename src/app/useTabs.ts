import { useCallback, useEffect, useState } from "react";
import type { RepoSnapshot } from "../api";
import type { Tab } from "../components/TabBar";
import { moved } from "../lib/order";
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

/** How many closed tabs can be opened again, the last closed first. */
const CLOSED_TABS = 10;

/** A closed tab, and its place in the tab bar when it was closed. */
interface ClosedTab {
  tab: Tab;
  index: number;
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
  /** Tabs closed lately, to open again (Ctrl+Shift+R), the last closed last. */
  const [closed, setClosed] = useState<ClosedTab[]>([]);
  const remember = useCallback((gone: ClosedTab[]) => {
    const paths = new Set(gone.map((each) => each.tab.path));
    setClosed((list) => [...list.filter((each) => !paths.has(each.tab.path)), ...gone].slice(-CLOSED_TABS));
  }, []);

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
      if (index >= 0) remember([{ tab: tabs[index], index }]);
      setTabs(remaining);
      if (snapshot?.path !== path) return;
      rememberPlace();
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next) load(next.path, "open");
      else close();
    },
    [tabs, setTabs, snapshot, rememberPlace, load, close, remember],
  );

  /** Close every tab but this one, switching to it. */
  const closeOthers = useCallback(
    (path: string) => {
      const kept = tabs.filter((tab) => tab.path === path);
      if (kept.length === 0) return;
      // Right to left, so they come back left to right, each in its own place.
      remember(
        tabs
          .map((tab, index) => ({ tab, index }))
          .filter(({ tab }) => tab.path !== path)
          .reverse(),
      );
      setTabs(kept);
      if (snapshot?.path !== path) {
        rememberPlace();
        load(path, "open");
      }
    },
    [tabs, setTabs, snapshot, rememberPlace, load, remember],
  );

  /** The tabs closed lately that aren't open again already, the last closed last. */
  const reopenable = closed.filter((each) => !tabs.some((tab) => tab.path === each.tab.path));

  /** The tab closed last, back in its place and open (with its repository as you left it). */
  const reopenTab = useCallback(() => {
    const last = reopenable[reopenable.length - 1];
    setClosed(reopenable.slice(0, -1));
    if (!last) return;
    setTabs([...tabs.slice(0, last.index), last.tab, ...tabs.slice(last.index)]);
    rememberPlace();
    load(last.tab.path, "open");
  }, [reopenable, tabs, setTabs, rememberPlace, load]);

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

  /** A tab put at another place, dragged there. */
  const moveTab = useCallback(
    (path: string, to: number) => {
      const from = tabs.findIndex((tab) => tab.path === path);
      if (from < 0 || to === from || to < 0 || to >= tabs.length) return;
      setTabs(moved(tabs, from, to));
    },
    [tabs, setTabs],
  );

  /** Ctrl+Shift+Page Up and Page Down, or the tab's menu: a tab one place left or right. */
  const nudgeTab = (path: string, step: -1 | 1) => {
    const from = tabs.findIndex((tab) => tab.path === path);
    if (from >= 0) moveTab(path, from + step);
  };

  return { startTab: startTab !== null, switchTab, closeTab, closeOthers, reopenTab, canReopen: reopenable.length > 0, newTab, closeStartTab, closeCurrent, cycle, moveTab, nudgeTab };
}
