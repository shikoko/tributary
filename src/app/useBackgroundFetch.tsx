import { useEffect, useRef, useState } from "react";
import { commitsBetween, remoteState, runAction, type RepoSnapshot } from "../api";
import { BellIcon } from "../components/Icons";
import type { Tab } from "../components/TabBar";
import type { ToastMessage } from "../components/Toast";
import { describeNews, findNews, remoteTips, watchedFor, type News } from "../lib/news";
import { notifySystem } from "../lib/notify";
import { FIRST_AUTO_FETCH_DELAY } from "./constants";
import type { NewCommitNotices } from "./usePreferences";

interface Options {
  /** The open repository. */
  snapshot: RepoSnapshot | null;
  /** Every open tab: the others are fetched too. */
  tabs: Tab[];
  enabled: boolean;
  minutes: number;
  notices: NewCommitNotices;
  /** Something else is going on (a dialog, an action): don't fetch the open repository now. */
  isBusy: () => boolean;
  /** After the open repository was fetched: reload it, and what depends on its remote. */
  afterFetch: () => void;
  notify: (toast: ToastMessage) => void;
  pull: () => void;
  show: (commitId: string) => void;
  switchTab: (path: string) => void;
}

/**
 * Fetch every open repository every few minutes, so the pull and push counts stay current,
 * and tell you about new commits on main or on the branch yours tracks. Returns what
 * arrived in the other tabs, by path, until you open them.
 */
export function useBackgroundFetch(options: Options): Record<string, string> {
  const latest = useRef(options);
  latest.current = options;
  const { snapshot, enabled, minutes, notices } = options;
  const repoPath = snapshot?.path ?? null;
  const canFetch = Boolean(snapshot && !snapshot.bare && snapshot.remotes.length > 0);
  // With system notifications, keep fetching while the window is minimized, so news still arrives.
  const whileHidden = notices === "system";
  const every = Math.max(1, minutes) * 60 * 1000;

  // The open repository. Its news is worked out from the next snapshot.
  const pending = useRef<{ path: string; before: Map<string, string>; known: Set<string> } | null>(null);
  useEffect(() => {
    if (!repoPath || !canFetch || !enabled) return;
    let stopped = false;
    const fetchNow = async () => {
      const { snapshot, isBusy, afterFetch } = latest.current;
      if (stopped || !snapshot || snapshot.path !== repoPath || isBusy()) return;
      if (document.hidden && !whileHidden) return;
      const before = remoteTips(snapshot);
      const known = new Set(snapshot.commits.map((commit) => commit.id));
      try {
        await runAction(repoPath, { kind: "fetch", background: true });
        if (stopped) return;
        pending.current = { path: repoPath, before, known };
        afterFetch();
      } catch {
        // Usually missing credentials or no network. Fetching by hand shows the reason;
        // don't try again in the background until then.
        stopped = true;
      }
    };
    const first = setTimeout(fetchNow, FIRST_AUTO_FETCH_DELAY);
    const timer = setInterval(fetchNow, every);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [repoPath, canFetch, enabled, every, whileHidden]);

  useEffect(() => {
    const waiting = pending.current;
    if (!snapshot || !waiting || waiting.path !== snapshot.path) return;
    pending.current = null;
    const { notices, notify, pull, show } = latest.current;
    if (notices === "off") return;
    const news = findNews(waiting.before, waiting.known, snapshot);
    if (news.length === 0) return;
    // Your own branch's news first.
    news.sort((a, b) => Number(b.branch === snapshot.upstream?.name) - Number(a.branch === snapshot.upstream?.name));
    const top = news[0];
    const pullable = top.branch === snapshot.upstream?.name && !snapshot.operation;
    notify({
      text: describeNews(top) + (news.length > 1 ? `, and more on ${news.length - 1} other ${news.length === 2 ? "branch" : "branches"}` : ""),
      icon: <BellIcon size={14} />,
      action: pullable ? { label: "Pull", onClick: pull } : { label: "Show", onClick: () => show(top.tip) },
    });
    if (notices === "system" && !document.hasFocus()) {
      for (const item of news) notifySystem(snapshot.name, describeNews(item));
    }
  }, [snapshot]);

  // The other tabs. Tabs with new commits get a dot until they're opened.
  const [tabNews, setTabNews] = useState<Record<string, string>>({});
  const failures = useRef(new Map<string, number>());
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const announce = (tab: Tab, news: News[]) => {
      setTabNews((current) => ({ ...current, [tab.path]: news.map(describeNews).join("\n") }));
      const { notices, notify, switchTab } = latest.current;
      if (notices === "off") return;
      notify({
        text: `${tab.name}: ${describeNews(news[0])}`,
        icon: <BellIcon size={14} />,
        action: { label: "Open", onClick: () => switchTab(tab.path) },
      });
      if (notices === "system" && !document.hasFocus()) {
        for (const item of news) notifySystem(tab.name, describeNews(item));
      }
    };
    const fetchOthers = async () => {
      for (const tab of latest.current.tabs) {
        if (stopped || (document.hidden && !whileHidden)) return;
        if (tab.path === latest.current.snapshot?.path) continue;
        // Missing credentials or no network: leave it alone for half an hour.
        const failed = failures.current.get(tab.path);
        if (failed && Date.now() - failed < 30 * 60 * 1000) continue;
        try {
          const before = await remoteState(tab.path);
          if (before.remotes.length === 0) continue;
          await runAction(tab.path, { kind: "fetch", background: true });
          const after = await remoteState(tab.path);
          const news: News[] = [];
          for (const branch of watchedFor(after.upstream, after.remotes)) {
            const old = before.tips[branch];
            const tip = after.tips[branch];
            if (!old || !tip || old === tip) continue;
            const { count, authors } = await commitsBetween(tab.path, old, tip);
            if (count > 0) news.push({ branch, tip, count, authors });
          }
          failures.current.delete(tab.path);
          if (news.length > 0 && !stopped) {
            news.sort((a, b) => Number(b.branch === after.upstream) - Number(a.branch === after.upstream));
            announce(tab, news);
          }
        } catch {
          failures.current.set(tab.path, Date.now());
        }
      }
    };
    // A little after the open tab's own fetch.
    const first = setTimeout(fetchOthers, FIRST_AUTO_FETCH_DELAY + 15_000);
    const timer = setInterval(fetchOthers, every);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, every, whileHidden]);

  // Opening a tab reads its news.
  useEffect(() => {
    if (repoPath) {
      setTabNews((current) =>
        repoPath in current ? Object.fromEntries(Object.entries(current).filter(([path]) => path !== repoPath)) : current,
      );
    }
  }, [repoPath]);

  return tabNews;
}
