import { useLayoutEffect, type RefObject } from "react";
import type { CommitRow } from "../../api";
import { laneColor } from "../../lib/colors";
import type { CanvasColors, CurveStyle } from "../../lib/appearance";
import type { Slot } from "../../lib/days";
import { paintGraph } from "../graphPainter";
import { GRAPH_PADDING } from "./layout";

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
  colors: CanvasColors;
  curves: CurveStyle;
  laneWidth: number;
  /** Commits are authors' pictures (ListRow): the painter leaves them out. */
  avatars: boolean;
}

/** Draw the graph for the rendered rows. */
export function useGraphCanvas(canvas: RefObject<HTMLCanvasElement | null>, input: GraphInput) {
  const { commits, slots, first, last, width, rowHeight, headId, selectedId, focusIds, colors, curves, laneWidth, avatars } = input;
  useLayoutEffect(() => {
    if (!canvas.current) return;
    const ctx = prepare(canvas.current, width, Math.max(0, last - first) * rowHeight);
    if (!ctx) return;
    paintGraph(ctx, commits, slots, first, last, {
      rowHeight,
      laneWidth,
      padding: GRAPH_PADDING,
      headId,
      selectedId,
      focusIds,
      background: colors.background,
      selectedBackground: colors.selectedBackground,
      ring: colors.ring,
      lanes: colors.lanes,
      curves,
      avatars,
    });
  }, [canvas, commits, slots, first, last, width, headId, selectedId, rowHeight, focusIds, colors, curves, laneWidth, avatars]);
}

/** A mark next to the scrollbar. */
export interface ScrollMark {
  /** A branch's tip, a search match, the checked-out commit or a selected one. */
  kind: "branch" | "match" | "head" | "selected";
  /** The commit it marks. */
  index: number;
  /** How far down the strip it is, in pixels. */
  y: number;
  color: string;
}

interface MarkInput {
  commits: CommitRow[];
  /** The list row of each commit. */
  slotOf: number[];
  indexById: Map<string, number>;
  rowHeight: number;
  /** The height of everything in the list, and of the strip (the part on screen). */
  contentHeight: number;
  height: number;
  matchIds: Set<string> | null;
  headId: string | null;
  selectedIds: Set<string>;
  colors: CanvasColors;
}

/** The marks next to the scrollbar, in the order they're drawn (later ones on top). */
export function scrollMarks(input: MarkInput): ScrollMark[] {
  const { commits, slotOf, indexById, rowHeight, contentHeight, height, matchIds, headId, selectedIds, colors } = input;
  const total = Math.max(contentHeight, height);
  const marks: ScrollMark[] = [];
  const add = (kind: ScrollMark["kind"], index: number | undefined, color: string) => {
    if (index !== undefined) marks.push({ kind, index, color, y: ((slotOf[index] + 0.5) * rowHeight * height) / total });
  };
  commits.forEach((commit, index) => {
    if (commit.refs.some((ref) => ref.kind === "branch")) add("branch", index, laneColor(commit.graph.column, colors.lanes));
  });
  matchIds?.forEach((id) => add("match", indexById.get(id), colors.match));
  if (headId) add("head", indexById.get(headId), colors.accent);
  selectedIds.forEach((id) => add("selected", indexById.get(id), colors.ring));
  return marks;
}

/** How close to a mark the pointer has to be to point at it, in pixels. */
const NEAR = 4;

/** The marks the pointer is on, at `y` down the strip, nearest first. */
export function marksNear(marks: ScrollMark[], y: number): ScrollMark[] {
  return marks.filter((mark) => Math.abs(mark.y - y) <= NEAR).sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y));
}

/** How thick each kind of mark is, and how far in from the strip's edges. */
const MARK_SIZE: Record<ScrollMark["kind"], { size: number; inset: number }> = {
  branch: { size: 2, inset: 3 },
  match: { size: 2, inset: 1 },
  head: { size: 3, inset: 0 },
  selected: { size: 2, inset: 0 },
};

/**
 * Draws the marks next to the scrollbar: branch tips, search matches, the checked-out commit
 * and the selection. The ones for the commits in `lit` (the pointer is on them) stand out as
 * a selected commit's dot does in the graph: a little bigger, with a ring right around them.
 */
export function useScrollMarkers(
  canvas: RefObject<HTMLCanvasElement | null>,
  marks: ScrollMark[],
  viewport: { height: number; scrollbar: number },
  lit: ReadonlySet<number>,
  ring: string,
) {
  useLayoutEffect(() => {
    // Under the scrollbar; with scrollbars that overlay the content, a thin strip at the edge.
    const width = viewport.scrollbar || 6;
    const { height } = viewport;
    if (!canvas.current || !height) return;
    const ctx = prepare(canvas.current, width, height);
    if (!ctx) return;
    // The insets are for the 12px strip beside a scrollbar: a narrower one takes less off.
    const narrow = Math.min(1, width / 12);
    for (const mark of marks) {
      const { size } = MARK_SIZE[mark.kind];
      const inset = MARK_SIZE[mark.kind].inset * narrow;
      ctx.fillStyle = mark.color;
      ctx.fillRect(inset, Math.round(mark.y - size / 2), width - inset * 2, size);
    }
    // On top: the lit commits, each as one mark 2px taller and the full width, on a ring 2px
    // wider still. Its colour is the branch's if it has one (as the card's stripe is), so a
    // selected commit's mark (drawn in the ring's colour) doesn't vanish into its ring.
    const rank: ScrollMark["kind"][] = ["branch", "head", "selected", "match"];
    for (const index of lit) {
      const own = marks.filter((mark) => mark.index === index);
      if (own.length === 0) continue;
      const top = rank.map((kind) => own.find((mark) => mark.kind === kind)).find(Boolean)!;
      const size = Math.max(...own.map((mark) => MARK_SIZE[mark.kind].size)) + 2;
      ctx.fillStyle = ring;
      ctx.fillRect(0, Math.round(top.y - size / 2 - 2), width, size + 4);
      ctx.fillStyle = top.color;
      ctx.fillRect(1.5, Math.round(top.y - size / 2), width - 3, size);
    }
  }, [canvas, viewport, marks, lit, ring]);
}
