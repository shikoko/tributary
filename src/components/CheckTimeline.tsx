import type { RequestCheck } from "../api";
import { relativeTime } from "../lib/format";
import { checkTime, checkTimeline } from "../lib/pullRequests";
import { ExternalLinkIcon } from "./Icons";

const WORDS = { success: "Passed", failure: "Failed", pending: "Running", cancelled: "Cancelled", skipped: "Skipped" } as const;

/** "5 minutes ago" with a capital, for the ends of the clock. */
const ago = (ms: number, now: number) => {
  const text = relativeTime(ms / 1000, now / 1000);
  return text[0].toUpperCase() + text.slice(1);
};

/**
 * A request's checks on one clock: each one a bar from when it started to when it ended,
 * a running one striped and growing until now, one waiting for a runner an empty track.
 * The time beside each says how long it took or has been running. Without times from the
 * site, just the names and how they went.
 */
export function CheckTimeline({
  checks,
  now,
  openUrl,
  lit = null,
  onLight,
}: {
  checks: RequestCheck[];
  now: number;
  openUrl: (url: string) => void;
  /** The check in the spotlight (its wave above too), and a way to change it. */
  lit?: string | null;
  onLight?: (name: string | null) => void;
}) {
  const timeline = checkTimeline(checks, now);
  const running = checks.some((check) => check.state === "pending" && check.startedAt && !check.finishedAt);
  return (
    <div className={`request-timeline${timeline ? "" : " untimed"}`}>
      <ul className="request-timeline-list">
        {checks.map((check, index) => {
          const state = check.state ?? "skipped";
          const queued = check.state === "pending" && !check.startedAt;
          const bar = timeline?.bars[index];
          const name = <span className="request-check-name">{check.name}</span>;
          return (
            <li
              key={`${check.name}-${index}`}
              className={`request-check request-timeline-row ${state}${check.name === lit ? " lit" : ""}`}
              onMouseEnter={() => onLight?.(check.name)}
              onMouseLeave={() => onLight?.(null)}
              title={check.detail && check.detail !== "Queued" ? `${check.name}: ${check.detail}` : undefined}
            >
              <span className="request-check-dot" aria-hidden />
              {check.url ? (
                <button className="request-check-open" onClick={() => openUrl(check.url!)} title={`See ${check.name} on its page`}>
                  {name}
                  <ExternalLinkIcon size={11} />
                </button>
              ) : (
                <span className="request-timeline-name" title={check.name}>
                  {name}
                </span>
              )}
              {timeline && (
                <span className="request-timeline-track" aria-hidden>
                  {bar ? (
                    <span className={`request-timeline-bar ${state}`} style={{ left: `${bar.from * 100}%`, width: `${(bar.to - bar.from) * 100}%` }} />
                  ) : state !== "skipped" ? (
                    <span className="request-timeline-waiting" />
                  ) : null}
                </span>
              )}
              <span className="request-timeline-time" title={queued ? "Waiting for a runner" : undefined}>
                {queued ? "Queued" : state === "cancelled" ? "Cancelled" : (checkTime(check, now) ?? WORDS[state])}
              </span>
              {state === "failure" && check.detail && <span className="request-timeline-detail">{check.detail}</span>}
            </li>
          );
        })}
      </ul>
      {timeline && (
        <div className="request-timeline-axis" aria-hidden>
          <span>{ago(timeline.first, now)}</span>
          <span>{running ? "Now" : ago(timeline.last, now)}</span>
        </div>
      )}
    </div>
  );
}
