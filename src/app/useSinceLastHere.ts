import { useEffect, useRef, useState } from "react";
import { sinceThen, type RepoSnapshot, type SinceThen } from "../api";
import { remoteTips, watchedBranches } from "../lib/news";
import { loadSeen, saveSeen, sortSince } from "../lib/sinceHere";

/** What arrived since you were last here, and when that was. */
export interface SinceLastHere {
  at: number;
  /** The branches with news, your own branch's first. */
  branches: SinceThen[];
}

/** Where the branches you follow point now. */
function tipsOf(snapshot: RepoSnapshot): Record<string, string> {
  const tips = remoteTips(snapshot);
  return Object.fromEntries(watchedBranches(snapshot).flatMap((branch) => (tips.has(branch) ? [[branch, tips.get(branch)!]] : [])));
}

/**
 * What arrived on the remote branches you follow (main, and the one yours tracks) since you
 * last had the repository open: by others, with which of your locked files they changed.
 *
 * Where those branches point is remembered whenever the repository is left (another tab, the
 * window hidden or closed) and as it changes while you're on it. Opening the repository again
 * compares with what was remembered, and keeps comparing with it as fetches bring more,
 * until `dismiss`. Nothing scrolls or moves: this only says.
 */
export function useSinceLastHere(snapshot: RepoSnapshot | null, myLocks: string[]): { since: SinceLastHere | null; dismiss: () => void } {
  const path = snapshot?.path ?? null;
  // What was remembered when this repository was opened here.
  const [baseline, setBaseline] = useState<{ path: string; seen: ReturnType<typeof loadSeen> } | null>(null);
  const [found, setFound] = useState<(SinceLastHere & { path: string }) | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (path && baseline?.path !== path) {
    // Read once per opening, before anything new is remembered.
    setBaseline({ path, seen: loadSeen(path) });
    setFound(null);
    setDismissed(null);
  }

  const tips = snapshot ? tipsOf(snapshot) : null;
  const tipsKey = tips ? JSON.stringify(tips) : "";
  const locksKey = myLocks.join("\n");

  // What arrived since then, asked again as the branches move.
  useEffect(() => {
    const seen = baseline?.seen;
    if (!path || !seen || baseline.path !== path || dismissed === path) return;
    const asked = Object.entries(seen.tips)
      .filter(([branch, commit]) => tips?.[branch] && tips[branch] !== commit)
      .map(([branch, commit]) => ({ branch, commit }));
    if (asked.length === 0) {
      setFound(null);
      return;
    }
    let current = true;
    sinceThen(path, asked, locksKey ? locksKey.split("\n") : []).then(
      (branches) => current && setFound(branches.length > 0 ? { path, at: seen.at, branches: sortSince(branches, snapshot?.upstream?.name ?? null) } : null),
      () => {},
    );
    return () => {
      current = false;
    };
    // tips and snapshot change with every refresh; their key says when the branches moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, baseline, tipsKey, locksKey, dismissed]);

  // Remember where the branches are: as they move while you're here, and as you leave (the
  // repository's last state, kept here, since by the time another one is open it's that one's).
  const last = useRef<{ path: string; tips: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!path || !tips || Object.keys(tips).length === 0) return;
    last.current = { path, tips };
    saveSeen(path, { at: Date.now(), tips });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tipsKey]);
  useEffect(() => {
    const remember = () => {
      const now = last.current;
      if (now) saveSeen(now.path, { at: Date.now(), tips: now.tips });
    };
    const onHide = () => {
      if (document.hidden) remember();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", remember);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", remember);
      remember();
    };
  }, [path]);

  const since = found && found.path === path && dismissed !== path ? { at: found.at, branches: found.branches } : null;
  return { since, dismiss: () => setDismissed(path) };
}
