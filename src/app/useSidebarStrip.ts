import { useEffect, useRef, useState } from "react";
import { useNarrowWindow } from "../lib/useNarrowWindow";

/** What opens over the sidebar's strip without closing it: a menu or dialog from the sidebar. */
const OVER = ".context-menu, .menu-backdrop, .dialog-backdrop";

/**
 * The sidebar in a narrow window (useNarrowWindow): a strip of icons, and which of its sections
 * is open over the commit list, if any. A click outside it, or Esc, closes it, and Esc puts the
 * focus back on the icon that opened it. Widening the window forgets it.
 */
export function useSidebarStrip() {
  const narrow = useNarrowWindow();
  const [chosen, setChosen] = useState<string | null>(null);
  const [wasNarrow, setWasNarrow] = useState(narrow);
  if (wasNarrow !== narrow) {
    setWasNarrow(narrow);
    if (!narrow) setChosen(null);
  }
  const open = narrow ? chosen : null;
  const over = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || over.current?.contains(target) || target.closest(`.sidebar-strip, ${OVER}`)) return;
      setChosen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector(OVER)) return;
      event.stopPropagation();
      setChosen(null);
      document.querySelector<HTMLElement>(`.sidebar-strip [data-section="${open}"]`)?.focus();
    };
    window.addEventListener("mousedown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("mousedown", outside, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return {
    narrow,
    open,
    over,
    /** Opens a section over the list, or closes it when it's the one open. */
    toggle: (id: string) => setChosen((current) => (current === id ? null : id)),
  };
}
