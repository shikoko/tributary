import type { CommitRow } from "../api";
import { laneColor } from "../lib/colors";

export interface GraphMetrics {
  rowHeight: number;
  laneWidth: number;
  /** Space left of the first lane. */
  padding: number;
}

export interface PaintOptions extends GraphMetrics {
  headId: string | null;
  selectedId: string | null;
  /** Colours behind the graph, used to outline nodes. */
  background: string;
  selectedBackground: string;
}

const LINE_WIDTH = 2;
const NODE_RADIUS = 6.5;
const MERGE_RADIUS = 4;

export function laneX(column: number, metrics: GraphMetrics): number {
  return metrics.padding + column * metrics.laneWidth + metrics.laneWidth / 2;
}

/**
 * Draw rows `first` to `last` (exclusive) of the graph, with row `first` at the top of
 * the canvas. Each row draws only its own segments, so any window of rows lines up
 * with its neighbours.
 */
export function paintGraph(
  ctx: CanvasRenderingContext2D,
  commits: CommitRow[],
  first: number,
  last: number,
  options: PaintOptions,
) {
  const { rowHeight } = options;
  const x = (column: number) => laneX(column, options);
  const corner = Math.min(rowHeight / 2, options.laneWidth) - 1;

  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Lines first, so the nodes are drawn on top of them.
  for (let row = first; row < last; row++) {
    const top = (row - first) * rowHeight;
    const middle = top + rowHeight / 2;
    const bottom = top + rowHeight;

    for (const [kind, from, to] of commits[row].graph.lines) {
      ctx.strokeStyle = laneColor(kind === 2 ? to : from);
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

  for (let row = first; row < last; row++) {
    const commit = commits[row];
    const cx = x(commit.graph.column);
    const cy = (row - first) * rowHeight + rowHeight / 2;
    const color = laneColor(commit.graph.column);
    const isMerge = commit.parents.length > 1;
    const background = commit.id === options.selectedId ? options.selectedBackground : options.background;

    if (commit.id === options.headId || commit.id === options.selectedId) {
      // A ring around the checked-out or selected commit.
      ctx.beginPath();
      ctx.arc(cx, cy, NODE_RADIUS + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = background;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = commit.id === options.selectedId ? "#ffffff" : color;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, isMerge ? MERGE_RADIUS : NODE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = background;
    ctx.stroke();
  }
}
