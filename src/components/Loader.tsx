import { useId } from "react";
import { LOGO_COMMITS, LOGO_MAIN, LOGO_VIEWBOX, LOGO_WIDTH, LogoCommits, LogoDefs, logoBranch } from "./Icons";

const [[MERGE_X, MERGE_Y]] = LOGO_COMMITS;
/** The light's way up each line, past the merge and on out of the top, as history flows on. */
const BRANCH_FLOW = `${logoBranch()}V190`;
const MAIN_FLOW = "M380 890V190";

/**
 * Something loading: the logo, with light running up its branch and its main line into the
 * merge (which glows as they arrive) and on, and what's loading under it (or beside it,
 * `inline`, in small places like a preview). It fades in after a moment, so a quick load
 * doesn't flash. With reduced motion, the logo stays still.
 */
export function Loader({ title, detail, size = 120, inline = false }: { title: string; detail?: string; size?: number; inline?: boolean }) {
  const id = useId().replace(/:/g, "");
  const branch = `url(#${id}-branch)`;
  const ink = { stroke: "var(--logo-ink)" };
  return (
    <div className={`loader${inline ? " inline" : size <= 64 ? " small" : ""}`} role="status" aria-live="polite">
      <svg width={size} height={size} viewBox={LOGO_VIEWBOX} aria-hidden="true">
        <LogoDefs id={id} />
        <g mask={`url(#${id}-holes)`}>
          <g fill="none" strokeLinecap="round" strokeWidth={LOGO_WIDTH}>
            <path className="loader-lane" d={logoBranch()} stroke={branch} />
            <path className="loader-lane" d={LOGO_MAIN} style={ink} />
            <path className="loader-flow" pathLength={1} d={BRANCH_FLOW} stroke={branch} />
            <path className="loader-flow" pathLength={1} d={MAIN_FLOW} style={{ ...ink, animationDelay: "0.25s" }} />
          </g>
          <circle className="loader-glow" cx={MERGE_X} cy={MERGE_Y} r="150" />
          <LogoCommits merge="loader-merge" />
        </g>
      </svg>
      <div className="loader-text">
        <div className="loader-title">{title}</div>
        {detail && <div className="loader-detail">{detail}</div>}
      </div>
    </div>
  );
}
