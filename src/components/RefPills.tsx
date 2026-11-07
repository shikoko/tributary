import { useMemo } from "react";
import type { RefLabel } from "../api";
import { withAlpha } from "../lib/colors";
import { pressLabel } from "../lib/drag";
import { describePill, refPills, type RefPill } from "../lib/refs";
import { CheckIcon, CloudIcon, CommitIcon, LaptopIcon, StashIcon, TagIcon } from "./Icons";

interface Props {
  refs: RefLabel[];
  /** The lane colour of the commit the refs point at. */
  color: string;
  /** Show at most this many pills, followed by a "+N" pill. */
  limit?: number;
  /** Double-click on a label: check it out. */
  onActivate?: (pill: RefPill) => void;
  onContextMenu?: (pill: RefPill, x: number, y: number) => void;
  /** Alt+click on a label: highlight its history. */
  onFocusPill?: (pill: RefPill) => void;
  /** Labels can be dragged onto commits (to merge or rebase). */
  draggable?: boolean;
}

/** The name git knows a label by, if it can be merged or rebased onto. */
export function revisionOf(pill: RefPill): string | null {
  return pill.kind === "branch" || pill.kind === "tag" ? pill.name : null;
}

export function RefPills({ refs, color, limit, onActivate, onContextMenu, onFocusPill, draggable }: Props) {
  const pills = useMemo(() => refPills(refs), [refs]);
  if (pills.length === 0) return null;
  const shown = limit ? pills.slice(0, limit) : pills;
  const hidden = pills.slice(shown.length);

  return (
    <span className="ref-pills">
      {shown.map((pill) => (
        <Pill
          key={pill.key}
          pill={pill}
          color={color}
          onActivate={onActivate}
          onContextMenu={onContextMenu}
          onFocusPill={onFocusPill}
          draggable={draggable}
        />
      ))}
      {hidden.length > 0 && (
        <span className="ref-pill more" title={hidden.map(describePill).join("\n")}>
          +{hidden.length}
        </span>
      )}
    </span>
  );
}

interface PillProps {
  pill: RefPill;
  color: string;
  onActivate?: (pill: RefPill) => void;
  onContextMenu?: (pill: RefPill, x: number, y: number) => void;
  onFocusPill?: (pill: RefPill) => void;
  draggable?: boolean;
}

function Pill({ pill, color, onActivate, onContextMenu, onFocusPill, draggable }: PillProps) {
  const revision = revisionOf(pill);
  const style = pill.current
    ? { background: color, borderColor: color, color: "#0d0f13" }
    : pill.kind === "tag" || pill.kind === "stash"
      ? { background: withAlpha(color, 0.08), borderColor: withAlpha(color, 0.45) }
      : { background: withAlpha(color, 0.2), borderColor: withAlpha(color, 0.65) };

  return (
    <span
      className={`ref-pill ${pill.kind}${pill.current ? " current" : ""}`}
      style={style}
      title={describePill(pill) + (onActivate && pill.kind === "branch" && !pill.current ? " — double-click to check out" : "")}
      onDoubleClick={(event) => {
        if (!onActivate) return;
        event.stopPropagation();
        onActivate(pill);
      }}
      onClick={(event) => {
        if (!event.altKey || !onFocusPill) return;
        event.stopPropagation();
        onFocusPill(pill);
      }}
      onPointerDown={(event) => {
        if (draggable && revision && !event.altKey) pressLabel(event, revision);
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(pill, event.clientX, event.clientY);
      }}
    >
      {pill.current && <CheckIcon size={12} strokeWidth={2.2} />}
      {pill.kind === "tag" && <TagIcon size={12} />}
      {pill.kind === "head" && <CommitIcon size={12} />}
      {pill.kind === "stash" && <StashIcon size={12} />}
      <span className="ref-name">{pill.name}</span>
      {pill.kind === "branch" && (
        <span className="ref-where">
          {pill.local && <LaptopIcon size={12} />}
          {pill.remotes.length > 0 && <CloudIcon size={12} />}
        </span>
      )}
    </span>
  );
}
