import { memo, type MouseEvent, type RefObject } from "react";
import type { CommitRow } from "../../api";
import type { ChangeCounts as Counts } from "../../lib/changes";
import { laneColor } from "../../lib/colors";
import { compactTime, fullDate, shortId } from "../../lib/format";
import type { RefPill } from "../../lib/refs";
import type { SelectHow } from "../../lib/selection";
import { Avatar } from "../Avatar";
import { ChangeCounts } from "../ChangeCounts";
import { laneX, type GraphMetrics } from "../graphPainter";
import { RefPills } from "../RefPills";
import { REFS_PADDING, type ColumnOptions, type VisibleColumns } from "./layout";

/** What a row does when it's clicked, hovered, … (the list's latest, read at the time). */
export interface RowHandlers {
  onSelect: (id: string, how?: SelectHow) => void;
  onContextMenu: (commit: CommitRow, x: number, y: number) => void;
  onPillActivate: (pill: RefPill, commit: CommitRow) => void;
  onPillContextMenu: (pill: RefPill, commit: CommitRow, x: number, y: number) => void;
  onPillFocus: (pill: RefPill, commit: CommitRow) => void;
  /** The labels that didn't fit next to a commit: pick one for its menu. */
  onMorePills: (pills: RefPill[], commit: CommitRow, x: number, y: number) => void;
  onHover: (event: MouseEvent, commit: CommitRow) => void;
  onLeave: () => void;
}

interface RowProps {
  commit: CommitRow;
  top: number;
  height: number;
  metrics: GraphMetrics;
  /** The lane colours in use. */
  lanes: string[];
  visible: VisibleColumns;
  options: ColumnOptions;
  /** For the uncommitted changes row: how many files changed. */
  changes?: Counts;
  narrow: boolean;
  dense: boolean;
  selected: boolean;
  /** The commit whose details are shown (the last one clicked). */
  primary: boolean;
  /** Not a search match, or outside the highlighted history. */
  dimmed: boolean;
  handlers: RefObject<RowHandlers>;
}

/**
 * One commit in the list: its labels, message, author, date and SHA. The graph is drawn
 * under the rows, on a canvas. The columns come from the list (CSS variables), so a new
 * width doesn't re-render the rows, and a row re-renders only when what it shows changes.
 */
export const ListRow = memo(function ListRow(props: RowProps) {
  const { commit, top, height, metrics, lanes, visible, options, changes, narrow, dense, handlers } = props;
  const { selected, primary, dimmed } = props;
  const on = () => handlers.current!;
  const onSelect = (id: string, how?: SelectHow) => on().onSelect(id, how);
  const color = laneColor(commit.graph.column, lanes);
  // A line from the label to the commit's node in the graph (which can be narrower than its lane).
  const lane = laneX(commit.graph.column, metrics);
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
      onMouseEnter={(event) => on().onHover(event, commit)}
      onMouseMove={(event) => on().onHover(event, commit)}
      onMouseLeave={() => on().onLeave()}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!selected) onSelect(commit.id);
        on().onContextMenu(commit, event.clientX, event.clientY);
      }}
      role="option"
      aria-selected={selected}
    >
      <div className="cell refs-cell">
        <RefPills
          refs={commit.refs}
          color={color}
          limit={1}
          onActivate={(pill) => on().onPillActivate(pill, commit)}
          onContextMenu={(pill, x, y) => {
            onSelect(commit.id);
            on().onPillContextMenu(pill, commit, x, y);
          }}
          onFocusPill={(pill) => on().onPillFocus(pill, commit)}
          onMore={(pills, x, y) => {
            onSelect(commit.id);
            on().onMorePills(pills, commit, x, y);
          }}
          draggable
        />
      </div>
      {commit.refs.length > 0 && (
        <span
          className="ref-connector"
          style={{
            left: `calc(var(--refs-width) - ${REFS_PADDING}px)`,
            width: `calc(min(${lane}px, var(--graph-width)) + ${REFS_PADDING}px)`,
            background: color,
          }}
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
});

/** A divider like "Yesterday" or "October" between commits from different periods. */
export function DaySeparator({ day, top, height }: { day: string; top: number; height: number }) {
  return (
    <div className="day-separator" style={{ top, height }} role="presentation">
      <div />
      <div />
      <div className="day-label">
        <span>{day}</span>
      </div>
    </div>
  );
}
