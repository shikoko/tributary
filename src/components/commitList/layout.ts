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
/** The share of a wide list that many lanes can take, when that's more than MAX_GRAPH_WIDTH. */
const MAX_GRAPH_SHARE = 0.4;
/** How wide the graph column can be dragged. */
export const MAX_DRAGGED_GRAPH_WIDTH = 800;
/** Rows rendered above and below the visible area, so fast scrolling doesn't flash. */
const OVERSCAN = 12;
export const FOOTER_HEIGHT = 56;
/** Below this width the SHA column and author names are hidden. */
const NARROW_WIDTH = 760;

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
 * of the rows on screen (not every lane in the history) need, unless a width was chosen
 * by dragging (see fitColumns for what gives way in a narrow list).
 */
/** How wide the columns are, given the room and the lanes to show. */
export interface ColumnSizes {
  refsWidth: number;
  graphWidth: number;
  authorWidth: number;
  dateWidth: number;
  shaWidth: number;
}

/** The commit message gives way to the graph's lanes down to this width. */
const SQUEEZED_MESSAGE_WIDTH = 120;
/** The branch and tag column gives a little to the lanes, down to this width, before more goes. */
const READABLE_REFS_WIDTH = 110;

/**
 * The columns' widths in a list `width` wide. The graph is as wide as `lanes` need. A width
 * chosen by dragging is the least it gets: it still widens when the lanes need more. When
 * that doesn't fit, the commit message gives way first (down to 120 px), then a little of
 * the branch and tag column (when its width wasn't chosen), then, in a narrow list, the
 * dates (the labels getting their room back), then the rest of the branch and tag column:
 * the lanes are cut off only when even that isn't enough.
 */
export function fitColumns(input: {
  width: number;
  narrow: boolean;
  lanes: number;
  laneWidth: number;
  columnWidths: ColumnWidths;
  show: ColumnOptions;
  authorsOnGraph: boolean;
}): ColumnSizes {
  const { width, narrow, lanes, laneWidth, columnWidths, show, authorsOnGraph } = input;
  let refsWidth = columnWidths.refs ?? (narrow ? NARROW_REFS_WIDTH : REFS_WIDTH);
  const authorWidth = show.author ? (narrow ? (authorsOnGraph ? 0 : 44) : 180) : 0;
  let dateWidth = show.date ? (show.dateFormat === "exact" ? (narrow ? 132 : 164) : 116) : 0;
  const shaWidth = show.sha && !narrow ? 80 : 0;
  const sizes = () => ({ refsWidth, authorWidth, dateWidth, shaWidth });
  const needed = GRAPH_PADDING * 2 + lanes * laneWidth;
  const chosen = columnWidths.graph;
  // Wide enough already: nothing else gives way.
  if (chosen !== null && chosen >= needed) return { ...sizes(), graphWidth: chosen };
  // Many lanes can take up to 40% of a wide list (at least 320 px), leaving the rest to the messages.
  const most = chosen !== null ? MAX_DRAGGED_GRAPH_WIDTH : Math.max(MAX_GRAPH_WIDTH, Math.round(width * MAX_GRAPH_SHARE));
  const wanted = Math.min(most, Math.max(MIN_GRAPH_WIDTH, needed));
  // The room the graph has when the message keeps `message` px.
  const room = (message: number) => width - refsWidth - authorWidth - dateWidth - shaWidth - message;
  const short = () => wanted - room(SQUEEZED_MESSAGE_WIDTH);
  if (width > 0 && short() > 0) {
    const autoRefs = columnWidths.refs === null;
    // The labels can give a little and stay readable.
    const given = autoRefs ? Math.min(short(), Math.max(0, refsWidth - READABLE_REFS_WIDTH)) : 0;
    refsWidth -= given;
    if (short() > 0 && narrow && dateWidth > 0) {
      // Not enough: the dates make way instead, and the labels get back what they can.
      dateWidth = 0;
      refsWidth += Math.min(given, Math.max(0, -short()));
    }
    // Still not enough: the labels shrink further, as far as they go.
    if (short() > 0 && autoRefs) refsWidth = Math.max(MIN_REFS_WIDTH, refsWidth - short());
  }
  // As wide as the lanes need, as far as the message can give way (it takes the rest).
  const graphWidth = width > 0 ? Math.max(chosen ?? MIN_GRAPH_WIDTH, MIN_GRAPH_WIDTH, Math.min(wanted, room(SQUEEZED_MESSAGE_WIDTH))) : wanted;
  return { ...sizes(), graphWidth };
}

export function useColumnLayout({ commits, slots, rowHeight, scrollTop, viewport, settledWidth, columnWidths, show, laneWidth, authorsOnGraph }: LayoutInput) {
  const narrow = settledWidth > 0 && settledWidth < NARROW_WIDTH;
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

  const { refsWidth, graphWidth, authorWidth, dateWidth, shaWidth } = fitColumns({
    width: viewport.width,
    narrow,
    lanes,
    laneWidth,
    columnWidths,
    show,
    authorsOnGraph,
  });
  // Widening for new lanes happens at once (easing it would let them run over the messages
  // for a moment). Widening because there's more room eases like the other columns.
  const shown = useRef({ width: graphWidth, lanes });
  const graphGrowing = graphWidth > shown.current.width && lanes > shown.current.lanes;
  useEffect(() => {
    shown.current = { width: graphWidth, lanes };
  }, [graphWidth, lanes]);

  // Every column is always there (0 px wide when it's hidden), and each cell has its own
  // (see .commit-row in commit-list.css): every layout has as many columns, so switching
  // between them eases instead of jumping, and the graph's lines, nodes and the lines
  // from the labels, which sit in the same columns, move as one.
  const columns = [`${refsWidth}px`, `${graphWidth}px`, "minmax(0, 1fr)", `${authorWidth}px`, `${dateWidth}px`, `${shaWidth}px`].join(" ");
  // The same object while nothing changes, so rows needn't re-render.
  const [showAuthor, showDate, showSha] = [authorWidth > 0, dateWidth > 0, shaWidth > 0];
  const visible: VisibleColumns = useMemo(() => ({ author: showAuthor, date: showDate, sha: showSha }), [showAuthor, showDate, showSha]);
  return { narrow, refsWidth, graphWidth, graphGrowing, columns, visible, first, last };
}
