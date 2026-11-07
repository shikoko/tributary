import type { CommitRow, GraphLine } from "../api";
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
  const focus = options.focusIds;
  // A line is part of the highlighted history when the commit it links from is.
  const inFocus = (child: number | number[]) =>
    Array.isArray(child) ? child.some((row) => focus!.has(commits[row]?.id)) : focus!.has(commits[child]?.id);

  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Lines first, so the nodes are drawn on top of them.
  for (let slot = first; slot < last; slot++) {
    const top = (slot - first) * rowHeight;
    const middle = top + rowHeight / 2;
    const bottom = top + rowHeight;
    const row = slots[slot];
    const lines = typeof row === "number" ? commits[row].graph.lines : passingLines(commits[row.before]);

    for (const [kind, from, to, child, dashed] of lines) {
      ctx.strokeStyle = laneColor(kind === 2 ? to : from);
      ctx.globalAlpha = focus ? (inFocus(child) ? 1 : FADED) : 1;
      // Lines from stashes and uncommitted changes are dashed: they aren't history yet.
      ctx.setLineDash(dashed ? DASH : []);
      ctx.beginPath();
      if (kind === 0) {
        ctx.moveTo(x(from), top);
        ctx.lineTo(x(from), bottom);
      } else if (kind === 1) {
        // Down from the top of the row, then across into the node.
        ctx.moveTo(x(from), top);
        if (from === to) {
          ctx.lineTo(x(to), middle);
        } else {
          ctx.arcTo(x(from), middle, x(to), middle, corner);
          ctx.lineTo(x(to), middle);
        }
      } else {
        // Across from the node, then down to the bottom of the row.
        ctx.moveTo(x(from), middle);
        if (from === to) {
          ctx.lineTo(x(to), bottom);
        } else {
          ctx.arcTo(x(to), middle, x(to), bottom, corner);
          ctx.lineTo(x(to), bottom);
        }
      }
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  for (let slot = first; slot < last; slot++) {
    const row = slots[slot];
    if (typeof row !== "number") continue;
    const commit = commits[row];
    ctx.globalAlpha = focus && !focus.has(commit.id) ? FADED : 1;
    const cx = x(commit.graph.column);
    const cy = (slot - first) * rowHeight + rowHeight / 2;
    const color = laneColor(commit.graph.column);
    const selected = commit.id === options.selectedId;
    const background = selected ? options.selectedBackground : options.background;

    if (selected || commit.id === options.headId) {
      // A ring around the checked-out or selected commit.
      ctx.beginPath();
      ctx.arc(cx, cy, NODE_RADIUS + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = background;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = selected ? "#ffffff" : color;
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
