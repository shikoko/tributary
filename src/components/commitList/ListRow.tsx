import type { MouseEvent } from "react";
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

interface RowProps {
  commit: CommitRow;
  top: number;
  height: number;
  metrics: GraphMetrics;
  columns: string;
  visible: VisibleColumns;
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
  onHover: (event: MouseEvent) => void;
  onLeave: () => void;
}

/** One commit in the list: its labels, message, author, date and SHA. The graph is drawn under the rows, on a canvas. */
export function ListRow(props: RowProps) {
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

/** A divider like "Yesterday" or "October" between commits from different periods. */
export function DaySeparator({ day, top, height, columns }: { day: string; top: number; height: number; columns: string }) {
  return (
    <div className="day-separator" style={{ top, height, gridTemplateColumns: columns }} role="presentation">
      <div />
      <div />
      <div className="day-label">
        <span>{day}</span>
      </div>
    </div>
  );
}
