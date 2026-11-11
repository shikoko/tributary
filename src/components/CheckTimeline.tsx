import type { RequestCheck } from "../api";
import { relativeTime } from "../lib/format";
import { checkKey, checkTime, checkTimeline, formatElapsed, groupChecks, startedLater, type CheckGroup } from "../lib/pullRequests";
import { ExternalLinkIcon } from "./Icons";

const WORDS = { success: "Passed", failure: "Failed", pending: "Running", cancelled: "Cancelled", skipped: "Skipped" } as const;

/** "5 minutes ago" with a capital, for the ends of the clock. */
const ago = (ms: number, now: number) => {
  const text = relativeTime(ms / 1000, now / 1000);
  return text[0].toUpperCase() + text.slice(1);
};

const isRunning = (check: RequestCheck) => check.state === "pending" && Boolean(check.startedAt) && !check.finishedAt;

/** Past this far along the clock, a run's "Started …" goes left of its line, so it fits. */
const LABEL_FLIPS_AT = 0.72;

/** A bar starting this close to the start of the clock (under a pixel) starts it: nothing dotted before it. */
const AT_THE_START = 0.002;

/**
 * A request's checks on one clock: each one a bar from when it started to when it ended,
 * a running one striped and growing until now, one waiting for a runner an empty track.
 * The time beside each says how long it took or has been running. They're in groups by
 * what they're part of (a GitHub workflow run, with what started it, or a GitLab stage),
 * in the order they started: a dotted line down each group marks when its run started,
 * and the time before a check started is dotted on its track. A bar is cut square where it
 * starts, flush against its run's line or the dots, except one that started the clock in a
 * list without lines, which is round at both ends. Beside its name, how much later than its
 * run a check started ("+15s"), when it waited for another job or a runner. Clicking a row
 * opens the check's page, as clicking its wave does. Without times from the
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
  /** The check in the spotlight (its wave above too, by its checkKey), and a way to change it. */
  lit?: string | null;
  onLight?: (key: string | null) => void;
}) {
  const groups = groupChecks(checks);
  const later = startedLater(groups);
  const ordered = groups.flatMap((group) => group.checks);
  const timeline = checkTimeline(ordered, now);
  const barOf = (check: RequestCheck) => timeline?.bars[ordered.indexOf(check)] ?? null;
  // Headings only when the checks say what they're part of.
  const headed = groups.some((group) => group.name !== null);
  const length = timeline ? Math.max(timeline.last - timeline.first, 1) : 1;

  const row = (groupName: string) => (check: RequestCheck, index: number) => {
    const state = check.state ?? "skipped";
    const queued = check.state === "pending" && !check.startedAt;
    const bar = barOf(check);
    const name = <span className="request-check-name">{check.name}</span>;
    return (
      <li
        key={`${check.name}-${index}`}
        className={`request-check request-timeline-row ${state}${checkKey(check) === lit ? " lit" : ""}${check.url ? " opens" : ""}`}
        onMouseEnter={() => onLight?.(checkKey(check))}
        onMouseLeave={() => onLight?.(null)}
        // Anywhere on the row opens its page, as its wave above does; its name is the button
        // for the keyboard (its click comes here).
        onClick={check.url ? () => openUrl(check.url!) : undefined}
        title={check.detail && check.detail !== "Queued" ? `${check.name}: ${check.detail}` : check.url ? `See ${check.name} on its page` : undefined}
      >
        <span className="request-check-dot" aria-hidden />
        {check.url ? (
          <button className="request-check-open">
            {name}
            <ExternalLinkIcon size={11} />
          </button>
        ) : (
          <span className="request-timeline-name" title={check.name}>
            {name}
          </span>
        )}
        {timeline && (
          <span className="request-timeline-later" title={later.has(check) ? `Started ${formatElapsed(later.get(check)!)} after the first of ${groupName}` : undefined}>
            {later.has(check) ? `+${formatElapsed(later.get(check)!)}` : null}
          </span>
        )}
        {timeline && (
          <span className={`request-timeline-track${bar ? " started" : ""}`} aria-hidden style={bar ? { ["--from" as string]: `${bar.from * 100}%` } : undefined}>
            {bar ? (
              <>
                {bar.from >= AT_THE_START && <span className="request-timeline-before" />}
                <span className={`request-timeline-bar ${state}${bar.from < AT_THE_START && !headed ? " first" : ""}`} style={{ left: `${bar.from * 100}%`, width: `${(bar.to - bar.from) * 100}%` }} />
              </>
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
  };

  const group = (each: CheckGroup) => {
    // When its run started and ended (or now), on the clock.
    const span = timeline ? checkTimeline(each.checks, now) : null;
    const start = span && timeline ? (span.first - timeline.first) / length : 0;
    const running = each.checks.some(isRunning);
    return (
      <li key={`${each.name}\u0000${each.trigger}`} className="request-timeline-group">
        {span && (
          <div className="request-timeline-guide" aria-hidden>
            <span>
              <span style={{ left: `${start * 100}%` }} />
            </span>
          </div>
        )}
        <div className="request-timeline-group-head">
          <span className="request-timeline-group-name">
            {each.name ?? "Other checks"}
            {each.trigger && <span className="request-timeline-group-trigger"> · {each.trigger}</span>}
          </span>
          {span && (
            <span className="request-timeline-group-start">
              <span className={`request-timeline-group-flag${start > LABEL_FLIPS_AT ? " flipped" : ""}`} style={{ left: `${start * 100}%` }}>
                Started {relativeTime(span.first / 1000, now / 1000)}
              </span>
            </span>
          )}
          {span && (
            <span className="request-timeline-group-total" title={running ? "Running for this long so far" : "From the first one starting to the last one finishing"}>
              {formatElapsed(span.last - span.first)}
            </span>
          )}
        </div>
        <ul className="request-timeline-list">{each.checks.map(row(`the ${each.name ?? "other checks"}`))}</ul>
      </li>
    );
  };

  return (
    <div className={`request-timeline${timeline ? "" : " untimed"}${headed ? " grouped" : ""}`}>
      <ul className="request-timeline-list">{headed ? groups.map(group) : ordered.map(row("these checks"))}</ul>
      {timeline && (
        <div className="request-timeline-axis" aria-hidden>
          <span>{ago(timeline.first, now)}</span>
          <span>{ordered.some(isRunning) ? "Now" : ago(timeline.last, now)}</span>
        </div>
      )}
    </div>
  );
}
