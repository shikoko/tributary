import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PAGE_SIZE, type CommitRow, type RepoSnapshot } from "../api";
import { countChanges, type ChangeCounts as Counts } from "../lib/changes";
import { laneColor } from "../lib/colors";
import { fullDate, relativeTime, shortId } from "../lib/format";
import { Avatar } from "./Avatar";
import { ChangeCounts } from "./ChangeCounts";
import { laneX, paintGraph, type GraphMetrics } from "./graphPainter";
import { RefPills } from "./RefPills";

const ROW_HEIGHT = 30;
const LANE_WIDTH = 20;
const GRAPH_PADDING = 10;
const METRICS: GraphMetrics = { rowHeight: ROW_HEIGHT, laneWidth: LANE_WIDTH, padding: GRAPH_PADDING };
/** Width of the branch and tag column, left of the graph. */
const REFS_WIDTH = 180;
const COMPACT_REFS_WIDTH = 120;
/** Space between a label and the right edge of the branch and tag column. */
const REFS_PADDING = 8;
const MIN_GRAPH_WIDTH = 72;
const MAX_GRAPH_WIDTH = 320;
/** Rows rendered above and below the visible area, so fast scrolling doesn't flash. */
const OVERSCAN = 12;
const FOOTER_HEIGHT = 56;
/** Below this width the SHA column and author names are hidden. */
const COMPACT_WIDTH = 760;
/** The graph gets narrower before the commit message column goes below this width. */
const MIN_MESSAGE_WIDTH = 200;

// Keep in sync with --bg and --bg-selected in styles.css.
const BACKGROUND = "#14161b";
const SELECTED_BACKGROUND = "#252b38";

interface Props {
  snapshot: RepoSnapshot;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLoadMore: () => void;
  loadingMore: boolean;
}

