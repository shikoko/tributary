import { useContext, useEffect, useState } from "react";
import { commitChecks, rerunFailedChecks, type CommitChecks as Checks, type RequestCheck } from "../api";
import { CiStatesContext } from "../lib/ciStates";
import { anyRunning, checkName, checkTime } from "../lib/pullRequests";
import { useNow } from "../lib/useNow";
import { openInBrowser } from "../lib/weblinks";
import { checksHeadline, checksVerdict } from "../lib/checkSummary";
import { SectionButton, SiteChip } from "./DetailsSite";
import { SlidingText } from "./SlidingText";
import { ExternalLinkIcon, WorkflowIcon } from "./Icons";
import { RunStateIcon } from "./RunStateIcon";
import { Button } from "./ui/Button";

export type State = "failure" | "pending" | "success" | "cancelled" | "skipped";
export const stateOf = (check: RequestCheck): State => check.state ?? "skipped";
/** Failed ones first, then running, then the rest. */
const ORDER: Record<State, number> = { failure: 0, pending: 1, success: 2, cancelled: 3, skipped: 4 };
export const WORDS: Record<State, string> = { failure: "failed", pending: "running", success: "passed", cancelled: "cancelled", skipped: "skipped" };
/** How many failed or running ones are listed before "Show all". */
export const FIRST = 4;

/** A commit's checks, as its details show them: sorted, counted, and run again when asked. */
export interface CommitChecksShown {
  /** The commit's id. */
  id: string;
  checks: Checks;
  /** Failed first, then running, then the rest. */
  sorted: RequestCheck[];
  counts: Map<State, number>;
  failed: number;
  /** The ones that need a look: failed and running. */
  notable: RequestCheck[];
  now: number;
  busy: boolean;
  rerun: () => void;
}

/**
 * A commit's CI (GitHub checks, or its latest GitLab pipeline's jobs), for commits the list
 * knows a state for; null for others, and until the site has answered.
 */
export function useCommitChecks(repoPath: string, id: string, notify: ((text: string) => void) | undefined): CommitChecksShown | null {
  const state = useContext(CiStatesContext).get(id);
  // Only where they're shown: in a commit's details, which say how re-running went.
  const shown = Boolean(notify);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setChecks(null);
    if (!state || !shown) return;
    let current = true;
    commitChecks(repoPath, id)
      .then((found) => current && setChecks(found))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [repoPath, id, state, shown]);
  const now = useNow(1000, Boolean(checks && anyRunning(checks.checks)));
  if (!state || !shown || !checks || checks.checks.length === 0) return null;
  const sorted = [...checks.checks].sort((a, b) => ORDER[stateOf(a)] - ORDER[stateOf(b)]);
  const counts = new Map<State, number>();
  for (const check of sorted) counts.set(stateOf(check), (counts.get(stateOf(check)) ?? 0) + 1);
  const notable = sorted.filter((check) => stateOf(check) === "failure" || stateOf(check) === "pending");
  const rerun = () => {
    setBusy(true);
    rerunFailedChecks(repoPath, id)
      .then((said) => notify?.(said))
      .catch((e) => notify?.(String(e)))
      .finally(() => setBusy(false));
  };
  return { id, checks, sorted, counts, failed: counts.get("failure") ?? 0, notable, now, busy, rerun };
}

/**
 * A commit's CI in its details (GitHub checks, or its latest GitLab pipeline's jobs), built
 * as its pull request is: how they went, with Open, which shows each run as a graph; under
 * that, how many are in each state, a pip for each (ChecksSummary), the failed and running
 * ones (all of them when asked), and Re-run failed.
 */
export function CommitChecks({ shown: found, onShow }: { shown: CommitChecksShown | null; onShow?: () => void }) {
  const [all, setAll] = useState({ id: "", on: false });
  if (!found) return null;
  const { checks, sorted, failed, notable, now, busy, rerun } = found;
  // A new commit starts with only the ones that need a look.
  const showAll = all.on && all.id === found.id;
  const setShowAll = (on: boolean) => setAll({ id: found.id, on });
  const shown = showAll ? sorted : notable.slice(0, FIRST);
  const jobs = checks.site === "GitLab" ? "jobs" : "checks";
  const more = showAll || shown.length < sorted.length;
  const again = checks.canRerun && failed > 0;

  return (
    <section className="details-section commit-checks">
      <div className="details-section-head">
        <h3>{checks.site === "GitLab" ? "Pipeline" : "Checks"}</h3>
        <SiteChip site={checks.site} />
      </div>
      <ChecksSummary checks={sorted} gitlab={checks.site === "GitLab"} onShow={onShow} />
      {shown.length > 0 && (
        <ul className="commit-checks-list">
          {shown.map((check, index) => (
            <CheckLine key={`${check.name}-${index}`} check={check} time={checkTime(check, now)} />
          ))}
        </ul>
      )}
      {(more || again) && (
        <div className="commit-checks-links">
          {more && (
            <Button kind="link" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${sorted.length} ${jobs}`}
            </Button>
          )}
          {again && (
            <Button kind="link" disabled={busy} onClick={rerun}>
              {busy ? "Asking…" : "Re-run failed"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * How a commit's checks went, in its details: in words ("1 of 7 checks failed"), with Open,
 * which shows each run as a graph; under that, how many are in each state, and a pip for each
 * check in its colour, failed ones first. (A pull request's view says it beside its river.)
 */
function ChecksSummary({ checks, gitlab, onShow }: { checks: RequestCheck[]; gitlab: boolean; onShow?: () => void }) {
  const sorted = [...checks].sort((a, b) => ORDER[stateOf(a)] - ORDER[stateOf(b)]);
  const counts = new Map<State, number>();
  for (const check of sorted) counts.set(stateOf(check), (counts.get(stateOf(check)) ?? 0) + 1);
  const state = checksVerdict(counts);
  return (
    <div className="site-checks">
      <div className={`site-item checks ${state}`}>
        <span className="site-item-icon">
          <RunStateIcon state={state} size={14} />
        </span>
        <span className="site-item-text commit-checks-headline">{checksHeadline(counts, gitlab)}</span>
        {onShow && <SectionButton onClick={onShow} icon={<WorkflowIcon size={12} />} label="Open" title="Open the checks, each run as a graph of its jobs" />}
        <span className="site-item-under commit-checks-counts">{[...counts].map(([what, n]) => `${n} ${WORDS[what]}`).join(", ")}</span>
      </div>
      <div className="check-pips" aria-hidden>
        {sorted.map((check, index) => (
          <span key={`${check.name}-${index}`} className={stateOf(check)} title={`${checkName(check.name)}: ${WORDS[stateOf(check)]}`} />
        ))}
      </div>
    </div>
  );
}

/** A check: how it went, its name (and what it said), how long it took, and its page. */
export function CheckLine({ check, time }: { check: RequestCheck; time: string | null }) {
  const state = stateOf(check);
  const content = (
    <>
      <span className="commit-check-dot" title={WORDS[state]} />
      <span className="commit-check-text">
        <SlidingText className="commit-check-name" text={checkName(check.name)} />
        {check.detail && <span className="commit-check-detail">{check.detail}</span>}
      </span>
      {time && <span className="commit-check-time">{time}</span>}
      {check.url && <ExternalLinkIcon size={12} />}
    </>
  );
  return (
    <li className={`commit-check ${state}`}>
      {check.url ? (
        <button className="commit-check-row" onClick={() => openInBrowser(check.url!)} data-url={check.url} title={`${checkName(check.name)}: open its page`}>
          {content}
        </button>
      ) : (
        <div className="commit-check-row">{content}</div>
      )}
    </li>
  );
}
