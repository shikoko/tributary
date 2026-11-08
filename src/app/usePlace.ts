import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoSnapshot } from "../api";
import { savePlace, type Place } from "../lib/place";

/** Where you are in the open repository (the selected commit and how far the list is scrolled), remembered per repository. */
export function usePlace(snapshot: RepoSnapshot | null, selectedId: string | null) {
  /** How far the commit list is scrolled now. */
  const scrollTop = useRef(0);
  /** Where the commit list starts scrolled to, for the repository that was just opened. */
  const [initialScroll, setInitialScroll] = useState(0);

  const rememberPlace = useCallback(() => {
    if (snapshot) savePlace(snapshot.path, { selectedId, scrollTop: scrollTop.current });
  }, [snapshot, selectedId]);

  // Save your place a moment after you stop moving around.
  useEffect(() => {
    const timer = setTimeout(rememberPlace, 400);
    return () => clearTimeout(timer);
  }, [rememberPlace]);

  /** A repository was opened: start where you were in it. */
  const restore = useCallback((place: Place | null) => {
    scrollTop.current = place?.scrollTop ?? 0;
    setInitialScroll(scrollTop.current);
  }, []);

  const onScroll = useCallback((top: number) => {
    scrollTop.current = top;
  }, []);

  return { initialScroll, rememberPlace, restore, onScroll };
}
