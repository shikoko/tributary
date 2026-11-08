import { useEffect, useRef, useState } from "react";
import { repoSummary, type RepoSummary } from "../api";
import type { RecentRepo } from "../lib/recent";

/** Not asked again sooner than this when the window comes back into focus. */
const MIN_INTERVAL = 15_000;

/**
 * Where each recent repository stands (its branch, ahead and behind, changes), asked for
 * each one on its own so quick ones show first, and again when the window comes back.
 */
export function useRecentSummaries(recent: RecentRepo[], active: boolean): Map<string, RepoSummary> {
  const [summaries, setSummaries] = useState<Map<string, RepoSummary>>(() => new Map());
  const asked = useRef(0);
  const paths = recent.map((repo) => repo.path).join("\n");

  useEffect(() => {
    if (!active || !paths) return;
    let current = true;
    const ask = () => {
      asked.current = Date.now();
      for (const path of paths.split("\n")) {
        repoSummary(path)
          .then((summary) => current && setSummaries((known) => new Map(known).set(path, summary)))
          .catch(() => {});
      }
    };
    ask();
    const onFocus = () => Date.now() - asked.current > MIN_INTERVAL && ask();
    window.addEventListener("focus", onFocus);
    return () => {
      current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [paths, active]);

  return summaries;
}
