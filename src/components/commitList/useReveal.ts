import { useEffect, useRef, useState, type RefObject } from "react";

/** How long a commit you jump to is outlined when it arrives, in milliseconds. */
const ARRIVAL = 1300;

/**
 * Bring the selected commit into view when it changes (or the rows change height), once:
 * as soon as it's on the list, which may take more commits to load. Refreshes (a fetch,
 * files changing, checks updating) recompute the rows too, but they don't move the list:
 * otherwise scrolling away from the selected commit kept snapping back to it.
 *
 * A commit you jump to (from the sidebar, a search, a link in the details…) is outlined
 * when it arrives, so your eye finds it; not one picked in the list, where you're looking
 * already (call `pickedHere` just before selecting it), nor the one selected when the list
 * opens. `arrival` is the commit outlined now, with a key that's new each time.
 */
export function useRevealSelected(scroller: RefObject<HTMLDivElement | null>, selectedId: string | null, selectedIndex: number, slotOf: number[], rowHeight: number) {
  const reveal = useRef<string | null>(selectedId);
  const fromList = useRef(true);
  const arriving = useRef<string | null>(null);
  const [arrival, setArrival] = useState<{ id: string; key: number } | null>(null);
  useEffect(() => {
    arriving.current = fromList.current ? null : selectedId;
    fromList.current = false;
  }, [selectedId]);
  useEffect(() => {
    if (!arrival) return;
    const timer = window.setTimeout(() => setArrival(null), ARRIVAL);
    return () => window.clearTimeout(timer);
  }, [arrival]);
  useEffect(() => {
    reveal.current = selectedId;
  }, [selectedId, rowHeight]);
  useEffect(() => {
    const element = scroller.current;
    if (!element || selectedIndex < 0 || reveal.current !== selectedId) return;
    reveal.current = null;
    if (selectedId && arriving.current === selectedId) {
      arriving.current = null;
      setArrival((current) => ({ id: selectedId, key: (current?.key ?? 0) + 1 }));
    }
    const top = slotOf[selectedIndex] * rowHeight;
    const bottom = top + rowHeight;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight;
    if (top >= viewTop && bottom <= viewBottom) return;
    const nearby = top >= viewTop - 2 * rowHeight && bottom <= viewBottom + 2 * rowHeight;
    if (!nearby) {
      // A jump (for example to a parent commit): centre it.
      element.scrollTop = top - element.clientHeight / 2 + rowHeight / 2;
    } else if (top < viewTop) {
      element.scrollTop = top;
    } else {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [scroller, selectedIndex, slotOf, rowHeight, selectedId]);

  const pickedHere = () => {
    fromList.current = true;
  };
  return { arrival, pickedHere };
}
