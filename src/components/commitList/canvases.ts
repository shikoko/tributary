import { useLayoutEffect, type RefObject } from "react";
import type { CommitRow } from "../../api";
import { laneColor } from "../../lib/colors";
import type { Slot } from "../../lib/days";
import { paintGraph } from "../graphPainter";
import { GRAPH_PADDING, LANE_WIDTH } from "./layout";

// Keep in sync with --bg, --bg-selected and --accent in styles.css.
const BACKGROUND = "#14161b";
const SELECTED_BACKGROUND = "#252b38";
const ACCENT = "#1fb5ff";
const MATCH_COLOR = "#ffd23f";

/** Size a canvas for the screen's pixel density, and get it ready to draw in CSS pixels. */
function prepare(element: HTMLCanvasElement, width: number, height: number) {
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.ceil(width * ratio);
  const pixelHeight = Math.ceil(height * ratio);
  if (element.width !== pixelWidth) element.width = pixelWidth;
  if (element.height !== pixelHeight) element.height = pixelHeight;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  const ctx = element.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

interface GraphInput {
  commits: CommitRow[];
  slots: Slot[];
  /** The rendered rows, from `first` up to `last`. */
  first: number;
  last: number;
  width: number;
  rowHeight: number;
  headId: string | null;
  selectedId: string | null;
  focusIds: Set<string> | null;
}

/** Draw the graph for the rendered rows. */
export function useGraphCanvas(canvas: RefObject<HTMLCanvasElement | null>, input: GraphInput) {
  const { commits, slots, first, last, width, rowHeight, headId, selectedId, focusIds } = input;
  useLayoutEffect(() => {
    if (!canvas.current) return;
    const ctx = prepare(canvas.current, width, Math.max(0, last - first) * rowHeight);
    if (!ctx) return;
    paintGraph(ctx, commits, slots, first, last, {
      rowHeight,
      laneWidth: LANE_WIDTH,
      padding: GRAPH_PADDING,
      headId,
      selectedId,
      focusIds,
      background: BACKGROUND,
      selectedBackground: SELECTED_BACKGROUND,
    });
  }, [canvas, commits, slots, first, last, width, headId, selectedId, rowHeight, focusIds]);
}

interface MarkerInput {
  commits: CommitRow[];
  /** The list row of each commit. */
  slotOf: number[];
  indexById: Map<string, number>;
  rowHeight: number;
  /** The height of everything in the list, and of the part on screen. */
  contentHeight: number;
  viewport: { height: number; scrollbar: number };
  matchIds: Set<string> | null;
  headId: string | null;
  selectedIds: Set<string>;
}

/** Marks next to the scrollbar: branch tips, search matches, the checked-out commit and the selection. */
export function useScrollMarkers(canvas: RefObject<HTMLCanvasElement | null>, input: MarkerInput) {
  const { commits, slotOf, indexById, rowHeight, contentHeight, viewport, matchIds, headId, selectedIds } = input;
  useLayoutEffect(() => {
    // Under the scrollbar; with scrollbars that overlay the content, a thin strip at the edge.
    const width = viewport.scrollbar || 6;
    const { height } = viewport;
    if (!canvas.current || !height) return;
    const ctx = prepare(canvas.current, width, height);
    if (!ctx) return;
    const total = Math.max(contentHeight, height);
    const mark = (index: number | undefined, color: string, size: number, inset = 2) => {
      if (index === undefined) return;
      const y = ((slotOf[index] + 0.5) * rowHeight * height) / total;
      ctx.fillStyle = color;
      ctx.fillRect(inset, Math.round(y - size / 2), width - inset * 2, size);
    };
    commits.forEach((commit, index) => {
      if (commit.refs.some((ref) => ref.kind === "branch")) mark(index, laneColor(commit.graph.column), 2, 3);
    });
    matchIds?.forEach((id) => mark(indexById.get(id), MATCH_COLOR, 2, 1));
    if (headId) mark(indexById.get(headId), ACCENT, 3, 0);
    selectedIds.forEach((id) => mark(indexById.get(id), "#ffffff", 2, 0));
  }, [canvas, viewport, commits, slotOf, rowHeight, contentHeight, matchIds, headId, selectedIds, indexById]);
}
