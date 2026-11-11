import { memo, useContext, type MouseEvent, type RefObject } from "react";
import { BisectMarksContext, type BisectMark } from "../../lib/bisect";
import { CiStatesContext, describeCiState } from "../../lib/ciStates";

const BISECT_TITLES: Record<BisectMark, string> = {
  good: "Marked good while bisecting: it works",
  bad: "Marked bad while bisecting: it's broken",
  skipped: "Skipped while bisecting",
  found: "The first bad commit, found by bisecting",
};
import type { CommitRow } from "../../api";
import type { ChangeCounts as Counts } from "../../lib/changes";
import type { CiDots } from "../../lib/appearance";
import { laneColor } from "../../lib/colors";
import { compactTime, fullDate, shortId } from "../../lib/format";
import type { RefPill } from "../../lib/refs";
import type { SelectHow } from "../../lib/selection";
import { Avatar } from "../Avatar";
import { ChangeCounts } from "../ChangeCounts";
import { laneX, type GraphMetrics } from "../graphPainter";
import { RefPills } from "../RefPills";
import { ciOffset, nodeAvatarSize, REFS_PADDING, type ColumnOptions, type VisibleColumns } from "./layout";

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
  /** How a dot on the graph shows its checks (a node with its author's picture has them beside it). */
  ciDots: CiDots;
  /** For the uncommitted changes row: how many files changed. */
  changes?: Counts;
  narrow: boolean;
  dense: boolean;
  selected: boolean;
  /** The commit whose details are shown (the last one clicked). */
  primary: boolean;
  /** Shown on the graph as its author's picture (or initials), ringed in its lane's colour. */
  authorNode: boolean;
  /** The checked-out commit. */
  head: boolean;
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
  const { commit, top, height, metrics, lanes, visible, options, ciDots, changes, narrow, dense, handlers } = props;
  const { selected, primary, dimmed, authorNode, head } = props;
  const bisectMark = useContext(BisectMarksContext).get(commit.id);
  const ci = useContext(CiStatesContext).get(commit.id);
  const on = () => handlers.current!;
  const onSelect = (id: string, how?: SelectHow) => on().onSelect(id, how);
  const color = laneColor(commit.graph.column, lanes);
  // A dot on the graph (not an author's picture) can show its checks itself.
  const onDot = !authorNode && ciDots !== "beside";
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
      data-tour={commit.kind === "worktree" ? "changes" : undefined}
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
            // Placed in the graph's column (see .ref-connector), from just inside the label's.
            left: -REFS_PADDING,
            width: `calc(min(${lane}px, var(--graph-width)) + ${REFS_PADDING}px)`,
            background: color,
          }}
        />
      )}
      <div className="graph-cell">
        {authorNode && (
          <span
            className={`graph-node${head ? " head" : ""}${selected ? " selected" : ""}`}
            style={{ left: lane, ["--lane" as string]: color }}
            title={`${commit.authorName} <${commit.authorEmail}>`}
          >
            <Avatar name={commit.authorName} email={commit.authorEmail} size={nodeAvatarSize(dense)} />
          </span>
        )}
        {ci && options.checks !== false && commit.kind === "commit" && (
          <span
            className={`graph-ci ${ci}${onDot ? ` on-dot ${ciDots}` : ""}`}
            style={{
              left: lane,
              ["--lane" as string]: color,
              ["--ci-offset" as string]: onDot ? "0px" : `${ciOffset({ avatar: authorNode, dense, head, merge: commit.parents.length > 1 })}px`,
            }}
            title={describeCiState(ci)}
            aria-label={describeCiState(ci)}
          />
        )}
      </div>
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
            {bisectMark && (
              <span className={`bisect-tag ${bisectMark}`} title={BISECT_TITLES[bisectMark]}>
                {bisectMark === "found" ? "first bad" : bisectMark}
              </span>
            )}
            <span
              className={`summary${commit.kind === "stash" ? " stash" : commit.parents.length > 1 ? " merge" : ""}`}
              title={commit.summary}
            >
              {commit.summary || "(no message)"}
            </span>
          </div>
          {visible.author && (
            <div className="cell author" title={`${commit.authorName} <${commit.authorEmail}>`}>
              {/* On the graph already: the name is enough here. */}
              {!authorNode && <Avatar name={commit.authorName} email={commit.authorEmail} size={dense ? 18 : 22} />}
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
