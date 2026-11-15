import { useEffect, useState } from "react";

/**
 * Below this window width, the sidebar is a strip of icons beside the commit list, and opens
 * over the list from them: beside the details panel, its full width left the list too little.
 */
export const STRIP_BELOW = 1100;

/** Whether the window is narrower than STRIP_BELOW, following it as it's resized. */
export function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < STRIP_BELOW);
  useEffect(() => {
    const follow = () => setNarrow(window.innerWidth < STRIP_BELOW);
    window.addEventListener("resize", follow);
    return () => window.removeEventListener("resize", follow);
  }, []);
  return narrow;
}
