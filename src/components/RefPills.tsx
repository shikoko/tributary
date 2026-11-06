import { useMemo } from "react";
import type { RefLabel } from "../api";
import { withAlpha } from "../lib/colors";
import { describePill, refPills, type RefPill } from "../lib/refs";
import { CheckIcon, CloudIcon, CommitIcon, LaptopIcon, StashIcon, TagIcon } from "./Icons";

interface Props {
  refs: RefLabel[];
  /** The lane colour of the commit the refs point at. */
  color: string;
  /** Show at most this many pills, followed by a "+N" pill. */
  limit?: number;
}

export function RefPills({ refs, color, limit }: Props) {
  const pills = useMemo(() => refPills(refs), [refs]);
  if (pills.length === 0) return null;
  const shown = limit ? pills.slice(0, limit) : pills;
  const hidden = pills.slice(shown.length);

  return (
    <span className="ref-pills">
      {shown.map((pill) => (
        <Pill key={pill.key} pill={pill} color={color} />
      ))}
      {hidden.length > 0 && (
        <span className="ref-pill more" title={hidden.map(describePill).join("\n")}>
          +{hidden.length}
        </span>
      )}
    </span>
  );
}

function Pill({ pill, color }: { pill: RefPill; color: string }) {
  const style = pill.current
    ? { background: color, borderColor: color, color: "#0d0f13" }
    : pill.kind === "tag" || pill.kind === "stash"
      ? { background: withAlpha(color, 0.08), borderColor: withAlpha(color, 0.45) }
      : { background: withAlpha(color, 0.2), borderColor: withAlpha(color, 0.65) };

  return (
    <span className={`ref-pill ${pill.kind}${pill.current ? " current" : ""}`} style={style} title={describePill(pill)}>
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
