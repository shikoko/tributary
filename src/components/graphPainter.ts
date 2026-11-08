import type { CommitRow, GraphLine } from "../api";
import type { CurveStyle } from "../lib/appearance";
import { laneColor } from "../lib/colors";
import type { Slot } from "../lib/days";

export interface GraphMetrics {
  rowHeight: number;
  laneWidth: number;
  /** Space left of the first lane. */
  padding: number;
}

export interface PaintOptions extends GraphMetrics {
  headId: string | null;
  selectedId: string | null;
  /** While a branch is highlighted: the commits in its history. Everything else fades. */
  focusIds: Set<string> | null;
  /** Colours behind the graph, used to outline nodes. */
  background: string;
  selectedBackground: string;
  /** The ring around the selected commit. */
  ring: string;
  /** The lane colours. */
  lanes: string[];
  /**
   * How lines turn from one lane to another: "round" with a quarter circle; "smooth" with a
   * corner whose curvature eases in and out (like Apple's rounded corners); "tight" with a
   * small radius, like a metro map; "sweep" in one long curve across the whole distance.
   */
  curves?: CurveStyle;
}


type Point = [number, number];

/**
 * From `start` along a straight line to the corner `at`, turning there, and along a straight
 * line to `end`, in `style`. `radius` is the corner's size for round corners.
 */
function turn(path: Path2D, start: Point, at: Point, end: Point, radius: number, style: Exclude<CurveStyle, "mixed">) {
  const toward = (from: Point, to: Point, distance: number): Point => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    return [to[0] + ((from[0] - to[0]) / length) * distance, to[1] + ((from[1] - to[1]) / length) * distance];
  };
  const first = Math.hypot(start[0] - at[0], start[1] - at[1]);
  const second = Math.hypot(end[0] - at[0], end[1] - at[1]);
  path.moveTo(...start);
  if (style === "round" || style === "tight") {
    path.arcTo(at[0], at[1], end[0], end[1], style === "tight" ? Math.min(radius, 7) : radius);
    path.lineTo(...end);
    return;
  }
  // A cubic corner: from a point on each leg, with handles pulled towards the corner.
  // Pulled 55% of the way it's close to a circle; further, the curve starts gently and
  // turns harder in the middle, as Apple's corners do.
  const [legs, pull] = style === "sweep" ? [[first, second], 0.5523] : [[Math.min(first, radius + 1), Math.min(second, radius + 1)], 0.8];
  const from = toward(start, at, legs[0]);
  const to = toward(end, at, legs[1]);
  path.lineTo(...from);
  path.bezierCurveTo(
    from[0] + (at[0] - from[0]) * pull,
    from[1] + (at[1] - from[1]) * pull,
    to[0] + (at[0] - to[0]) * pull,
    to[1] + (at[1] - to[1]) * pull,
    to[0],
    to[1],
  );
  path.lineTo(...end);
}

const LINE_WIDTH = 2;
const NODE_RADIUS = 6.5;
const MERGE_RADIUS = 4;
const DASH = [4, 4];
/** How visible lines and dots outside a highlighted branch's history are. */
const FADED = 0.14;

export function laneX(column: number, metrics: GraphMetrics): number {
  return metrics.padding + column * metrics.laneWidth + metrics.laneWidth / 2;
}

/** The lanes that pass through a divider placed just above commit row `before`. */
function passingLines(commit: CommitRow): GraphLine[] {
  return commit.graph.lines
    .filter(([kind]) => kind !== 2)
    .map(([, from, , child, dashed]) => (dashed ? [0, from, from, child, 1] : [0, from, from, child]));
}

/**
 * Draw list rows `first` to `last` (exclusive) of the graph, with row `first` at the top
 * of the canvas. A row is a commit (its index in `commits`) or a divider, which the lanes
 * pass straight through. Each row draws only its own segments, so any window of rows
 * lines up with its neighbours.
 */
