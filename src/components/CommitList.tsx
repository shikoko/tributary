import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PAGE_SIZE, type CommitDetails, type CommitRow, type RepoSnapshot } from "../api";
import { countChanges } from "../lib/changes";
import { slotsFor } from "../lib/days";
import { onLabelDrop } from "../lib/drag";
import type { RefPill } from "../lib/refs";
import type { SelectHow } from "../lib/selection";
import { ThemeContext } from "../app/useAppearance";
import { useGraphCanvas, useScrollMarkers } from "./commitList/canvases";
import { DENSE_ROW_HEIGHT, FOOTER_HEIGHT, GRAPH_PADDING, LANE_WIDTH, ROW_HEIGHT, useColumnLayout, type ColumnOptions, type ColumnWidths } from "./commitList/layout";
import { ListHeader } from "./commitList/ListHeader";
import { DaySeparator, ListRow, type RowHandlers } from "./commitList/ListRow";
import { CommitPreview } from "./CommitPreview";

export { DEFAULT_COLUMNS, type ColumnOptions, type ColumnWidths } from "./commitList/layout";

/** How long the pointer rests on a commit before its preview shows, in milliseconds. */
const PREVIEW_DELAY = 650;
/** How long the list's width has to stay put before its columns ease again. */
const WIDTH_SETTLE = 160;

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

/**
 * The commit list with its graph. Only the rows on screen (and a few around them) are
 * rendered, so a history of any length scrolls smoothly.
 */
export function CommitList(props: Props) {
  const { snapshot, selectedId, selectedIds, onSelect, matchIds, dense, columnWidths, onColumnWidths } = props;
  const { columnOptions: show, onLoadMore, loadingMore } = props;
  const { commits, headCommit } = snapshot;
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const markerCanvas = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(props.initialScrollTop);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollbar: 0 });
  const [preview, setPreview] = useState<{ commit: CommitRow; x: number; y: number } | null>(null);
  const previewTimer = useRef<number | undefined>(undefined);
  const hidePreview = () => {
    window.clearTimeout(previewTimer.current);
    setPreview(null);
  };

  const rowHeight = dense ? DENSE_ROW_HEIGHT : ROW_HEIGHT;
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
  const changeCounts = useMemo(() => (snapshot.worktree ? countChanges(snapshot.worktree) : undefined), [snapshot.worktree]);
  const selectedIndex = selectedId ? (indexById.get(selectedId) ?? -1) : -1;
  const contentHeight = slots.length * rowHeight + (snapshot.truncated ? FOOTER_HEIGHT : 0);
  const [settledWidth, setSettledWidth] = useState(0);
  const layout = useColumnLayout({ commits, slots, rowHeight, scrollTop, viewport, settledWidth, columnWidths, show });
  const { first, last, columns, refsWidth, graphWidth } = layout;

  useLayoutEffect(() => {
    const element = scroller.current!;
    const read = () => ({ width: element.clientWidth, height: element.clientHeight, scrollbar: element.offsetWidth - element.clientWidth });
    // While the width keeps changing (a side panel sliding open or closed, the window being
    // resized), the columns follow it frame by frame without easing: easing towards a width
    // that moves every frame made them lag and swing back and forth. Once the width has
    // stayed put, easing comes back, and the layout switches to (or from) the compact one
    // for narrow lists if it has to, in one eased step.
    let settle: ReturnType<typeof setTimeout> | undefined;
    let width = 0;
    const measure = () => {
      const next = read();
      if (width === 0) setSettledWidth(next.width);
      else if (next.width !== width) {
        document.body.classList.add("list-resizing");
        clearTimeout(settle);
        settle = setTimeout(() => {
          document.body.classList.remove("list-resizing");
          setSettledWidth(element.clientWidth);
        }, WIDTH_SETTLE);
      }
      width = next.width;
      setViewport(next);
    };
    measure();
    element.scrollTop = props.initialScrollTop;
    // Focus the list so the arrow keys work straight away.
    element.focus({ preventScroll: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(settle);
      document.body.classList.remove("list-resizing");
    };
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

  const { colors, curves } = useContext(ThemeContext);
  useGraphCanvas(canvas, { commits, slots, first, last, width: graphWidth, rowHeight, headId: headCommit, selectedId, focusIds: props.focusIds, colors, curves });
  const marked = useMemo(() => selectedIds ?? new Set(selectedId ? [selectedId] : []), [selectedIds, selectedId]);
  useScrollMarkers(markerCanvas, { commits, slotOf, indexById, rowHeight, contentHeight, viewport, matchIds, headId: headCommit, selectedIds: marked, colors });

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
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: -commits.length, End: commits.length };
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

  const metrics = useMemo(() => ({ rowHeight, laneWidth: LANE_WIDTH, padding: GRAPH_PADDING }), [rowHeight]);
  // One set of handlers for every row, reading the latest props when called, so rows don't
  // re-render just because the list did.
  const handlers = useRef<RowHandlers>(null!);
  handlers.current = {
    onSelect: (id, how) => {
      hidePreview();
      onSelect(id, how);
    },
    onContextMenu: (commit, x, y) => {
      hidePreview();
      props.onContextMenu(commit, x, y);
    },
    onPillActivate: props.onPillActivate,
    onPillContextMenu: props.onPillContextMenu,
    onPillFocus: props.onPillFocus,
    onHover: (event, commit) => {
      window.clearTimeout(previewTimer.current);
      if (!props.previews || commit.kind === "worktree" || event.buttons) return setPreview(null);
      const { clientX: x, clientY: y } = event;
      previewTimer.current = window.setTimeout(() => setPreview({ commit, x, y }), PREVIEW_DELAY);
    },
    onLeave: hidePreview,
  };
  const rows = [];
  for (let slotIndex = first; slotIndex < last; slotIndex++) {
    const slot = slots[slotIndex];
    if (typeof slot !== "number") {
      rows.push(<DaySeparator key={`day:${slot.before}`} day={slot.day} top={slotIndex * rowHeight} height={rowHeight} />);
      continue;
    }
    const commit = commits[slot];
    rows.push(
      <ListRow
        key={commit.id}
        commit={commit}
        top={slotIndex * rowHeight}
        height={rowHeight}
        metrics={metrics}
        lanes={colors.lanes}
        visible={layout.visible}
        options={show}
        changes={commit.kind === "worktree" ? changeCounts : undefined}
        narrow={layout.narrow}
        dense={dense}
        selected={commit.id === selectedId || Boolean(selectedIds?.has(commit.id))}
        primary={commit.id === selectedId}
        dimmed={(matchIds !== null && !matchIds.has(commit.id)) || (props.focusIds !== null && !props.focusIds.has(commit.id))}
        handlers={handlers}
      />,
    );
  }

  return (
    <section
      className={`commit-list${dense ? " dense" : ""}${layout.graphGrowing ? " graph-growing" : ""}`}
      aria-label="Commits"
      // The rows' columns: set here, so a new width restyles the rows without re-rendering them.
      style={{ ["--list-columns" as string]: columns, ["--refs-width" as string]: `${refsWidth}px`, ["--graph-width" as string]: `${graphWidth}px` }}
    >
      <ListHeader
        columns={columns}
        visible={layout.visible}
        options={show}
        narrow={layout.narrow}
        refsWidth={refsWidth}
        graphWidth={graphWidth}
        columnWidths={columnWidths}
        onColumnWidths={onColumnWidths}
        scrollbar={viewport.scrollbar}
        onContextMenu={props.onHeaderContextMenu}
      />
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
