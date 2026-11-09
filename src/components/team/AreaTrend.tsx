// A value per day as a smooth line, washed in its colour fading down to nothing, the latest
// day marked. Hovering a day marks it and shows what `describe` says about it.
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { smoothPath } from "../../lib/team";
import type { Tip } from "./parts";

export function AreaTrend({
  values,
  ghost,
  top,
  color,
  height,
  label,
  tip,
  describe,
  flipped = false,
}: {
  values: number[];
  /** Values to compare with (the period before), drawn as a faint line behind. */
  ghost?: number[];
  /** The value at the top of the chart (shared by charts that are compared). */
  top: number;
  /** A CSS colour (like var(--accent)). */
  color: string;
  height: number;
  /** What the chart shows, for screen readers. */
  label: string;
  tip: Tip;
  describe: (index: number) => ReactNode;
  /** Grow downwards from the top (for what was removed, under what was added). */
  flipped?: boolean;
}) {
  // An id fit for url(#…), whatever characters React's ids use.
  const gradient = `team-area-${useId().replace(/[^\w-]/g, "")}`;
  const [hover, setHover] = useState<number | null>(null);
  const last = values.length - 1;
  const span = Math.max(1, last);
  // Some room above the busiest day, so its peak and dot aren't cut off.
  const y = (value: number) => 100 - (value / Math.max(1, top)) * 88;
  const line = smoothPath(values.map((value, index) => [index, y(value)]));
  const x = (index: number) => `${(index / span) * 100}%`;
  const marked = hover ?? last;

  return (
    <div className={`team-area${flipped ? " flipped" : ""}`} style={{ height, "--area": color } as CSSProperties} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${span} 100`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: color, stopOpacity: 0.42 }} />
            <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path d={`${line} L${span},100 L0,100 Z`} fill={`url(#${gradient})`} />
        {ghost && ghost.length === values.length && (
          <path d={smoothPath(ghost.map((value, index) => [index, y(value)]))} className="team-area-ghost" vectorEffect="non-scaling-stroke" />
        )}
        <path d={line} className="team-area-line" vectorEffect="non-scaling-stroke" />
      </svg>
      {hover !== null && <span className="team-area-cross" style={{ left: x(hover) }} />}
      {values.length > 0 && <span className="team-area-dot" style={{ left: x(marked), top: `${y(values[marked])}%` }} />}
      <div
        className="team-area-hits"
        onMouseLeave={() => {
          setHover(null);
          tip.hide();
        }}
      >
        {values.map((_, index) => (
          <span
            key={index}
            style={{ left: `${((index - 0.5) / span) * 100}%`, width: `${100 / span}%` }}
            onMouseEnter={(event) => {
              setHover(index);
              tip.show(event, describe(index), "beside");
            }}
          />
        ))}
      </div>
    </div>
  );
}
