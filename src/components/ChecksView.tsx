import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { commitRuns, rerunFailedChecks, type CommitRuns, type Job, type JobGroup, type Run } from "../api";
import { shortId } from "../lib/format";
import { checkName, checkTime } from "../lib/pullRequests";
import { anyGoing, countStates, elapsed, groupState, jobState, jobTime, memberName, runColumns, runState, STATE_WORDS, stepProgress, type RunState } from "../lib/runGraph";
import { useNow } from "../lib/useNow";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ExternalLinkIcon, RefreshIcon } from "./Icons";
import { Loader } from "./Loader";
import { RunStateIcon as StateIcon } from "./RunStateIcon";
import { Button } from "./ui/Button";

/** The commit whose checks are shown: a row of the list, or a pull request's latest commit. */
export interface ChecksOf {
  id: string;
  summary: string;
}

interface Props {
  repoPath: string;
  commit: ChecksOf;
  onClose: () => void;
  openUrl: (url: string) => void;
  /** Says how asking for a re-run went. */
  notify: (text: string) => void;
}

/** Asked again this often while something runs, signed in (an unchanged answer costs nothing then). */
const AGAIN = 15_000;

/**
 * A commit's CI as graphs, as GitHub draws a workflow run: for each run, its jobs in columns
 * by which waits for which, a matrix job's jobs in one box, how far through its steps each
 * running job is, and the jobs still waiting. It's asked again while something runs.
 */
