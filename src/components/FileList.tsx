import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { plural } from "../lib/format";
import { CloseIcon, SearchIcon } from "./Icons";
import { Button } from "./ui/Button";

/** Every file row is this tall (see .file). */
const ROW = 26;
/** Rows drawn beyond the visible ones, so scrolling doesn't show gaps. */
const OVERSCAN = 30;
/** Shorter lists are drawn whole. */
const DRAW_ALL_UP_TO = 300;

interface Props<T> {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
}

/**
 * A list of files of any length: a long one draws only the rows on screen (and some either
 * side) as the panel scrolls, so a commit with tens of thousands of files stays quick.
 */
export function FileList<T>({ items, keyOf, render }: Props<T>) {
  const list = useRef<HTMLUListElement>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(items.length, 100) });
  const virtual = items.length > DRAW_ALL_UP_TO;

  useLayoutEffect(() => {
    const element = list.current;
    if (!virtual || !element) return;
    const scroller = element.closest<HTMLElement>(".details-scroll") ?? document.scrollingElement;
    if (!scroller) return;
    const update = () => {
      // Where the visible part of the panel falls in the list.
      const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const from = -offset;
      const start = Math.max(0, Math.floor(from / ROW) - OVERSCAN);
      const end = Math.min(items.length, Math.ceil((from + scroller.clientHeight) / ROW) + OVERSCAN);
      setRange((current) => (current.start === start && current.end === end ? current : { start, end: Math.max(start, end) }));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [virtual, items.length]);

  if (!virtual) {
    return <ul className="file-list">{items.map((item) => <Fragment key={keyOf(item)}>{render(item)}</Fragment>)}</ul>;
  }
  const { start, end } = range;
  return (
    <ul ref={list} className="file-list">
      {start > 0 && <li className="file-spacer" aria-hidden style={{ height: start * ROW }} />}
      {items.slice(start, end).map((item) => (
        <Fragment key={keyOf(item)}>{render(item)}</Fragment>
      ))}
      {end < items.length && <li className="file-spacer" aria-hidden style={{ height: (items.length - end) * ROW }} />}
    </ul>
  );
}

interface FilterProps {
  value: string;
  onChange: (value: string) => void;
  /** How many files match, and how many there are. */
  shown: number;
  total: number;
}

/** A field to narrow a long file list down by name or folder. */
export function FileFilter({ value, onChange, shown, total }: FilterProps) {
  return (
    <div className="file-filter">
      <SearchIcon size={13} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
          }
        }}
        placeholder={`Filter ${plural(total, "file")}`}
        spellCheck={false}
        aria-label="Filter files by name or folder"
      />
      {value && (
        <>
          <span className="file-filter-count">
            {shown.toLocaleString()} of {total.toLocaleString()}
          </span>
          <Button kind="icon" size="small" onClick={() => onChange("")} aria-label="Clear the filter" title="Clear (Esc)">
            <CloseIcon size={12} />
          </Button>
        </>
      )}
    </div>
  );
}
