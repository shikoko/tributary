import { useLayoutEffect, useRef } from "react";
import { animate } from "../lib/motion";

/** What makes up the view: a repository's toolbar, workspace and status bar, or the start screen. */
const VIEW = ".app > .toolbar, .app > .workspace, .app > .status-bar, .app > .welcome, .app > .simple-view";

/**
 * The view fades in quickly when it becomes another one (another tab, a repository opened,
 * back to the start screen), instead of switching at once. Not when the app first shows.
 */
export function useViewFade(key: string) {
  const last = useRef<string | null>(null);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = key;
    if (before === null || before === key) return;
    for (const element of document.querySelectorAll(VIEW)) animate(element, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 200 });
  }, [key]);
}
