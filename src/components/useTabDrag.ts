import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { animate } from "../lib/motion";
import { dropIndex, type Slot } from "../lib/order";

/** How far the pointer goes before a press on a tab becomes a drag (a click stays a click). */
const THRESHOLD = 5;

/** The repository tabs in `row`, in their order (not the start screen's, nor one closing). */
function tabsIn(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(":scope > .tab[data-path]")];
}

/** Each tab's left edge as it's drawn now, by path. */
function leftEdges(tabs: HTMLElement[]): Map<string, number> {
  return new Map(tabs.map((tab) => [tab.dataset.path!, tab.getBoundingClientRect().left]));
}

/**
 * Tabs dragged along the bar to put them in another order, as in a browser: the tab follows
 * the pointer, the others slide aside to make room, and on letting go it settles into its
 * place. Escape puts it back. A tab that moves any other way (from the keyboard) slides to
 * its new place too.
 *
 * `paths` are the tabs' paths in their order; `onMove` puts one at another place.
 */
export function useTabDrag(row: RefObject<HTMLDivElement | null>, paths: string[], onMove: (path: string, to: number) => void) {
  /** Where each tab was drawn, from the last time they were laid out or let go of. */
  const drawn = useRef<Map<string, number>>(new Map());
  const dropped = useRef<Map<string, number> | null>(null);
  const order = paths.join("\n");

  // After a move, each tab slides from where it was drawn to its new place. After a drag, the
  // others are already there (moved aside): only the one let go of slides.
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const tabs = tabsIn(element);
    const before = dropped.current ?? drawn.current;
    dropped.current = null;
    element.classList.remove("reordering");
    for (const tab of tabs) {
      tab.classList.remove("dragging");
      tab.style.transform = "";
    }
    const now = leftEdges(tabs);
    for (const tab of tabs) {
      const was = before.get(tab.dataset.path!);
      const offset = was === undefined ? 0 : was - now.get(tab.dataset.path!)!;
      if (Math.abs(offset) >= 1) animate(tab, [{ transform: `translateX(${offset}px)` }, { transform: "none" }], { duration: 180 });
    }
    drawn.current = now;
  }, [row, order]);

  // And when the bar changes width (the window resized), so a move from the keyboard slides
  // from where the tab really was.
  useLayoutEffect(() => {
    const element = row.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!element.classList.contains("reordering")) drawn.current = leftEdges(tabsIn(element));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [row]);

  /** A press on a tab: a drag once it moves sideways. */
  return (event: ReactPointerEvent<HTMLElement>) => {
    const element = row.current;
    const tab = event.currentTarget;
    if (event.button !== 0 || !element || (event.target as Element).closest(".tab-close")) return;
    const tabs = tabsIn(element);
    const from = tabs.indexOf(tab);
    if (from < 0 || tabs.length < 2) return;
    const slots: Slot[] = tabs.map((each) => each.getBoundingClientRect());
    // The room the tab takes, which the others give up as it passes them.
    const room = slots[from].right - slots[from].left + (slots[1].left - slots[0].right);
    const start = event.clientX;
    let dragging = false;
    let to = from;

    const place = (offset: number) => {
      tab.style.transform = `translateX(${offset}px)`;
      to = dropIndex(slots, from, offset);
      tabs.forEach((other, index) => {
        if (index === from) return;
        const aside = from < index && index <= to ? -room : to <= index && index < from ? room : 0;
        other.style.transform = aside ? `translateX(${aside}px)` : "";
      });
    };
    const move = (moved: PointerEvent) => {
      const offset = moved.clientX - start;
      if (!dragging) {
        if (Math.abs(offset) < THRESHOLD) return;
        dragging = true;
        element.classList.add("reordering");
        tab.classList.add("dragging");
      }
      // Along the tabs, and no further than the first and last of them.
      place(Math.min(Math.max(offset, slots[0].left - slots[from].left), slots[slots.length - 1].right - slots[from].right));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
    };
    const putBack = () => {
      // Everything slides back to where it was.
      const was = leftEdges(tabs);
      for (const each of tabs) each.style.transform = "";
      element.classList.remove("reordering");
      tab.classList.remove("dragging");
      const now = leftEdges(tabs);
      for (const each of tabs) {
        const offset = was.get(each.dataset.path!)! - now.get(each.dataset.path!)!;
        if (Math.abs(offset) >= 1) animate(each, [{ transform: `translateX(${offset}px)` }, { transform: "none" }], { duration: 180 });
      }
    };
    const up = () => {
      stop();
      if (!dragging) return;
      if (to === from) return putBack();
      dropped.current = leftEdges(tabs);
      onMove(tab.dataset.path!, to);
    };
    const cancel = () => {
      stop();
      if (dragging) putBack();
    };
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key !== "Escape" || !dragging) return;
      pressed.preventDefault();
      pressed.stopPropagation();
      cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  };
}
