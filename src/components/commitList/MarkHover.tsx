import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { CommitRow } from "../../api";
import { useThemeColors } from "../../app/useAppearance";
import { laneColor } from "../../lib/colors";
import { compactTime, plural } from "../../lib/format";
import { Avatar } from "../Avatar";
import { markRect, type ScrollMark } from "./canvases";

/** How long the pointer rests on a mark before the card shows, in milliseconds. */
const DELAY = 80;
/** At most this many commits in the card. */
const MOST = 3;

interface Props {
  /** The marks the pointer is on, nearest first (marksNear). */
  near: ScrollMark[];
  /** Where the strip is on screen. */
  strip: { top: number; right: number; bottom: number; width: number };
  commits: CommitRow[];
  /** The checked-out branch, if any. */
  headBranch: string | null;
}

/** A commit with marks under the pointer: what they say, in the colour they're drawn in. */
interface Entry {
  commit: CommitRow;
  color: string;
  /** Where its mark is down the strip. */
  y: number;
  /** Where its marks are drawn, together, on the strip. */
  rect: { x: number; y: number; width: number; height: number };
  /** Its branches, or what the mark is when it has none. */
  names: string[];
  /** "Checked out · Selected": what else its marks say. */
  states: string;
}

/**
 * The marks beside the scrollbar that the pointer is on: they glow (in their own place and
 * shape, over the scrollbar), and a card says what they are: for each commit, its branches
 * (in the mark's colour, with a stripe of it down the side), whether it's checked out,
 * selected or a search match, its message and its author.
 */
export function MarkHover({ near, strip, commits, headBranch }: Props) {
  const colors = useThemeColors();
  const card = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [top, setTop] = useState(0);

  const at = near[0]?.y ?? 0;
  const indexes = [...new Set(near.map((mark) => mark.index))];
  const entries: Entry[] = indexes.map((index) => {
    const commit = commits[index];
    const own = near.filter((mark) => mark.index === index);
    const kinds = new Set(own.map((mark) => mark.kind));
    // The mark it's shown by: its branch's, if it has one.
    const shownBy = (["branch", "head", "selected", "match"] as const).map((kind) => own.find((mark) => mark.kind === kind)).find(Boolean)!;
    const branches = commit.refs.filter((ref) => ref.kind === "branch").map((ref) => ref.name);
    const names =
      branches.length > 0 ? branches : kinds.has("head") ? [headBranch ?? "Checked out"] : kinds.has("selected") ? ["Selected"] : ["Matches the search"];
    const color = kinds.has("branch")
      ? laneColor(commit.graph.column, colors.lanes)
      : kinds.has("head")
        ? colors.accent
        : kinds.has("selected")
          ? colors.ring
          : colors.match;
    const states = [
      kinds.has("head") && branches.length > 0 && "Checked out",
      kinds.has("selected") && branches.length > 0 && "Selected",
      kinds.has("match") && branches.length > 0 && "Matches the search",
    ]
      .filter(Boolean)
      .join(" · ");
    // Its marks, drawn on top of each other: the rectangle they make, to light up.
    const rects = own.map((mark) => markRect(mark, strip.width));
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const rect = {
      x: left,
      y: top,
      width: Math.max(...rects.map((each) => each.x + each.width)) - left,
      height: Math.max(...rects.map((each) => each.y + each.height)) - top,
    };
    return { commit, color, y: shownBy.y, rect, names, states };
  });
  const key = indexes.join(",");

  // It shows a moment after the pointer reaches a mark, and again for another one.
  useEffect(() => {
    setShown(false);
    if (!key) return;
    const timer = window.setTimeout(() => setShown(true), DELAY);
    return () => window.clearTimeout(timer);
  }, [key]);

  // Level with the mark, kept inside the list.
  useLayoutEffect(() => {
    const height = card.current?.offsetHeight ?? 0;
    setTop(Math.min(Math.max(strip.top + at - height / 2, strip.top + 4), strip.bottom - height - 4));
  }, [at, key, strip.top, strip.bottom]);

  if (entries.length === 0) return null;
  const more = entries.length - MOST;
  const style = { top, right: window.innerWidth - (strip.right - strip.width) + 10, "--point": `${strip.top + at - top}px` } as CSSProperties;
  return (
    <>
      {/* The marks the pointer is on light up, over the scrollbar. */}
      {entries.map((entry) => (
        <div
          key={`glow-${entry.commit.id}`}
          className="mark-glow"
          style={
            {
              "--mark": entry.color,
              top: strip.top + entry.rect.y,
              left: strip.right - strip.width + entry.rect.x,
              width: entry.rect.width,
              height: entry.rect.height,
            } as CSSProperties
          }
        />
      ))}
      <div ref={card} className={`mark-card${shown ? " shown" : ""}`} style={style} role="tooltip">
        {entries.slice(0, MOST).map((entry) => (
          <div key={entry.commit.id} className="mark-entry" style={{ "--mark": entry.color } as CSSProperties}>
            <div className="mark-entry-head">
              <span className="mark-entry-name">{entry.names.join(", ")}</span>
              <span className="mark-entry-age">{compactTime(entry.commit.time)}</span>
            </div>
            {entry.states && <div className="mark-entry-states">{entry.states}</div>}
            <div className="mark-entry-summary">{entry.commit.summary}</div>
            <div className="mark-entry-author">
              <Avatar name={entry.commit.authorName} email={entry.commit.authorEmail} size={16} />
              {entry.commit.authorName}
            </div>
          </div>
        ))}
        {more > 0 && <div className="mark-entry-more">and {plural(more, "more commit")} here</div>}
      </div>
    </>
  );
}
