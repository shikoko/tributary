import type { CommitRow, GraphLine } from "../api";
import { luminance, parseHex, type CurveStyle } from "../lib/appearance";
import { laneColor } from "../lib/colors";
import type { Slot } from "../lib/days";
import type { Lane } from "../lib/lanes";

export interface GraphMetrics {
  rowHeight: number;
  laneWidth: number;
  /** Space left of the first lane. */
  padding: number;
}

export interface PaintOptions extends GraphMetrics {
  headId: string | null;
  selectedId: string | null;
  /** While searching or a branch is highlighted: the commits that stay bright. Everything else fades. */
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
  /** Commits (not merges) are shown as their authors' pictures over the graph: leave room. */
  avatars?: boolean;
  /** How wide the authors' pictures are, without their rings. */
  pictureSize?: number;
  /** A branch's lanes, lit up: the pointer is on one of its labels. */
  litLanes?: Lane[];
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
  /** A row's piece of a line, in the row from `top`: as `paintGraph` draws them. */
  const segment = (path: Path2D, kind: number, from: number, to: number, top: number) => {
    const middle = top + rowHeight / 2;
    const bottom = top + rowHeight;
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
  };
  const lit = options.litLanes ?? [];
  /** Part of lit lane `lane`: from its own commits in its own column, and all from its oldest
      commit (down to where it was branched from). */
  const inLane = (lane: Lane, kind: number, from: number, to: number, child: number | number[]) => {
    const ids = (Array.isArray(child) ? child : [child]).map((index) => commits[index]?.id);
    if (ids.includes(lane.last)) return true;
    const own = ids.some((id) => id !== undefined && lane.ids.has(id));
    return own && (kind === 0 ? from === lane.column : from === lane.column && to === lane.column);
  };
  const inAnyLane = (kind: number, from: number, to: number, child: number | number[]) => lit.some((lane) => inLane(lane, kind, from, to, child));
  const litCommit = (id: string) => lit.some((lane) => lane.ids.has(id));
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
    const row = slots[slot];
    // Never outside the list, but a row that isn't there mustn't stop the whole window.
    if (row === undefined) continue;
    const commit = typeof row === "number" ? commits[row] : commits[row.before];
    if (!commit) continue;
    const lines = typeof row === "number" ? commit.graph.lines : passingLines(commit);

    for (const [kind, from, to, child, dashed] of lines) {
      const color = laneColor(kind === 2 ? to : from, options.lanes);
      // Outside the highlighted history, or the lit lanes: faded.
      const alpha = (focus && !inFocus(child)) || (lit.length > 0 && !inAnyLane(kind, from, to, child)) ? FADED : 1;
      const key = `${color} ${alpha} ${dashed ? 1 : 0}`;
      let batch = batches.get(key);
      if (!batch) batches.set(key, (batch = { color, alpha, dashed: !!dashed, path: new Path2D() }));
      segment(batch.path, kind, from, to, top);
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
  // The lit lanes' lines, glowing, before the nodes: where one reaches a commit of another
  // branch (where it was branched from, or merged into), it goes under that commit's node,
  // as every line does.
  for (const lane of lit) paintLaneLines(lane);

  for (let slot = first; slot < last; slot++) {
    const row = slots[slot];
    if (typeof row !== "number") continue;
    const commit = commits[row];
    if (!commit) continue;
    const faded = (focus !== null && !focus.has(commit.id)) || (lit.length > 0 && !litCommit(commit.id));
    const cx = x(commit.graph.column);
    const cy = (slot - first) * rowHeight + rowHeight / 2;
    const color = laneColor(commit.graph.column, options.lanes);
    const selected = commit.id === options.selectedId;
    const background = selected ? options.selectedBackground : options.background;

    const merge = commit.kind === "commit" && commit.parents.length > 1;
    // An author's picture goes over this one (ListRow): nothing to draw.
    if (options.avatars && commit.kind === "commit" && !merge) continue;
    const head = commit.id === options.headId;
    // The checked-out commit's dot is a little bigger, with a light centre.
    const radius = (merge ? MERGE_RADIUS : NODE_RADIUS) + (head && commit.kind === "commit" ? 1.5 : 0);

    // A faded node still hides the lines behind it: clear its spot first, then draw it faint.
    ctx.globalAlpha = 1;
    if (faded) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + (selected ? 2.5 : 1), 0, Math.PI * 2);
      ctx.fillStyle = background;
      ctx.fill();
      ctx.globalAlpha = FADED;
    }

