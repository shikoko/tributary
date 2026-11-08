import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PullRequest } from "../api";
import { describeChecks, PullRequestsContext, requestNumber } from "../lib/pullRequests";
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
  const pullRequests = useContext(PullRequestsContext);
  const pr = pill.kind === "branch" ? pullRequests?.find(pill.name, pill.local, pill.remotes) : undefined;
  const style: React.CSSProperties = pill.current
    ? // --pill-glow: the glow it gets in the commit list.
      ({ background: color, borderColor: color, color: "#0d0f13", "--pill-glow": withAlpha(color, 0.5) } as React.CSSProperties)
    : pill.kind === "tag" || pill.kind === "stash"
      ? { background: withAlpha(color, 0.08), borderColor: withAlpha(color, 0.45) }
      : // Branches other than the checked-out one: a tint, no outline.
        { background: withAlpha(color, 0.22), borderColor: "transparent" };

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
      <RefName name={pill.name} />
      {pill.kind === "branch" && (
        <span className="ref-where">
          {pill.local && <LaptopIcon size={12} />}
          {pill.remotes.length > 0 && <CloudIcon size={12} />}
        </span>
      )}
      {pr && <PullRequestBadge pr={pr} onOpen={pullRequests!.open} />}
    </span>
  );
}

/** "#12" (or "!12" for a GitLab merge request) with a dot for its checks; click to open it. */
export function PullRequestBadge({ pr, onOpen }: { pr: PullRequest; onOpen: (url: string) => void }) {
  return (
    <span
      className={`pr-badge${pr.checks ? ` ${pr.checks}` : ""}${pr.draft ? " draft" : ""}`}
      title={`${describeChecks(pr)}\nClick to open it`}
      role="link"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(pr.url);
      }}
    >
      {pr.checks && <span className="pr-dot" />}
      {requestNumber(pr)}
    </span>
  );
}

/**
 * A label's name. When there isn't room for all of it, the folders go first: the end of the
 * name is what tells branches apart, so "feat/barbershop-appointments" shows as
 * "…/barbershop-appointments" (and only then loses its end), not "feat/barb…".
 */
function RefName({ name }: { name: string }) {
  const slash = name.lastIndexOf("/");
  const element = useRef<HTMLSpanElement>(null);
  const [short, setShort] = useState(false);
  const [measured, setMeasured] = useState(0);
  // Shown in full, does it fit? Checked before the label is painted.
  useLayoutEffect(() => {
    const span = element.current;
    if (span && !short && span.scrollWidth > span.clientWidth + 1) setShort(true);
  }, [short, measured, name]);
  // When the space around the label changes (a column or panel is resized), try the whole
  // name again.
  useEffect(() => {
    const area = element.current?.closest(".refs-cell, .details-refs, .preview-refs");
    if (!area) return;
    let width = area.clientWidth;
    const observer = new ResizeObserver(() => {
      if (area.clientWidth === width) return;
      width = area.clientWidth;
      setShort(false);
      setMeasured((count) => count + 1);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  if (slash <= 0 || slash === name.length - 1) return <span className="ref-name">{name}</span>;
  return (
    <span ref={element} className="ref-name">
      {short ? (
        <>
          <span className="ref-name-folder">…/</span>
          {name.slice(slash + 1)}
        </>
      ) : (
        name
      )}
    </span>
  );
}
