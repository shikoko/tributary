import type { RequestCheck } from "../api";
import { relativeTime } from "../lib/format";
import { checkKey, checkName, checkTime, checkTimeline, formatElapsed, formatSpan, groupChecks, startedLater, type CheckGroup } from "../lib/pullRequests";
import { ExternalLinkIcon } from "./Icons";
import { SlidingText } from "./SlidingText";

const WORDS = { success: "Passed", failure: "Failed", pending: "Running", cancelled: "Cancelled", skipped: "Skipped" } as const;

/** "Finished 5 minutes ago", for the ends of the clock. */
const ago = (what: string, ms: number, now: number) => `${what} ${relativeTime(ms / 1000, now / 1000)}`;

const isRunning = (check: RequestCheck) => check.state === "pending" && Boolean(check.startedAt) && !check.finishedAt;

/** A bar starting this close to the start of the clock (under a pixel) starts it: nothing dotted before it. */
const AT_THE_START = 0.002;


/**
 * A request's checks on one clock: each one a bar from when it started to when it ended,
 * a running one striped and growing until now, one waiting for a runner an empty track.
 * The time beside each says how long it took or has been running. They're in groups by
 * what they're part of (a GitHub workflow run, with what started it, or a GitLab stage),
 * in the order they started. Everything counts from one start, when the first check of all
 * started: a dotted line down through every run, headed by "Started 11 minutes ago". A
 * check that started later (waiting for another job, for a runner, or in a run that started
 * later) says how much later beside its name ("+49s"), and the time before it is dotted on
 * its track. A bar is cut square where it starts, flush against the line or the dots,
 * except one that started the clock in a list without the line, which is round at both
 * ends. Clicking a row
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

  const row = (check: RequestCheck, index: number) => {
    const state = check.state ?? "skipped";
    const queued = check.state === "pending" && !check.startedAt;
    const bar = barOf(check);
    const name = <SlidingText className="request-check-name" text={checkName(check.name)} />;
    return (
      <li
        key={`${check.name}-${index}`}
        className={`request-check request-timeline-row ${state}${checkKey(check) === lit ? " lit" : ""}${check.url ? " opens" : ""}`}
        onMouseEnter={() => onLight?.(checkKey(check))}
        onMouseLeave={() => onLight?.(null)}
        // Anywhere on the row opens its page, as its wave above does; its name is the button
        // for the keyboard (its click comes here).
        onClick={check.url ? () => openUrl(check.url!) : undefined}
        data-url={check.url ?? undefined}
        title={check.detail && check.detail !== "Queued" ? `${checkName(check.name)}: ${check.detail}` : check.url ? `See ${checkName(check.name)} on its page` : undefined}
      >
        <span className="request-check-dot" aria-hidden />
        {check.url ? (
          <button className="request-check-open">
            {name}
            <ExternalLinkIcon size={11} />
          </button>
        ) : (
          <span className="request-timeline-name" title={checkName(check.name)}>
            {name}
          </span>
        )}
        {timeline && (
          <span className="request-timeline-later" title={later.has(check) ? `Started ${formatElapsed(later.get(check)!)} after the first check` : undefined}>
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

  const group = (each: CheckGroup, index: number) => {
    // When its run started and ended (or now), on the clock.
    const span = timeline ? checkTimeline(each.checks, now) : null;
    const running = each.checks.some(isRunning);
    return (
      <li key={`${each.name}\u0000${each.trigger}`} className="request-timeline-group">
        <div className="request-timeline-group-head">
          <span className="request-timeline-group-name">
            {each.name ?? "Other checks"}
            {each.trigger && <span className="request-timeline-group-trigger"> · {each.trigger}</span>}
          </span>
          {/* The one start, at the top of its line. */}
          {index === 0 && timeline && (
            <span className="request-timeline-group-start">
              <span className="request-timeline-group-flag" style={{ left: 0 }}>
                Started {relativeTime(timeline.first / 1000, now / 1000)}
              </span>
            </span>
          )}
          {span && (
            <span className="request-timeline-group-total" title={running ? "Running for this long so far" : "From the first one starting to the last one finishing"}>
              {formatElapsed(span.last - span.first)}
            </span>
          )}
        </div>
        <ul className="request-timeline-list">{each.checks.map(row)}</ul>
      </li>
    );
  };

  return (
    <div className={`request-timeline${timeline ? "" : " untimed"}${headed ? " grouped" : ""}`}>
      {/* When the first check started: a dotted line down through every run, which the
          bars start from (flush, or after the dotted wait). */}
      {timeline && headed && (
        <div className="request-timeline-origin" aria-hidden>
          <span>
            <span />
          </span>
        </div>
      )}
      <ul className="request-timeline-list">{headed ? groups.map((each, index) => group(each, index)) : ordered.map(row)}</ul>
      {timeline && (
        <div className="request-timeline-axis" aria-hidden>
          <span>{headed ? null : ago("Started", timeline.first, now)}</span>
          {/* While they run, how long the clock is (it grows now and then, in round steps); then
              when the last one finished. */}
          <span>{timeline.running ? `+${formatSpan(timeline.length)}` : ago("Finished", timeline.last, now)}</span>
        </div>
      )}
    </div>
  );
}
