import { useEffect, useRef } from "react";

/** How fast a name slides, in pixels a second: slow enough to read as it goes. */
const SPEED = 40;
/** The share of each round it spends moving (the rest it rests at either end, to be read). */
const MOVING = 0.64;

/** How wide `element`'s text is, all of it, however much shows. */
function textWidth(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width;
}

/**
 * Text cut short with an ellipsis when it doesn't fit, which slides along to show the rest
 * while its row is pointed at (or has the keyboard), and back again, like a news ticker. A
 * little after the pointer arrives, so passing over a list doesn't set every row moving.
 * Text that fits stays still, and so does everything with reduced motion (the row's
 * tooltip has the whole of it).
 */
export function SlidingText({ text, className = "" }: { text: string; className?: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = outer.current;
    const inner = element?.firstElementChild as HTMLElement | null;
    // The row it's in: pointing anywhere on it shows the whole text.
    const row = element?.closest<HTMLElement>(".commit-check-row, li") ?? element?.parentElement;
    if (!element || !inner || !row) return;
    const start = () => {
      const overflow = Math.ceil(textWidth(inner) - element.clientWidth);
      if (overflow <= 1) return;
      const moving = Math.max(0.6, overflow / SPEED);
      element.style.setProperty("--slide", `${-overflow}px`);
      element.style.setProperty("--slide-time", `${((2 * moving) / MOVING).toFixed(2)}s`);
      element.classList.add("sliding");
    };
    const stop = () => element.classList.remove("sliding");
    row.addEventListener("pointerenter", start);
    row.addEventListener("pointerleave", stop);
    row.addEventListener("focusin", start);
    row.addEventListener("focusout", stop);
    return () => {
      row.removeEventListener("pointerenter", start);
      row.removeEventListener("pointerleave", stop);
      row.removeEventListener("focusin", start);
      row.removeEventListener("focusout", stop);
    };
  }, []);
  return (
    <span ref={outer} className={`sliding-text ${className}`}>
      <span className="sliding-text-inner">{text}</span>
    </span>
  );
}