export function paintGraph(
  ctx: CanvasRenderingContext2D,
  commits: CommitRow[],
  slots: Slot[],
  first: number,
  last: number,
  options: PaintOptions,
) {
  const { rowHeight } = options;
  const x = (column: number) => laneX(column, options);
  const corner = Math.min(rowHeight / 2, options.laneWidth) - 1;
  const curves = options.curves ?? "mixed";
  /** "mixed": smooth into the next lane, round for longer jumps. */
  const bend = (from: number, to: number) => (curves === "mixed" ? (Math.abs(to - from) === 1 ? "smooth" : "round") : curves);
  const focus = options.focusIds;
  // A line is part of the highlighted history when the commit it links from is.
  const inFocus = (child: number | number[]) =>
    Array.isArray(child) ? child.some((row) => focus!.has(commits[row]?.id)) : focus!.has(commits[child]?.id);

  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Lines first, so the nodes are drawn on top of them.
  // Lines that look the same are gathered into one path and stroked once. Stroking each
  // row's piece separately paints the soft edge pixels twice where the rounded ends of
  // neighbouring rows overlap, which shows as a small bump at every row boundary.
  const batches = new Map<string, { color: string; alpha: number; dashed: boolean; path: Path2D }>();
  for (let slot = first; slot < last; slot++) {
    const top = (slot - first) * rowHeight;
    const middle = top + rowHeight / 2;
    const bottom = top + rowHeight;
    const row = slots[slot];
    const lines = typeof row === "number" ? commits[row].graph.lines : passingLines(commits[row.before]);

    for (const [kind, from, to, child, dashed] of lines) {
      const color = laneColor(kind === 2 ? to : from, options.lanes);
      const alpha = focus ? (inFocus(child) ? 1 : FADED) : 1;
      const key = `${color} ${alpha} ${dashed ? 1 : 0}`;
      let batch = batches.get(key);
      if (!batch) batches.set(key, (batch = { color, alpha, dashed: !!dashed, path: new Path2D() }));
      const path = batch.path;
      if (kind === 0) {
        path.moveTo(x(from), top);
        path.lineTo(x(from), bottom);
      } else if (kind === 1) {
        // Down from the top of the row, then across into the node.
        if (from === to) {
          path.moveTo(x(from), top);
          path.lineTo(x(to), middle);
        } else {
          turn(path, [x(from), top], [x(from), middle], [x(to), middle], corner, bend(from, to));
        }
      } else {
        // Across from the node, then down to the bottom of the row.
        if (from === to) {
          path.moveTo(x(from), middle);
          path.lineTo(x(to), bottom);
        } else {
          turn(path, [x(from), middle], [x(to), middle], [x(to), bottom], corner, bend(from, to));
        }
      }
    }
  }
  for (const { color, alpha, dashed, path } of batches.values()) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    // Lines from stashes and uncommitted changes are dashed: they aren't history yet.
    ctx.setLineDash(dashed ? DASH : []);
    ctx.stroke(path);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  for (let slot = first; slot < last; slot++) {
    const row = slots[slot];
    if (typeof row !== "number") continue;
    const commit = commits[row];
    ctx.globalAlpha = focus && !focus.has(commit.id) ? FADED : 1;
    const cx = x(commit.graph.column);
    const cy = (slot - first) * rowHeight + rowHeight / 2;
    const color = laneColor(commit.graph.column, options.lanes);
    const selected = commit.id === options.selectedId;
    const background = selected ? options.selectedBackground : options.background;

    if (selected || commit.id === options.headId) {
      // A ring around the checked-out or selected commit.
      ctx.beginPath();
      ctx.arc(cx, cy, NODE_RADIUS + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = background;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = selected ? options.ring : color;
      ctx.stroke();
    }

    ctx.lineWidth = 2;
    if (commit.kind === "worktree") {
      // Uncommitted changes: a hollow, dashed circle.
      ctx.beginPath();
      ctx.arc(cx, cy, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = background;
      ctx.fill();
      ctx.setLineDash([3, 2.5]);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (commit.kind === "stash") {
      // A stash: a small square box.
      roundedSquare(ctx, cx, cy, NODE_RADIUS - 0.5, 3);
      ctx.fillStyle = background;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, commit.parents.length > 1 ? MERGE_RADIUS : NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = background;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** A square path centred on (cx, cy), `half` wide on each side, with rounded corners. */
function roundedSquare(ctx: CanvasRenderingContext2D, cx: number, cy: number, half: number, radius: number) {
  const [left, right, top, bottom] = [cx - half, cx + half, cy - half, cy + half];
  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.arcTo(right, top, right, bottom, radius);
  ctx.arcTo(right, bottom, left, bottom, radius);
  ctx.arcTo(left, bottom, left, top, radius);
  ctx.arcTo(left, top, right, top, radius);
  ctx.closePath();
}
