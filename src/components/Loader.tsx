import { LOGO_LANE_ORDER, LOGO_LANES, LOGO_RIVER, logoLane } from "./Icons";

/** When each branch's light sets off, in seconds: the middle first, then outwards. */
const DELAYS = [0, 0.3, 0.15, 0.45, 0.6];

/**
 * Something loading: the logo, with light running down its five branches into the commit
 * (which glows as each arrives), and what's loading under it (or beside it, `inline`, in
 * small places like a preview). It fades in after a moment, so a quick load doesn't flash.
 * With reduced motion, the logo stays still.
 */
export function Loader({ title, detail, size = 120, inline = false }: { title: string; detail?: string; size?: number; inline?: boolean }) {
  return (
    <div className={`loader${inline ? " inline" : size <= 64 ? " small" : ""}`} role="status" aria-live="polite">
      <svg width={size} height={size} viewBox="150 150 724 724" aria-hidden="true">
        <path d={LOGO_RIVER} style={{ fill: "var(--logo-ink)" }} />
        <g fill="none" strokeLinecap="round" strokeWidth={86}>
          {LOGO_LANE_ORDER.map((i) => (
            <path key={i} className="loader-lane" d={logoLane(LOGO_LANES[i][0])} stroke={LOGO_LANES[i][1]} />
          ))}
          {LOGO_LANE_ORDER.map((i) => (
            <path
              key={`flow-${i}`}
              className="loader-flow"
              pathLength={1}
              d={logoLane(LOGO_LANES[i][0])}
              stroke={LOGO_LANES[i][1]}
              style={{ animationDelay: `${DELAYS[i]}s` }}
            />
          ))}
        </g>
        <circle className="loader-glow" cx="512" cy="690" r="120" />
        <circle cx="512" cy="690" r="92" style={{ fill: "var(--logo-ink)" }} />
        <circle className="loader-dot" cx="512" cy="690" r="36" style={{ fill: "var(--logo-dot)" }} />
      </svg>
      <div className="loader-text">
        <div className="loader-title">{title}</div>
        {detail && <div className="loader-detail">{detail}</div>}
      </div>
    </div>
  );
}
