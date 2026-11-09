// Team activity's pieces: what the view is given, avatars ringed in each person's colour,
// how far a branch is from the main one, and a tooltip.
import { useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import type { BranchActivity, Lock, RecentRequest, TeamActivity, TeamPerson, TeamWork } from "../../api";
import { plural } from "../../lib/format";
import { baseName } from "../../lib/paths";
import { Avatar } from "../Avatar";

export interface TeamData {
  team: TeamActivity;
  /** What was changed (kinds of file, hotspots, lines), once read. */
  work: TeamWork | null;
  /** Pull requests lately, when the repository is on GitHub or GitLab. */
  requests: RecentRequest[] | null;
  /** The period's days, each as its midnight (milliseconds), and now. */
  days: number[];
  now: number;
  /** Someone's colour: from the graph colours chosen in Settings, in the order people appear. */
  colorOf: (email: string) => string;
  isYou: (email: string) => boolean;
  /** Files you're changing that a branch also changes. */
  yoursOn: (branch: BranchActivity) => string[];
  /** Who holds which Git LFS locks, the most first (null when the repository has none). */
  lockOwners: [string, Lock[]][] | null;
  tip: Tip;
  onShowBranch: (branch: BranchActivity) => void;
  onShowPerson: (person: TeamPerson) => void;
}

/** A person's picture or initials, ringed in their colour. */
export function RingedAvatar({ person, color, size }: { person: { name: string; email: string }; color: string; size: number }) {
  return (
    <span className="team-ring" style={{ "--ring": color } as CSSProperties}>
      <Avatar name={person.name} email={person.email} size={size} color={color} />
    </span>
  );
}

/** A dot of someone's colour, for legends. */
export function Swatch({ color }: { color: string }) {
  return <span className="team-swatch" style={{ background: color }} />;
}

export function YouTag() {
  return <span className="team-you">you</span>;
}

/**
 * How far a branch is from the main one: commits it's behind grow to the left of the line,
 * commits it's ahead to the right, on a scale shared by every branch.
 */
export function Divergence({ branch, main, scale, labels = false }: { branch: BranchActivity; main: string; scale: number; labels?: boolean }) {
  const width = (count: number) => (count > 0 ? `max(3px, ${(count / Math.max(1, scale)) * 100}%)` : "0");
  return (
    <span
      className={`team-diverge${labels ? " labelled" : ""}`}
      role="img"
      aria-label={`${plural(branch.behind, "commit")} behind ${main}, ${plural(branch.ahead, "commit")} ahead`}
      title={`${plural(branch.ahead, "commit")} that ${main} doesn't have; ${plural(branch.behind, "commit")} on ${main} that it doesn't have`}
    >
      {labels && <span className="team-diverge-label">{branch.behind > 0 ? `${branch.behind.toLocaleString()} behind` : "up to date"}</span>}
      <span className="team-diverge-side behind">
        <span style={{ width: width(branch.behind) }} />
      </span>
      <span className="team-diverge-mid" />
      <span className="team-diverge-side ahead">
        <span style={{ width: width(branch.ahead) }} />
      </span>
      {labels && <span className="team-diverge-label">{branch.ahead.toLocaleString()} ahead</span>}
    </span>
  );
}

/** "2 of your files", when the branch also changes files you're changing. */
export function Overlap({ files }: { files: string[] }) {
  if (files.length === 0) return null;
  return (
    <span className="team-overlap" title={`Also changes ${files.map(baseName).join(", ")}, which you're changing`}>
      {files.length === 1 ? "1 of your files" : `${files.length} of your files`}
    </span>
  );
}

export interface Tip {
  /** Show `content` above the element the event came from, or beside its middle (for a day on a graph). */
  show: (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, content: ReactNode, place?: "above" | "beside") => void;
  hide: () => void;
}

/** A tooltip inside `layer` (a positioned, scrolling element), over the mark hovered or focused. */
export function useTip() {
  const layer = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<{ x: number; y: number; side: string; content: ReactNode } | null>(null);
  const tip: Tip = {
    show: (event, content, place = "above") => {
      const area = layer.current;
      if (!area) return;
      const mark = event.currentTarget.getBoundingClientRect();
      const box = area.getBoundingClientRect();
      const x = mark.left + mark.width / 2 - box.left + area.scrollLeft;
      if (place === "beside") {
        // To the right of the day, or to its left near the right edge.
        const side = x > area.clientWidth - 240 ? "beside before" : "beside after";
        setShown({ x, y: mark.top + mark.height / 2 - box.top + area.scrollTop, side, content });
        return;
      }
      const side = x < 110 ? "left" : x > area.clientWidth - 110 ? "right" : "middle";
      setShown({ x, y: mark.top - box.top + area.scrollTop, side, content });
    },
    hide: () => setShown(null),
  };
  const view = shown && (
    <div className={`team-tip ${shown.side}`} style={{ left: shown.x, top: shown.y }} role="tooltip">
      {shown.content}
    </div>
  );
  return { layer, tip, view };
}

/** The tooltip for one day: everyone's commits that day, busiest first. */
export function DayTip({ label, entries }: { label: string; entries: { person: TeamPerson; color: string; count: number }[] }) {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <>
      <strong>
        {label} · {plural(total, "commit")}
      </strong>
      {entries
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((entry) => (
          <span key={entry.person.email} className="team-tip-row">
            <Swatch color={entry.color} />
            {entry.person.name}
            <span className="team-tip-value">{entry.count}</span>
          </span>
        ))}
    </>
  );
}
