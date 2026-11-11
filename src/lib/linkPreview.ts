import { useSyncExternalStore } from "react";

/** What opens a page in the browser: marked with the page (`data-url`), or a web link. */
const LINKS = "[data-url], a[href]";

function urlOf(target: EventTarget | null): string | null {
  const link = target instanceof Element ? target.closest(LINKS) : null;
  if (!link) return null;
  const marked = link.getAttribute("data-url");
  if (marked) return marked;
  return link instanceof HTMLAnchorElement && /^https?:/.test(link.href) ? link.href : null;
}

let current: string | null = null;
const listeners = new Set<() => void>();
let watching = false;

function show(url: string | null) {
  if (url === current) return;
  current = url;
  for (const listener of listeners) listener();
}

/** Follows the pointer and the keyboard's focus, once, for the whole window. */
function watch() {
  if (watching) return;
  watching = true;
  const over = (event: Event) => show(urlOf(event.target));
  // Leaving for somewhere that isn't a link (or out of the window).
  const out = (event: PointerEvent | FocusEvent) => show(urlOf(event.relatedTarget));
  document.addEventListener("pointerover", over);
  document.addEventListener("pointerout", out);
  document.addEventListener("focusin", over);
  document.addEventListener("focusout", out);
}

/**
 * The address of the page that what's pointed at (or has the keyboard's focus) opens in the
 * browser, or null: for showing it at the bottom of the window, as browsers do.
 */
export function useLinkUrl(): string | null {
  return useSyncExternalStore(
    (listener) => {
      watch();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
