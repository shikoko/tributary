import { useEffect, useMemo, useRef, useState } from "react";
import type { CommitRow } from "../../api";
import type { Slot } from "../../lib/days";

export const ROW_HEIGHT = 36;
export const DENSE_ROW_HEIGHT = 24;
export const LANE_WIDTH = 20;
/** Lanes are further apart with authors' pictures on the commits, so the pictures don't touch. */
export function laneWidthFor(avatars: boolean, dense: boolean): number {
  return avatars ? (dense ? 22 : 28) : LANE_WIDTH;
}
/** How big an author's picture is on the graph, without its ring. */
export function nodeAvatarSize(dense: boolean): number {
  return dense ? 15 : 21;
}
export const GRAPH_PADDING = 10;
/** Default width of the branch and tag column, left of the graph. */
const REFS_WIDTH = 180;
const NARROW_REFS_WIDTH = 140;
export const MIN_REFS_WIDTH = 80;
export const MAX_REFS_WIDTH = 400;
/** Space between a label and the right edge of the branch and tag column. */
export const REFS_PADDING = 8;
export const MIN_GRAPH_WIDTH = 72;
const MAX_GRAPH_WIDTH = 320;
/** How wide the graph column can be dragged. */
export const MAX_DRAGGED_GRAPH_WIDTH = 800;
/** Rows rendered above and below the visible area, so fast scrolling doesn't flash. */
const OVERSCAN = 12;
export const FOOTER_HEIGHT = 56;
/** Below this width the SHA column and author names are hidden. */
const NARROW_WIDTH = 760;
/** The graph gets narrower before the commit message column goes below this width. */
const MIN_MESSAGE_WIDTH = 200;

/** Column widths chosen by dragging; null means automatic. */
export interface ColumnWidths {
  refs: number | null;
  graph: number | null;
}

/** Which columns to show, and how to show dates. */
export interface ColumnOptions {
  author: boolean;
  date: boolean;
  sha: boolean;
  /** "3 hours ago", or the date and time. */
  dateFormat: "relative" | "exact";
  /** The date the commit was first written, or the date it was last committed (rebased, amended, …). */
  dateKind: "authored" | "committed";
}

export const DEFAULT_COLUMNS: ColumnOptions = {
  author: true,
  date: true,
  sha: true,
  dateFormat: "relative",
  dateKind: "authored",
};

/** The optional columns that fit. */
export interface VisibleColumns {
  author: boolean;
  date: boolean;
  sha: boolean;
}

export const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)));

interface LayoutInput {
  commits: CommitRow[];
  slots: Slot[];
  rowHeight: number;
  scrollTop: number;
  viewport: { width: number; height: number };
  /**
   * The width the list last stayed at. The compact layout for narrow lists goes by it, so
   * a side panel sliding open or closed doesn't flip the layout halfway through.
   */
  settledWidth: number;
  columnWidths: ColumnWidths;
  show: ColumnOptions;
  /** How far apart the lanes are (wider with authors' pictures on the commits). */
  laneWidth: number;
  /** Authors' pictures are on the graph: a narrow list needs no column of them too. */
  authorsOnGraph: boolean;
}

/**
 * The list's columns and which rows to render. The graph column is as wide as the lanes
 * of the rows on screen (not every lane in the history) need, leaving room for the commit
 * message in narrow windows, unless a width was chosen by dragging.
 */
export function useColumnLayout({ commits, slots, rowHeight, scrollTop, viewport, settledWidth, columnWidths, show, laneWidth, authorsOnGraph }: LayoutInput) {
  const narrow = settledWidth > 0 && settledWidth < NARROW_WIDTH;
  const refsWidth = columnWidths.refs ?? (narrow ? NARROW_REFS_WIDTH : REFS_WIDTH);
  const authorWidth = show.author ? (narrow ? (authorsOnGraph ? 0 : 44) : 180) : 0;
  const dateWidth = show.date ? (show.dateFormat === "exact" ? (narrow ? 132 : 164) : 116) : 0;
  const shaWidth = show.sha && !narrow ? 80 : 0;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(slots.length, Math.ceil((scrollTop + viewport.height) / rowHeight) + OVERSCAN);

  // The lanes the rows on screen use. A lane's line can pass through a row without a commit
  // on it, so the lines count too. (Rows rendered off screen don't count: a lane coming into
  // view widens the graph in the same frame.)
  const firstOnScreen = Math.floor(scrollTop / rowHeight);
  const lastOnScreen = Math.min(slots.length, Math.ceil((scrollTop + viewport.height) / rowHeight));
  const lanesInView = useMemo(() => {
    let lanes = 1;
    for (let slot = firstOnScreen; slot < lastOnScreen; slot++) {
      const row = slots[slot];
      const commit = commits[typeof row === "number" ? row : row.before];
      if (!commit) continue;
      lanes = Math.max(lanes, commit.graph.column + 1);
      for (const [, from, to] of commit.graph.lines) lanes = Math.max(lanes, from + 1, to + 1);
    }
    return lanes;
  }, [commits, slots, firstOnScreen, lastOnScreen]);
  // The graph widens at once, so no lane is ever cut off, and narrows again once scrolling
  // has settled, so the message column doesn't jump about while you scroll.
  const [settledLanes, setSettledLanes] = useState(lanesInView);
  useEffect(() => {
    if (lanesInView === settledLanes) return;
    const timer = setTimeout(() => setSettledLanes(lanesInView), lanesInView > settledLanes ? 0 : 700);
    return () => clearTimeout(timer);
  }, [lanesInView, settledLanes]);
  const lanes = Math.max(lanesInView, settledLanes);

  const graphWidth =
    columnWidths.graph ??
    Math.min(
      MAX_GRAPH_WIDTH,
      Math.max(MIN_GRAPH_WIDTH, GRAPH_PADDING * 2 + lanes * laneWidth),
      Math.max(MIN_GRAPH_WIDTH, viewport.width - refsWidth - authorWidth - dateWidth - shaWidth - MIN_MESSAGE_WIDTH),
    );
  // Widening for new lanes happens at once (easing it would let them run over the messages
  // for a moment). Widening because there's more room eases like the other columns.
  const shown = useRef({ width: graphWidth, lanes });
  const graphGrowing = graphWidth > shown.current.width && lanes > shown.current.lanes;
  useEffect(() => {
    shown.current = { width: graphWidth, lanes };
  }, [graphWidth, lanes]);

  // The SHA column comes and goes with the compact layout, so it stays as an empty last
  // column when it's hidden: both layouts then have as many columns, and ease into each
  // other. (Only the last column can do that: the cells fill the columns in order.)
  const columns = [`${refsWidth}px`, `${graphWidth}px`, "minmax(0, 1fr)", authorWidth, dateWidth]
    .filter((width) => width !== 0)
    .map((width) => (typeof width === "number" ? `${width}px` : width))
    .concat(`${shaWidth}px`)
    .join(" ");
  // The same object while nothing changes, so rows needn't re-render.
  const [showAuthor, showDate, showSha] = [authorWidth > 0, dateWidth > 0, shaWidth > 0];
  const visible: VisibleColumns = useMemo(() => ({ author: showAuthor, date: showDate, sha: showSha }), [showAuthor, showDate, showSha]);
  return { narrow, refsWidth, graphWidth, graphGrowing, columns, visible, first, last };
}