    if (selected) {
      // A ring right around the selected commit, with no gap.
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 2.5, 0, Math.PI * 2);
      ctx.fillStyle = options.ring;
      ctx.fill();
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
      // A dot, straight on its lines.
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (head) {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1.5, radius - 4), 0, Math.PI * 2);
        ctx.fillStyle = options.ring;
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  // Then their own commits, glowing over the rest.
  for (const lane of lit) paintLaneDots(lane);

  /**
   * A lit lane (the rest of the graph faded) glows in its colour: its lines and dots in a
   * lighter tint of it on a dark background, and a halo under each of its authors' pictures.
   */
  function laneLook(lane: Lane) {
    const color = laneColor(lane.column, options.lanes);
    const background = parseHex(options.background);
    const light = background !== null && luminance(background) > 0.5;
    // A lighter tint would wash out on a light background: there the lane keeps its colour.
    return { color, light, core: light ? color : tint(color, 0.35) };
  }

  /** A lit lane's lines, in one path to glow as one. */
  function paintLaneLines(lane: Lane) {
    const { color, light, core } = laneLook(lane);
    const path = new Path2D();
    for (let slot = first; slot < last; slot++) {
      const row = slots[slot];
      if (row === undefined) continue;
      const commit = typeof row === "number" ? commits[row] : commits[row.before];
      if (!commit) continue;
      const lines = typeof row === "number" ? commit.graph.lines : passingLines(commit);
      for (const [kind, from, to, child] of lines) if (inLane(lane, kind, from, to, child)) segment(path, kind, from, to, (slot - first) * rowHeight);
    }
    ctx.save();
    ctx.lineWidth = LINE_WIDTH + 0.5;
    ctx.strokeStyle = core;
    ctx.shadowColor = light ? withAlpha(color, 0.6) : color;
    for (const blur of [14, 6]) {
      ctx.shadowBlur = blur;
      ctx.stroke(path);
    }
    ctx.restore();
  }

  /** A lit lane's dots; under its authors' pictures (which go over the graph), a halo. */
  function paintLaneDots(lane: Lane) {
    const { color, light, core } = laneLook(lane);
    ctx.save();
    ctx.shadowColor = light ? withAlpha(color, 0.6) : color;
    for (let slot = first; slot < last; slot++) {
      const row = slots[slot];
      if (typeof row !== "number") continue;
      const commit = commits[row];
      if (!commit || !lane.ids.has(commit.id) || commit.kind !== "commit") continue;
      const merge = commit.parents.length > 1;
      const picture = options.avatars && !merge && options.pictureSize !== undefined;
      const radius = picture ? options.pictureSize! / 2 + 2 : (merge ? MERGE_RADIUS : NODE_RADIUS) + (commit.id === options.headId ? 1.5 : 0);
      ctx.beginPath();
      ctx.arc(x(commit.graph.column), (slot - first) * rowHeight + rowHeight / 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = picture ? color : core;
      ctx.shadowBlur = picture ? 16 : 12;
      ctx.fill();
    }
    ctx.restore();
  }
}

/** `color` (#rrggbb) moved `amount` of the way to white. */
function tint(color: string, amount: number): string {
  const rgb = parseHex(color);
  return rgb ? `rgb(${rgb.map((c) => Math.round(c + (255 - c) * amount)).join(", ")})` : color;
}

/** `color` (#rrggbb), see-through: `alpha` of it. */
function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  return rgb ? `rgba(${rgb.join(", ")}, ${alpha})` : color;
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
