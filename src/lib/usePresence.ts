import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * For a panel that animates open and closed: whether to render it, and whether it's on its
 * way out (kept on screen for `ms` after `open` turns false, with what it last showed).
 */
export function usePresence(open: boolean, content: ReactNode, ms = 160): { shown: boolean; closing: boolean; content: ReactNode } {
  const [closing, setClosing] = useState(false);
  const last = useRef<ReactNode>(null);
  const wasOpen = useRef(open);
  if (open) last.current = content;

  useEffect(() => {
    if (wasOpen.current && !open) {
      setClosing(true);
      const timer = setTimeout(() => setClosing(false), ms);
      wasOpen.current = open;
      return () => clearTimeout(timer);
    }
    wasOpen.current = open;
    setClosing(false);
  }, [open, ms]);

  // Reduced motion: no animation, so nothing to wait for.
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const leaving = closing && !open && !still;
  return { shown: open || leaving, closing: leaving, content: open ? content : last.current };
}