export function ChecksView({ repoPath, commit, onClose, openUrl, notify }: Props) {
  const [runs, setRuns] = useState<CommitRuns | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const asked = useRef(0);

  const load = useCallback(() => {
    const ask = ++asked.current;
    setLoading(true);
    commitRuns(repoPath, commit.id)
      .then((found) => {
        if (ask !== asked.current) return;
        setRuns(found);
        setError(null);
      })
      .catch((e) => ask === asked.current && setError(String(e)))
      .finally(() => ask === asked.current && setLoading(false));
  }, [repoPath, commit.id]);

  useEffect(() => {
    setRuns(null);
    setError(null);
    load();
  }, [load]);

  // While something runs, asked again (signed in: without, the site allows few requests).
  const going = runs ? anyGoing(runs) : false;
  useEffect(() => {
    if (!going || !runs?.signedIn) return;
    const timer = window.setTimeout(load, AGAIN);
    return () => window.clearTimeout(timer);
  }, [going, runs, load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector('[role="menu"], [role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const now = useNow(1000, going);
  const [rerunning, setRerunning] = useState(false);
  const rerun = () => {
    setRerunning(true);
    rerunFailedChecks(repoPath, commit.id)
      .then((said) => {
        notify(said);
        load();
      })
      .catch((e) => notify(String(e)))
      .finally(() => setRerunning(false));
  };
  const site = runs?.site ?? "GitHub";
  const empty = runs !== null && runs.runs.length === 0 && runs.others.length === 0;

  return (
    <section className="diff-view request-view checks-view" aria-label={`Checks of ${commit.summary}`}>
      <header className="diff-header">
        <div className="diff-title" title={commit.summary}>
          <span className="request-number checks-view-id">{shortId(commit.id)}</span>
          <span className="request-title">{commit.summary}</span>
        </div>
        <Button kind="icon" onClick={load} disabled={loading} title="Refresh" aria-label="Refresh the checks">
          <RefreshIcon size={14} />
        </Button>
        {runs?.canRerun && countStates(runs).some(([state]) => state === "failure") && (
          <Button kind="outline" disabled={rerunning} onClick={rerun} title="Run the failed jobs again">
            <RefreshIcon size={13} />
            <span className="button-label">{rerunning ? "Asking…" : "Re-run failed"}</span>
          </Button>
        )}
        {runs?.url && (
          <Button kind="outline" onClick={() => openUrl(runs.url!)} title={`Open its checks on ${site}`} data-url={runs.url}>
            <ExternalLinkIcon size={13} />
            <span className="button-label">Open on {site}</span>
          </Button>
        )}
        <Button kind="icon" onClick={onClose} title="Close (Esc)" aria-label="Close the checks">
          <CloseIcon />
        </Button>
      </header>
      <div className="diff-body request-body-scroll">
        {error && !runs ? (
          <div className="diff-message">
            <strong>Couldn't get the checks</strong>
            <span>{error}</span>
          </div>
        ) : !runs ? (
          <Loader size={88} title="Getting the checks" />
        ) : empty ? (
          <div className="diff-message">
            <strong>No checks</strong>
            <span>{site} has no checks for this commit.</span>
          </div>
        ) : (
          <div className="checks-view-content">
            <Summary runs={runs} now={now} />
            {runs.runs.map((run, index) => (
              <RunCard key={`${run.name}-${index}`} run={run} now={now} openUrl={openUrl} />
            ))}
            {runs.others.length > 0 && (
              <section className="run-card">
                <header className="run-head">
                  <h3>Other checks</h3>
                </header>
                <div className="run-others">
                  {runs.others.map((check, index) => {
                    const state: RunState = check.state === "pending" ? (check.startedAt ? "running" : "queued") : check.state === null ? "skipped" : check.state;
                    return (
                      <JobCard
                        key={`${check.name}-${index}`}
                        name={checkName(check.name)}
                        state={state}
                        time={checkTime(check, now)}
                        detail={check.detail}
                        url={check.url}
                        openUrl={openUrl}
                      />
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** How many jobs are in each state, in words and as a bar, and how long the commit's CI has taken. */
function Summary({ runs, now }: { runs: CommitRuns; now: number }) {
  const counts = countStates(runs);
  const starts = runs.runs.map((run) => run.startedAt).filter((at): at is string => Boolean(at));
  const first = starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : null;
  const going = anyGoing(runs);
  const ends = runs.runs.map((run) => run.finishedAt).filter((at): at is string => Boolean(at));
  const last = !going && ends.length > 0 ? ends.reduce((a, b) => (a > b ? a : b)) : null;
  const time = elapsed(first, last, now);
  return (
    <div className="checks-summary">
      <div className="checks-summary-line">
        {counts.map(([state, count]) => (
          <span key={state} className={`checks-count ${state}`}>
            <strong>{count}</strong> {STATE_WORDS[state]}
          </span>
        ))}
        {time && (
          <span className="checks-summary-time">
            {time}
            {going ? " so far" : ""}
          </span>
        )}
      </div>
      <div className="checks-summary-bar" aria-hidden>
        {counts.map(([state, count]) => (
          <span key={state} className={state} style={{ flexGrow: count }} />
        ))}
      </div>
    </div>
  );
}

/** A run: its name, what started it and how long it took, and its jobs as a graph. */
function RunCard({ run, now, openUrl }: { run: Run; now: number; openUrl: (url: string) => void }) {
  const state = runState(run.state);
  const time = elapsed(run.startedAt, run.finishedAt, now);
  return (
    <section className={`run-card ${state}`} aria-label={run.name}>
      <header className="run-head">
        <StateIcon state={state} />
        <h3>{run.name}</h3>
        {run.trigger && <span className="run-trigger">{run.trigger}</span>}
        {time && (
          <span className="run-time">
            {time}
            {state === "running" ? " so far" : ""}
          </span>
        )}
        {run.url && (
          <Button kind="icon" onClick={() => openUrl(run.url!)} title="Open this run" aria-label={`Open the ${run.name} run`} data-url={run.url}>
            <ExternalLinkIcon size={13} />
          </Button>
        )}
      </header>
      <RunGraph run={run} now={now} openUrl={openUrl} />
    </section>
  );
}

/** A line from a group to a group that waits for it, and how the first one went. */
interface Edge {
  d: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  state: RunState;
}

/**
 * The run's groups in columns, with a line from each to each group that waits for it. The
 * lines are drawn once the boxes are laid out (and again when they move), from the right of
 * one box to the left of the next.
 */
function RunGraph({ run, now, openUrl }: { run: Run; now: number; openUrl: (url: string) => void }) {
  const columns = runColumns(run);
  const area = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Whether there's more of the graph to scroll to on each side: that side fades out.
  const [more, setMore] = useState({ left: false, right: false });
  const measureMore = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const left = element.scrollLeft > 1;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setMore((was) => (was.left === left && was.right === right ? was : { left, right }));
  }, []);

  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const draw = () => {
      const origin = element.getBoundingClientRect();
      const boxOf = (key: string) => element.querySelector<HTMLElement>(`[data-group="${CSS.escape(key)}"]`)?.getBoundingClientRect();
      const found: Edge[] = [];
      for (const group of run.groups) {
        const to = boxOf(group.key);
        if (!to) continue;
        for (const key of group.needs) {
          const from = boxOf(key);
          const need = run.groups.find((other) => other.key === key);
          if (!from || !need) continue;
          const a = { x: from.right - origin.left, y: from.top + from.height / 2 - origin.top };
          const b = { x: to.left - origin.left, y: to.top + to.height / 2 - origin.top };
          const bend = Math.max(16, (b.x - a.x) / 2);
          found.push({ d: `M${a.x} ${a.y} C${a.x + bend} ${a.y} ${b.x - bend} ${b.y} ${b.x} ${b.y}`, from: a, to: b, state: groupState(need, run) });
        }
      }
      setEdges(found);
      setSize({ width: element.scrollWidth, height: element.scrollHeight });
      measureMore();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    if (scroller.current) observer.observe(scroller.current);
    element.querySelectorAll("[data-group]").forEach((box) => observer.observe(box));
    return () => observer.disconnect();
  }, [run, measureMore]);

  const scroll = (direction: -1 | 1) => {
    const element = scroller.current;
    if (!element) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * Math.max(240, element.clientWidth * 0.6), behavior: still ? "auto" : "smooth" });
  };

  return (
    <div className="run-graph-frame">
      {more.left && (
        <button className="run-graph-more left" onClick={() => scroll(-1)} title="Scroll to the jobs before" aria-label="Scroll to the jobs before">
          <ChevronLeftIcon size={14} />
        </button>
      )}
      {more.right && (
        <button className="run-graph-more right" onClick={() => scroll(1)} title="Scroll to the jobs after" aria-label="Scroll to the jobs after">
          <ChevronRightIcon size={14} />
        </button>
      )}
      <div className={`run-graph-scroll${more.left ? " more-left" : ""}${more.right ? " more-right" : ""}`} ref={scroller} onScroll={measureMore}>
        <div className="run-graph" ref={area}>
          <svg className="run-edges" width={size.width} height={size.height} aria-hidden>
            {edges.map((edge, index) => (
              <g key={index} className={`run-edge ${edge.state}`}>
                <path d={edge.d} />
                <circle cx={edge.from.x} cy={edge.from.y} r={3} />
                <circle cx={edge.to.x} cy={edge.to.y} r={3} />
              </g>
            ))}
          </svg>
          {columns.map((column, index) => (
            <div key={index} className="run-column">
              {column.map((group) =>
                group.jobs.length > 1 ? (
                  <GroupBox key={group.key} group={group} run={run} now={now} openUrl={openUrl} />
                ) : (
                  <div key={group.key} data-group={group.key} className="run-node">
                    {group.jobs.length === 1 ? (
                      <JobCard name={group.jobs[0].name} state={jobState(group.jobs[0])} job={group.jobs[0]} time={jobTime(group.jobs[0], now)} url={group.jobs[0].url} openUrl={openUrl} />
                    ) : (
                      <JobCard name={group.name} state={groupState(group, run)} time={null} openUrl={openUrl} />
                    )}
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A matrix job's jobs (or a GitLab stage's) in one box, under its name and how many there are. */
function GroupBox({ group, run, now, openUrl }: { group: JobGroup; run: Run; now: number; openUrl: (url: string) => void }) {
  return (
    <div className={`run-group ${groupState(group, run)}`} data-group={group.key}>
      <div className="run-group-head">
        <span className="run-group-name">{group.name}</span>
        <span className="run-group-count">{group.jobs.length} jobs</span>
      </div>
      <div className="run-group-jobs">
        {group.jobs.map((job, index) => (
          <JobRow key={`${job.name}-${index}`} name={memberName(group, job)} job={job} now={now} openUrl={openUrl} />
        ))}
      </div>
    </div>
  );
}

/** A job in a group's box: how it went, its name and time, and its steps while it runs. */
function JobRow({ name, job, now, openUrl }: { name: string; job: Job; now: number; openUrl: (url: string) => void }) {
  const state = jobState(job);
  const time = jobTime(job, now);
  return (
    <button className={`run-job ${state}`} onClick={() => job.url && openUrl(job.url)} disabled={!job.url} title={job.url ? `${job.name}: open its page` : job.name} data-url={job.url ?? undefined}>
      <span className="run-job-line">
        <StateIcon state={state} />
        <span className="run-job-name">{name}</span>
        <span className="run-job-time">{time ?? (state === "skipped" ? "skipped" : state === "queued" ? "queued" : "")}</span>
      </span>
      {state === "running" && <Steps job={job} />}
    </button>
  );
}

/** A job (or a group of none yet) on its own: a card. */
function JobCard({
  name,
  state,
  time,
  job,
  detail,
  url,
  openUrl,
}: {
  name: string;
  state: RunState;
  time: string | null;
  job?: Job;
  detail?: string | null;
  url?: string | null;
  openUrl: (url: string) => void;
}) {
  const said = time ?? (state === "waiting" ? "waiting" : state === "skipped" ? "skipped" : state === "queued" ? "queued" : "");
  return (
    <button className={`run-card-job ${state}`} onClick={() => url && openUrl(url)} disabled={!url} title={url ? `${name}: open its page` : name} data-url={url ?? undefined}>
      <span className="run-job-line">
        <StateIcon state={state} />
        <span className="run-job-name">{name}</span>
        <span className="run-job-time">{said}</span>
      </span>
      {detail && <span className="run-job-detail">{detail}</span>}
      {job && state === "running" && <Steps job={job} />}
    </button>
  );
}

/** A running job's steps: the one it's on, and a mark for each, filled once done. */
function Steps({ job }: { job: Job }) {
  const progress = stepProgress(job);
  if (progress === null) return null;
  const shown = Math.min(job.steps, 40);
  const done = Math.round(progress * shown);
  return (
    <span className="run-steps" title={`Step ${Math.min(job.stepsDone + 1, job.steps)} of ${job.steps}${job.step ? `: ${job.step}` : ""}`}>
      {job.step && <span className="run-step-name">{job.step}</span>}
      <span className="run-step-marks" style={{ gridTemplateColumns: `repeat(${shown}, 1fr)` }}>
        {Array.from({ length: shown }, (_, index) => (
          <i key={index} className={index < done ? "done" : index === done ? "now" : undefined} />
        ))}
      </span>
    </span>
  );
}