export function CommitList({ snapshot, selectedId, onSelect, onLoadMore, loadingMore }: Props) {
  const { commits, headCommit } = snapshot;
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollbar: 0 });

  const indexById = useMemo(() => new Map(commits.map((commit, index) => [commit.id, index])), [commits]);
  const changeCounts = useMemo(
    () => (snapshot.worktree ? countChanges(snapshot.worktree) : undefined),
    [snapshot.worktree],
  );
  const selectedIndex = selectedId ? (indexById.get(selectedId) ?? -1) : -1;

  const compact = viewport.width > 0 && viewport.width < COMPACT_WIDTH;
  const refsWidth = compact ? COMPACT_REFS_WIDTH : REFS_WIDTH;
  const otherColumns = compact ? 44 + 104 : 180 + 128 + 80;
  // Wide enough for every lane, but leave room for the commit message in narrow windows.
  const graphWidth = Math.min(
    MAX_GRAPH_WIDTH,
    Math.max(MIN_GRAPH_WIDTH, GRAPH_PADDING * 2 + snapshot.laneCount * LANE_WIDTH),
    Math.max(MIN_GRAPH_WIDTH, viewport.width - refsWidth - otherColumns - MIN_MESSAGE_WIDTH),
  );
  const columns = compact
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
    // Focus the list so the arrow keys work straight away.
    element.focus({ preventScroll: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(commits.length, Math.ceil((scrollTop + viewport.height) / ROW_HEIGHT) + OVERSCAN);

  // Draw the graph for the rendered rows.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    const height = Math.max(0, last - first) * ROW_HEIGHT;
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
      ...METRICS,
      headId: headCommit,
      selectedId,
      background: BACKGROUND,
      selectedBackground: SELECTED_BACKGROUND,
    });
  }, [commits, first, last, graphWidth, headCommit, selectedId]);

  // Bring the selected commit into view when it changes.
  useEffect(() => {
    const element = scroller.current;
    if (!element || selectedIndex < 0) return;
    const top = selectedIndex * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight;
    if (top >= viewTop && bottom <= viewBottom) return;
    const nearby = top >= viewTop - ROW_HEIGHT && bottom <= viewBottom + ROW_HEIGHT;
    if (!nearby) {
      // A jump (for example to a parent commit): centre it.
      element.scrollTop = top - element.clientHeight / 2 + ROW_HEIGHT / 2;
    } else if (top < viewTop) {
      element.scrollTop = top;
    } else {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [selectedIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (commits.length === 0) return;
    const page = Math.max(1, Math.floor(viewport.height / ROW_HEIGHT) - 1);
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

  const rows = [];
  for (let index = first; index < last; index++) {
    const commit = commits[index];
    rows.push(
      <Row
        key={commit.id}
        commit={commit}
        top={index * ROW_HEIGHT}
        columns={columns}
        refsWidth={refsWidth}
        graphWidth={graphWidth}
        changes={commit.kind === "worktree" ? changeCounts : undefined}
        compact={compact}
        selected={index === selectedIndex}
        onSelect={onSelect}
      />,
    );
  }

  return (
    <section className="commit-list" aria-label="Commits">
      <div
        className="list-header"
        style={{ gridTemplateColumns: columns, paddingRight: viewport.scrollbar }}
        role="presentation"
      >
        <div className="refs-heading">Branch / Tag</div>
        <div>Graph</div>
        <div>Message</div>
        <div>{compact ? "" : "Author"}</div>
        <div>Date</div>
        {!compact && <div>SHA</div>}
      </div>
      <div
        ref={scroller}
        className="list-scroller"
        tabIndex={0}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
        role="listbox"
        aria-activedescendant={selectedId ? `commit-${selectedId}` : undefined}
      >
        {commits.length === 0 ? (
          <div className="list-empty">This repository doesn't have any commits yet.</div>
        ) : (
          <div
            className="list-spacer"
            style={{ height: commits.length * ROW_HEIGHT + (snapshot.truncated ? FOOTER_HEIGHT : 0) }}
          >
            {rows}
            <canvas ref={canvas} className="graph-canvas" style={{ top: first * ROW_HEIGHT, left: refsWidth }} />
            {snapshot.truncated && (
              <div className="list-footer" style={{ top: commits.length * ROW_HEIGHT, height: FOOTER_HEIGHT }}>
                <span>Showing the {commits.length.toLocaleString()} most recent commits.</span>
                <button className="tool-button" onClick={onLoadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : `Load ${PAGE_SIZE.toLocaleString()} more`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

interface RowProps {
  commit: CommitRow;
  top: number;
  columns: string;
  refsWidth: number;
  graphWidth: number;
  /** For the uncommitted changes row: how many files changed. */
  changes?: Counts;
  compact: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}

function Row({ commit, top, columns, refsWidth, graphWidth, changes, compact, selected, onSelect }: RowProps) {
  const color = laneColor(commit.graph.column);
  // A line from the label to the commit's node in the graph.
  const connectorStart = refsWidth - REFS_PADDING;
  const connectorEnd = refsWidth + Math.min(laneX(commit.graph.column, METRICS), graphWidth);
  return (
    <div
      id={`commit-${commit.id}`}
      className={`commit-row${selected ? " selected" : ""}`}
      style={{
        top,
        height: ROW_HEIGHT,
        gridTemplateColumns: columns,
        boxShadow: selected ? `inset 3px 0 0 ${color}` : undefined,
      }}
      onMouseDown={() => onSelect(commit.id)}
      role="option"
      aria-selected={selected}
    >
      <div className="cell refs-cell">
        <RefPills refs={commit.refs} color={color} limit={1} />
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
          {!compact && <div />}
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
            <Avatar name={commit.authorName} email={commit.authorEmail} size={22} />
            {!compact && <span className="author-name">{commit.authorName}</span>}
          </div>
          <div className="cell date" title={fullDate(commit.time)}>
            {relativeTime(commit.time)}
          </div>
          {!compact && <div className="cell sha">{shortId(commit.id)}</div>}
        </>
      )}
    </div>
  );
}
