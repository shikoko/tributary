import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PAGE_SIZE, type CommitDetails, type CommitRow, type RepoSnapshot } from "../api";
import { countChanges, type ChangeCounts as Counts } from "../lib/changes";
import { laneColor } from "../lib/colors";
import { slotsFor, type Slot } from "../lib/days";
import { onLabelDrop } from "../lib/drag";
import { compactTime, fullDate, shortId } from "../lib/format";
import type { RefPill } from "../lib/refs";
import { Avatar } from "./Avatar";
import { ChangeCounts } from "./ChangeCounts";
import { CommitPreview } from "./CommitPreview";
import { laneX, paintGraph, type GraphMetrics } from "./graphPainter";
import { RefPills } from "./RefPills";
import { ResizeHandle } from "./ResizeHandle";

const ROW_HEIGHT = 30;
const DENSE_ROW_HEIGHT = 24;
const LANE_WIDTH = 20;
const GRAPH_PADDING = 10;
/** Default width of the branch and tag column, left of the graph. */
const REFS_WIDTH = 180;
const NARROW_REFS_WIDTH = 140;
const MIN_REFS_WIDTH = 80;
const MAX_REFS_WIDTH = 400;
/** Space between a label and the right edge of the branch and tag column. */
const REFS_PADDING = 8;
const MIN_GRAPH_WIDTH = 72;
const MAX_GRAPH_WIDTH = 320;
/** How wide the graph column can be dragged. */
const MAX_DRAGGED_GRAPH_WIDTH = 800;
/** How long the pointer rests on a commit before its preview shows, in milliseconds. */
const PREVIEW_DELAY = 650;
/** Rows rendered above and below the visible area, so fast scrolling doesn't flash. */
const OVERSCAN = 12;
const FOOTER_HEIGHT = 56;
/** Below this width the SHA column and author names are hidden. */
const NARROW_WIDTH = 760;
/** The graph gets narrower before the commit message column goes below this width. */
const MIN_MESSAGE_WIDTH = 200;

// Keep in sync with --bg, --bg-selected and --accent in styles.css.
const BACKGROUND = "#14161b";
const SELECTED_BACKGROUND = "#252b38";
const ACCENT = "#1fb5ff";
const MATCH_COLOR = "#ffd23f";

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

/** How a click changes the selection: from the last selected commit to this one, or adding / removing it. */
export interface SelectHow {
  extend?: boolean;
  toggle?: boolean;
}

interface Props {
  snapshot: RepoSnapshot;
  selectedId: string | null;
  /** When several commits are selected: all of them, including `selectedId`. */
  selectedIds: Set<string> | null;
  onSelect: (id: string | null, how?: SelectHow) => void;
  /** While searching: the ids of the matching commits. Other rows are dimmed. */
  matchIds: Set<string> | null;
  /** Smaller rows, to see more at once. */
  dense: boolean;
  columnWidths: ColumnWidths;
  onColumnWidths: (widths: ColumnWidths) => void;
  columnOptions: ColumnOptions;
  /** Dividers like "Yesterday" or "October" between commits from different periods. */
  daySeparators: boolean;
  /** Right-click on the column headings. */
  onHeaderContextMenu: (x: number, y: number) => void;
  /** Right-click on a row, at window coordinates (x, y). */
  onContextMenu: (commit: CommitRow, x: number, y: number) => void;
  /** Double-click on a branch label. */
  onPillActivate: (pill: RefPill, commit: CommitRow) => void;
  onPillContextMenu: (pill: RefPill, commit: CommitRow, x: number, y: number) => void;
  /** Alt+click on a branch label. */
  onPillFocus: (pill: RefPill, commit: CommitRow) => void;
  /** While a branch or author is highlighted: the commits that stay bright. Other rows fade. */
  focusIds: Set<string> | null;
  /** Show a commit's preview when the pointer rests on it. */
  previews: boolean;
  loadDetails: (id: string) => Promise<CommitDetails>;
  /** A branch or tag label was dropped on a commit. */
  onDropRef: (revision: string, commit: CommitRow, x: number, y: number) => void;
  /** Where to scroll to when the list first appears. */
  initialScrollTop: number;
  onScrollChange: (scrollTop: number) => void;
  onLoadMore: () => void;
  loadingMore: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)));

