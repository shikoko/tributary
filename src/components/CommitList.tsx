import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PAGE_SIZE, type CommitDetails, type CommitRow, type RepoSnapshot } from "../api";
import { countChanges, type ChangeCounts as Counts } from "../lib/changes";
import { laneColor } from "../lib/colors";
import { fullDate, relativeTime, shortId } from "../lib/format";
import type { RefPill } from "../lib/refs";
import { Avatar } from "./Avatar";
import { ChangeCounts } from "./ChangeCounts";
import { CommitPreview } from "./CommitPreview";
import { laneX, paintGraph, type GraphMetrics } from "./graphPainter";
import { DRAG_TYPE, RefPills } from "./RefPills";
import { ResizeHandle } from "./ResizeHandle";

const ROW_HEIGHT = 30;
const DENSE_ROW_HEIGHT = 24;
const LANE_WIDTH = 20;
const GRAPH_PADDING = 10;
/** Default width of the branch and tag column, left of the graph. */
const REFS_WIDTH = 180;
const NARROW_REFS_WIDTH = 120;
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

// Keep in sync with --bg and --bg-selected in styles.css.
const BACKGROUND = "#14161b";
const SELECTED_BACKGROUND = "#252b38";

/** Column widths chosen by dragging; null means automatic. */
export interface ColumnWidths {
  refs: number | null;
  graph: number | null;
}

