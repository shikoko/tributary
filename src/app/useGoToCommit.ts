import { useCallback, useEffect, useRef, useState } from "react";
import { PAGE_SIZE, type RepoSnapshot } from "../api";
import type { LoadMode } from "./useRepository";

/** Older history is loaded up to this many commits to find one; past it, it says so. */
const MOST = 200_000;

interface Options {
  snapshot: RepoSnapshot;
  load: (path: string, mode: LoadMode, limit?: number) => Promise<void>;
  select: (id: string) => void;
  /** It isn't in the graph as it's shown, even with all of it loaded (or as much as it loads). */
  onMissing: (reason: "hidden" | "far") => void;
}

/**
 * Going to a commit: selecting it, and loading older history first when it isn't loaded yet
 * (in pages twice as big each time), so the list scrolls to it and outlines it.
 */
export function useGoToCommit({ snapshot, load, select, onMissing }: Options) {
  const [wanted, setWanted] = useState<{ id: string; path: string } | null>(null);
  const loading = useRef(false);
  const callbacks = useRef({ load, select, onMissing });
  callbacks.current = { load, select, onMissing };

  useEffect(() => {
    if (!wanted || loading.current) return;
    // Another repository opened meanwhile: not this one's commit.
    if (snapshot.path !== wanted.path) {
      setWanted(null);
      return;
    }
    if (snapshot.commits.some((commit) => commit.id === wanted.id)) {
      setWanted(null);
      callbacks.current.select(wanted.id);
      return;
    }
    const loaded = snapshot.commits.length;
    if (!snapshot.truncated || loaded >= MOST) {
      setWanted(null);
      callbacks.current.onMissing(snapshot.truncated ? "far" : "hidden");
      return;
    }
    loading.current = true;
    void callbacks.current
      .load(snapshot.path, "more", Math.min(MOST, Math.max(loaded * 2, loaded + PAGE_SIZE)))
      .finally(() => {
        loading.current = false;
        // Look again with what's loaded now.
        setWanted((current) => (current ? { ...current } : current));
      });
  }, [wanted, snapshot]);

  const goTo = useCallback(
    (id: string) => {
      if (snapshot.commits.some((commit) => commit.id === id)) select(id);
      else setWanted({ id, path: snapshot.path });
    },
    [snapshot, select],
  );

  return { goTo, finding: wanted !== null };
}