export function CommitList(props: Props) {
  const { snapshot, selectedId, selectedIds, onSelect, matchIds, dense, columnWidths, onColumnWidths } = props;
  const { columnOptions: show, onLoadMore, loadingMore } = props;
  const { commits, headCommit } = snapshot;
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const markerCanvas = useRef<HTMLCanvasElement>(null);
  /** Column widths when a drag started. */
  const dragStart = useRef({ refs: 0, graph: 0 });
  const [scrollTop, setScrollTop] = useState(props.initialScrollTop);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollbar: 0 });
  const [preview, setPreview] = useState<{ commit: CommitRow; x: number; y: number } | null>(null);
  const previewTimer = useRef<number | undefined>(undefined);
  const hidePreview = () => {
    window.clearTimeout(previewTimer.current);
    setPreview(null);
  };

  const rowHeight = dense ? DENSE_ROW_HEIGHT : ROW_HEIGHT;
  const metrics: GraphMetrics = { rowHeight, laneWidth: LANE_WIDTH, padding: GRAPH_PADDING };

  const indexById = useMemo(() => new Map(commits.map((commit, index) => [commit.id, index])), [commits]);
  const slots = useMemo(() => slotsFor(commits, props.daySeparators), [commits, props.daySeparators]);
  /** The list row of each commit. */
  const slotOf = useMemo(() => {
    const result = new Array<number>(commits.length);
    slots.forEach((slot, index) => {
      if (typeof slot === "number") result[slot] = index;
    });
    return result;
  }, [slots, commits.length]);
  const changeCounts = useMemo(
    () => (snapshot.worktree ? countChanges(snapshot.worktree) : undefined),
    [snapshot.worktree],
  );
  const selectedIndex = selectedId ? (indexById.get(selectedId) ?? -1) : -1;
  const contentHeight = slots.length * rowHeight + (snapshot.truncated ? FOOTER_HEIGHT : 0);

  const narrow = viewport.width > 0 && viewport.width < NARROW_WIDTH;
  const refsWidth = columnWidths.refs ?? (narrow ? NARROW_REFS_WIDTH : REFS_WIDTH);
  const authorWidth = show.author ? (narrow ? 44 : 180) : 0;
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

  // Wide enough for the lanes in view (not every lane in the history), leaving room for the
  // commit message in narrow windows, unless a width was chosen by dragging.
  const graphWidth =
    columnWidths.graph ??
    Math.min(
      MAX_GRAPH_WIDTH,
      Math.max(MIN_GRAPH_WIDTH, GRAPH_PADDING * 2 + lanes * LANE_WIDTH),
      Math.max(MIN_GRAPH_WIDTH, viewport.width - refsWidth - authorWidth - dateWidth - shaWidth - MIN_MESSAGE_WIDTH),
    );
  // Widening happens at once (easing it would let new lanes run over the messages for a moment).
  const shownGraphWidth = useRef(graphWidth);
  const graphGrowing = graphWidth > shownGraphWidth.current;
  useEffect(() => {
    shownGraphWidth.current = graphWidth;
  }, [graphWidth]);
  const columns = [`${refsWidth}px`, `${graphWidth}px`, "minmax(0, 1fr)", authorWidth, dateWidth, shaWidth]
    .filter((width) => width !== 0)
    .map((width) => (typeof width === "number" ? `${width}px` : width))
    .join(" ");
  const visible = { author: authorWidth > 0, date: dateWidth > 0, sha: shaWidth > 0 };

  useLayoutEffect(() => {
    const element = scroller.current!;
    const measure = () =>
      setViewport({
        width: element.clientWidth,
        height: element.clientHeight,
        scrollbar: element.offsetWidth - element.clientWidth,
      });
    measure();
    element.scrollTop = props.initialScrollTop;
    // Focus the list so the arrow keys work straight away.
    element.focus({ preventScroll: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Labels dragged onto a row.
  const dropRef = useRef(props.onDropRef);
  dropRef.current = props.onDropRef;
  useEffect(
    () =>
      onLabelDrop((revision, targetId, x, y) => {
        const index = indexById.get(targetId);
        if (index !== undefined) dropRef.current(revision, commits[index], x, y);
      }),
    [indexById, commits],
  );

  // Draw the graph for the rendered rows.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    const height = Math.max(0, last - first) * rowHeight;
    const pixelWidth = Math.ceil(graphWidth * ratio);
    const pixelHeight = Math.ceil(height * ratio);
    if (element.width !== pixelWidth) element.width = pixelWidth;
    if (element.height !== pixelHeight) element.height = pixelHeight;
    element.style.width = `${graphWidth}px`;
    element.style.height = `${height}px`;

    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, graphWidth, height);
    paintGraph(ctx, commits, slots, first, last, {
      rowHeight,
      laneWidth: LANE_WIDTH,
      padding: GRAPH_PADDING,
      headId: headCommit,
      selectedId,
      focusIds: props.focusIds,
      background: BACKGROUND,
      selectedBackground: SELECTED_BACKGROUND,
    });
  }, [commits, slots, first, last, graphWidth, headCommit, selectedId, rowHeight, props.focusIds]);

  // Marks next to the scrollbar: branch tips, search matches, the checked-out commit and the selection.
  useLayoutEffect(() => {
    const element = markerCanvas.current;
    // Under the scrollbar; with scrollbars that overlay the content, a thin strip at the edge.
    const width = viewport.scrollbar || 6;
    const { height } = viewport;
    if (!element || !height) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.ceil(width * ratio);
    element.height = Math.ceil(height * ratio);
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
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
    if (headCommit) mark(indexById.get(headCommit), ACCENT, 3, 0);
    (selectedIds ?? new Set(selectedId ? [selectedId] : [])).forEach((id) => mark(indexById.get(id), "#ffffff", 2, 0));
  }, [viewport, commits, slotOf, rowHeight, contentHeight, matchIds, headCommit, selectedId, selectedIds, indexById]);

  // Bring the selected commit into view when it changes.
  useEffect(() => {
    const element = scroller.current;
    if (!element || selectedIndex < 0) return;
    const top = slotOf[selectedIndex] * rowHeight;
    const bottom = top + rowHeight;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight;
    if (top >= viewTop && bottom <= viewBottom) return;
    const nearby = top >= viewTop - 2 * rowHeight && bottom <= viewBottom + 2 * rowHeight;
    if (!nearby) {
      // A jump (for example to a parent commit): centre it.
      element.scrollTop = top - element.clientHeight / 2 + rowHeight / 2;
    } else if (top < viewTop) {
      element.scrollTop = top;
    } else {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [selectedIndex, slotOf, rowHeight]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (commits.length === 0) return;
    const page = Math.max(1, Math.floor(viewport.height / rowHeight) - 1);
    const moves: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: page,
      PageUp: -page,
      Home: -commits.length,
      End: commits.length,
    };
    if (event.key === "Escape") {
      onSelect(null);
    } else if (event.key in moves) {
      const from = selectedIndex < 0 ? (moves[event.key] > 0 ? -1 : commits.length) : selectedIndex;
      const next = Math.min(commits.length - 1, Math.max(0, from + moves[event.key]));
      onSelect(commits[next].id, { extend: event.shiftKey });
    } else {
      return;
    }
    event.preventDefault();
  };

  const startDrag = () => (dragStart.current = { refs: refsWidth, graph: graphWidth });

  const rows = [];
  for (let slotIndex = first; slotIndex < last; slotIndex++) {
    const slot: Slot = slots[slotIndex];
    if (typeof slot !== "number") {
      rows.push(
        <div
          key={`day:${slot.before}`}
          className="day-separator"
          style={{ top: slotIndex * rowHeight, height: rowHeight, gridTemplateColumns: columns }}
          role="presentation"
        >
          <div />
          <div />
          <div className="day-label">
            <span>{slot.day}</span>
          </div>
        </div>,
      );
      continue;
    }
    const commit = commits[slot];
    const selected = commit.id === selectedId || Boolean(selectedIds?.has(commit.id));
    rows.push(
      <Row
        key={commit.id}
        commit={commit}
        top={slotIndex * rowHeight}
        height={rowHeight}
        metrics={metrics}
        columns={columns}
        visible={visible}
        options={show}
        refsWidth={refsWidth}
        graphWidth={graphWidth}
        changes={commit.kind === "worktree" ? changeCounts : undefined}
        narrow={narrow}
        dense={dense}
        selected={selected}
        primary={commit.id === selectedId}
        dimmed={
          (matchIds !== null && !matchIds.has(commit.id)) || (props.focusIds !== null && !props.focusIds.has(commit.id))
        }
        onSelect={(id, how) => {
          hidePreview();
          onSelect(id, how);
        }}
        onContextMenu={(commit, x, y) => {
          hidePreview();
          props.onContextMenu(commit, x, y);
        }}
        onPillActivate={props.onPillActivate}
        onPillContextMenu={props.onPillContextMenu}
        onPillFocus={props.onPillFocus}
        onHover={(event) => {
          window.clearTimeout(previewTimer.current);
          if (!props.previews || commit.kind === "worktree" || event.buttons) return setPreview(null);
          const { clientX: x, clientY: y } = event;
          previewTimer.current = window.setTimeout(() => setPreview({ commit, x, y }), PREVIEW_DELAY);
        }}
        onLeave={hidePreview}
      />,
    );
  }

  return (
    <section className={`commit-list${dense ? " dense" : ""}${graphGrowing ? " graph-growing" : ""}`} aria-label="Commits">
      <div
        className="list-header"
        style={{ gridTemplateColumns: columns, paddingRight: viewport.scrollbar }}
        role="presentation"
        onContextMenu={(event) => {
          event.preventDefault();
          props.onHeaderContextMenu(event.clientX, event.clientY);
        }}
      >
        <div className="refs-heading">
          Branch / Tag
          <ResizeHandle
            onResizeStart={startDrag}
            onResize={(delta) =>
              onColumnWidths({ ...columnWidths, refs: clamp(dragStart.current.refs + delta, MIN_REFS_WIDTH, MAX_REFS_WIDTH) })
            }
            onReset={() => onColumnWidths({ ...columnWidths, refs: null })}
          />
        </div>
        <div className="graph-heading">
          Graph
          <ResizeHandle
            onResizeStart={startDrag}
            onResize={(delta) =>
              onColumnWidths({
                ...columnWidths,
                graph: clamp(dragStart.current.graph + delta, MIN_GRAPH_WIDTH, MAX_DRAGGED_GRAPH_WIDTH),
              })
            }
            onReset={() => onColumnWidths({ ...columnWidths, graph: null })}
          />
        </div>
        <div>Message</div>
        {visible.author && <div>{narrow ? "" : "Author"}</div>}
        {visible.date && <div>{show.dateKind === "committed" ? "Committed" : "Date"}</div>}
        {visible.sha && <div>SHA</div>}
      </div>
      <div className="list-body">
        <canvas ref={markerCanvas} className="list-markers" aria-hidden />
        <div
          ref={scroller}
          className="list-scroller"
          tabIndex={0}
          onScroll={(event) => {
            hidePreview();
            setScrollTop(event.currentTarget.scrollTop);
            props.onScrollChange(event.currentTarget.scrollTop);
          }}
          onKeyDown={onKeyDown}
          role="listbox"
          aria-multiselectable
          aria-activedescendant={selectedId ? `commit-${selectedId}` : undefined}
        >
          {commits.length === 0 ? (
            <div className="list-empty">This repository doesn't have any commits yet.</div>
          ) : (
            <div className="list-spacer" style={{ height: contentHeight }}>
              {rows}
              <canvas ref={canvas} className="graph-canvas" style={{ top: first * rowHeight, left: refsWidth }} />
              {snapshot.truncated && (
                <div className="list-footer" style={{ top: slots.length * rowHeight, height: FOOTER_HEIGHT }}>
                  <span>Showing the {commits.length.toLocaleString()} most recent commits.</span>
                  <button className="tool-button" onClick={onLoadMore} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : `Load ${PAGE_SIZE.toLocaleString()} more`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {preview && <CommitPreview commit={preview.commit} x={preview.x} y={preview.y} loadDetails={props.loadDetails} />}
    </section>
  );
}

interface RowProps {
  commit: CommitRow;
  top: number;
  height: number;
  metrics: GraphMetrics;
  columns: string;
  visible: { author: boolean; date: boolean; sha: boolean };
  options: ColumnOptions;
  refsWidth: number;
  graphWidth: number;
  /** For the uncommitted changes row: how many files changed. */
  changes?: Counts;
  narrow: boolean;
  dense: boolean;
  selected: boolean;
  /** The commit whose details are shown (the last one clicked). */
  primary: boolean;
  /** Not a search match, or outside the highlighted history. */
  dimmed: boolean;
  onSelect: (id: string, how?: SelectHow) => void;
  onContextMenu: (commit: CommitRow, x: number, y: number) => void;
  onPillActivate: (pill: RefPill, commit: CommitRow) => void;
  onPillContextMenu: (pill: RefPill, commit: CommitRow, x: number, y: number) => void;
  onPillFocus: (pill: RefPill, commit: CommitRow) => void;
  onHover: (event: React.MouseEvent) => void;
  onLeave: () => void;
}

function Row(props: RowProps) {
  const { commit, top, height, metrics, columns, visible, options, refsWidth, graphWidth, changes, narrow, dense } =
    props;
  const { selected, primary, dimmed, onSelect, onContextMenu } = props;
  const color = laneColor(commit.graph.column);
  // A line from the label to the commit's node in the graph.
  const connectorStart = refsWidth - REFS_PADDING;
  const connectorEnd = refsWidth + Math.min(laneX(commit.graph.column, metrics), graphWidth);
  const time = options.dateKind === "committed" ? commit.commitTime : commit.time;
  const dateTitle =
    commit.commitTime !== commit.time
      ? `Authored ${fullDate(commit.time)}\nCommitted ${fullDate(commit.commitTime)}`
      : fullDate(commit.time);
  return (
    <div
      id={`commit-${commit.id}`}
      className={`commit-row${selected ? " selected" : ""}${primary ? " primary" : ""}${dimmed ? " dimmed" : ""}`}
      style={{
        top,
        height,
        gridTemplateColumns: columns,
        boxShadow: primary ? `inset 3px 0 0 ${color}` : undefined,
      }}
      data-drop-commit={commit.kind === "commit" ? commit.id : undefined}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        const toggle = event.metaKey || event.ctrlKey;
        // Keep the browser from selecting text while shift-clicking.
        if (event.shiftKey || toggle) event.preventDefault();
        onSelect(commit.id, { extend: event.shiftKey, toggle });
      }}
      onMouseEnter={props.onHover}
      onMouseMove={props.onHover}
      onMouseLeave={props.onLeave}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!selected) onSelect(commit.id);
        onContextMenu(commit, event.clientX, event.clientY);
      }}
      role="option"
      aria-selected={selected}
    >
      <div className="cell refs-cell">
        <RefPills
          refs={commit.refs}
          color={color}
          limit={1}
          onActivate={(pill) => props.onPillActivate(pill, commit)}
          onContextMenu={(pill, x, y) => {
            onSelect(commit.id);
            props.onPillContextMenu(pill, commit, x, y);
          }}
          onFocusPill={(pill) => props.onPillFocus(pill, commit)}
          draggable
        />
      </div>
      {commit.refs.length > 0 && (
        <span
          className="ref-connector"
          style={{ left: connectorStart, width: connectorEnd - connectorStart, background: color }}
        />
      )}
      <div />
      {commit.kind === "worktree" ? (
        <>
          <div className="cell description">
            <span className="summary wip">Uncommitted changes</span>
            {changes && <ChangeCounts counts={changes} />}
          </div>
          {visible.author && <div />}
          {visible.date && <div />}
          {visible.sha && <div />}
        </>
      ) : (
        <>
          <div className="cell description">
            <span
              className={`summary${commit.kind === "stash" ? " stash" : commit.parents.length > 1 ? " merge" : ""}`}
              title={commit.summary}
            >
              {commit.summary || "(no message)"}
            </span>
          </div>
          {visible.author && (
            <div className="cell author" title={`${commit.authorName} <${commit.authorEmail}>`}>
              <Avatar name={commit.authorName} email={commit.authorEmail} size={dense ? 18 : 22} />
              {!narrow && <span className="author-name">{commit.authorName}</span>}
            </div>
          )}
          {visible.date && (
            <div className="cell date" title={dateTitle}>
              {options.dateFormat === "exact" ? fullDate(time) : compactTime(time)}
            </div>
          )}
          {visible.sha && <div className="cell sha">{shortId(commit.id)}</div>}
        </>
      )}
    </div>
  );
}