interface Props {
  snapshot: RepoSnapshot;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** While searching: the ids of the matching commits. Other rows are dimmed. */
  matchIds: Set<string> | null;
  /** Smaller rows, to see more at once. */
  dense: boolean;
  columnWidths: ColumnWidths;
  onColumnWidths: (widths: ColumnWidths) => void;
  /** Right-click on a row, at window coordinates (x, y). */
  onContextMenu: (commit: CommitRow, x: number, y: number) => void;
  /** Double-click on a branch label. */
  onPillActivate: (pill: RefPill, commit: CommitRow) => void;
  onPillContextMenu: (pill: RefPill, commit: CommitRow, x: number, y: number) => void;
  /** Alt+click on a branch label. */
  onPillFocus: (pill: RefPill, commit: CommitRow) => void;
  /** While a branch is highlighted: the commits in its history. Other rows fade. */
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
  const { snapshot, selectedId, onSelect, matchIds, dense, columnWidths, onColumnWidths, onLoadMore, loadingMore } =
    props;
  const { commits, headCommit } = snapshot;
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  /** Column widths when a drag started. */
  const dragStart = useRef({ refs: 0, graph: 0 });
  const [scrollTop, setScrollTop] = useState(props.initialScrollTop);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollbar: 0 });
  const [preview, setPreview] = useState<{ commit: CommitRow; x: number; y: number } | null>(null);
  const previewTimer = useRef<number | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const hidePreview = () => {
    window.clearTimeout(previewTimer.current);
    setPreview(null);
  };

  const rowHeight = dense ? DENSE_ROW_HEIGHT : ROW_HEIGHT;
  const metrics: GraphMetrics = { rowHeight, laneWidth: LANE_WIDTH, padding: GRAPH_PADDING };

  const indexById = useMemo(() => new Map(commits.map((commit, index) => [commit.id, index])), [commits]);
  const changeCounts = useMemo(
    () => (snapshot.worktree ? countChanges(snapshot.worktree) : undefined),
    [snapshot.worktree],
  );
  const selectedIndex = selectedId ? (indexById.get(selectedId) ?? -1) : -1;

  const narrow = viewport.width > 0 && viewport.width < NARROW_WIDTH;
  const refsWidth = columnWidths.refs ?? (narrow ? NARROW_REFS_WIDTH : REFS_WIDTH);
  const otherColumns = narrow ? 44 + 104 : 180 + 128 + 80;
  // Wide enough for every lane, but leave room for the commit message in narrow windows,
  // unless a width was chosen by dragging.
  const graphWidth =
    columnWidths.graph ??
    Math.min(
      MAX_GRAPH_WIDTH,
      Math.max(MIN_GRAPH_WIDTH, GRAPH_PADDING * 2 + snapshot.laneCount * LANE_WIDTH),
      Math.max(MIN_GRAPH_WIDTH, viewport.width - refsWidth - otherColumns - MIN_MESSAGE_WIDTH),
    );
  const columns = narrow
    ? `${refsWidth}px ${graphWidth}px minmax(0, 1fr) 44px 104px`
    : `${refsWidth}px ${graphWidth}px minmax(0, 1fr) 180px 128px 80px`;

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

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(commits.length, Math.ceil((scrollTop + viewport.height) / rowHeight) + OVERSCAN);

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
    paintGraph(ctx, commits, first, last, {
      rowHeight,
      laneWidth: LANE_WIDTH,
      padding: GRAPH_PADDING,
      headId: headCommit,
      selectedId,
      focusIds: props.focusIds,
      background: BACKGROUND,
      selectedBackground: SELECTED_BACKGROUND,
    });
  }, [commits, first, last, graphWidth, headCommit, selectedId, rowHeight, props.focusIds]);

  // Bring the selected commit into view when it changes.
  useEffect(() => {
    const element = scroller.current;
    if (!element || selectedIndex < 0) return;
    const top = selectedIndex * rowHeight;
    const bottom = top + rowHeight;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight;
    if (top >= viewTop && bottom <= viewBottom) return;
    const nearby = top >= viewTop - rowHeight && bottom <= viewBottom + rowHeight;
    if (!nearby) {
      // A jump (for example to a parent commit): centre it.
      element.scrollTop = top - element.clientHeight / 2 + rowHeight / 2;
    } else if (top < viewTop) {
      element.scrollTop = top;
    } else {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [selectedIndex, rowHeight]);

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
      onSelect(commits[next].id);
    } else {
      return;
    }
    event.preventDefault();
  };

  const startDrag = () => (dragStart.current = { refs: refsWidth, graph: graphWidth });

  const rows = [];
  for (let index = first; index < last; index++) {
    const commit = commits[index];
    rows.push(
      <Row
        key={commit.id}
        commit={commit}
        top={index * rowHeight}
        height={rowHeight}
        metrics={metrics}
        columns={columns}
        refsWidth={refsWidth}
        graphWidth={graphWidth}
        changes={commit.kind === "worktree" ? changeCounts : undefined}
        narrow={narrow}
        dense={dense}
        selected={index === selectedIndex}
        dimmed={
          (matchIds !== null && !matchIds.has(commit.id)) || (props.focusIds !== null && !props.focusIds.has(commit.id))
        }
        dropTarget={dropTarget === commit.id}
        onSelect={(id) => {
          hidePreview();
          onSelect(id);
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
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE) || commit.kind === "worktree") return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget(commit.id);
        }}
        onDrop={(event) => {
          const revision = event.dataTransfer.getData(DRAG_TYPE);
          setDropTarget(null);
          if (!revision) return;
          event.preventDefault();
          props.onDropRef(revision, commit, event.clientX, event.clientY);
        }}
      />,
    );
  }

  return (
    <section className={`commit-list${dense ? " dense" : ""}`} aria-label="Commits">
      <div
        className="list-header"
        style={{ gridTemplateColumns: columns, paddingRight: viewport.scrollbar }}
        role="presentation"
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
        <div>{narrow ? "" : "Author"}</div>
        <div>Date</div>
        {!narrow && <div>SHA</div>}
      </div>
      <div
        ref={scroller}
        className="list-scroller"
        tabIndex={0}
        onScroll={(event) => {
          hidePreview();
          setScrollTop(event.currentTarget.scrollTop);
          props.onScrollChange(event.currentTarget.scrollTop);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
        }}
        onKeyDown={onKeyDown}
        role="listbox"
        aria-activedescendant={selectedId ? `commit-${selectedId}` : undefined}
      >
        {commits.length === 0 ? (
          <div className="list-empty">This repository doesn't have any commits yet.</div>
        ) : (
          <div
            className="list-spacer"
            style={{ height: commits.length * rowHeight + (snapshot.truncated ? FOOTER_HEIGHT : 0) }}
          >
            {rows}
            <canvas ref={canvas} className="graph-canvas" style={{ top: first * rowHeight, left: refsWidth }} />
            {snapshot.truncated && (
              <div className="list-footer" style={{ top: commits.length * rowHeight, height: FOOTER_HEIGHT }}>
                <span>Showing the {commits.length.toLocaleString()} most recent commits.</span>
                <button className="tool-button" onClick={onLoadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : `Load ${PAGE_SIZE.toLocaleString()} more`}
                </button>
              </div>
            )}
          </div>
        )}
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
  refsWidth: number;
  graphWidth: number;
  /** For the uncommitted changes row: how many files changed. */
  changes?: Counts;
  narrow: boolean;
  dense: boolean;
  selected: boolean;
  /** Not a search match, or outside the highlighted history. */
  dimmed: boolean;
  /** A label is being dragged over this row. */
  dropTarget: boolean;
  onSelect: (id: string) => void;
  onContextMenu: (commit: CommitRow, x: number, y: number) => void;
  onPillActivate: (pill: RefPill, commit: CommitRow) => void;
  onPillContextMenu: (pill: RefPill, commit: CommitRow, x: number, y: number) => void;
  onPillFocus: (pill: RefPill, commit: CommitRow) => void;
  onHover: (event: React.MouseEvent) => void;
  onLeave: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

function Row(props: RowProps) {
  const { commit, top, height, metrics, columns, refsWidth, graphWidth, changes, narrow, dense, selected, dimmed } =
    props;
  const { onSelect, onContextMenu } = props;
  const color = laneColor(commit.graph.column);
  // A line from the label to the commit's node in the graph.
  const connectorStart = refsWidth - REFS_PADDING;
  const connectorEnd = refsWidth + Math.min(laneX(commit.graph.column, metrics), graphWidth);
  return (
    <div
      id={`commit-${commit.id}`}
      className={`commit-row${selected ? " selected" : ""}${dimmed ? " dimmed" : ""}${props.dropTarget ? " drop-target" : ""}`}
      style={{
        top,
        height,
        gridTemplateColumns: columns,
        boxShadow: selected ? `inset 3px 0 0 ${color}` : undefined,
      }}
      onMouseDown={(event) => event.button === 0 && onSelect(commit.id)}
      onMouseEnter={props.onHover}
      onMouseMove={props.onHover}
      onMouseLeave={props.onLeave}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect(commit.id);
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
          <div />
          <div />
          {!narrow && <div />}
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
          <div className="cell author" title={`${commit.authorName} <${commit.authorEmail}>`}>
            <Avatar name={commit.authorName} email={commit.authorEmail} size={dense ? 18 : 22} />
            {!narrow && <span className="author-name">{commit.authorName}</span>}
          </div>
          <div className="cell date" title={fullDate(commit.time)}>
            {relativeTime(commit.time)}
          </div>
          {!narrow && <div className="cell sha">{shortId(commit.id)}</div>}
        </>
      )}
    </div>
  );
}
