import { useContext, useEffect, useState } from "react";
import { commitChecks, rerunFailedChecks, type CommitChecks as Checks, type RequestCheck } from "../api";
import { CiStatesContext } from "../lib/ciStates";
import { anyRunning, checkName, checkTime } from "../lib/pullRequests";
import { useNow } from "../lib/useNow";
import { openInBrowser } from "../lib/weblinks";
import { SlidingText } from "./SlidingText";
import { ExternalLinkIcon, RefreshIcon } from "./Icons";
import { Button } from "./ui/Button";

type State = "failure" | "pending" | "success" | "cancelled" | "skipped";
const stateOf = (check: RequestCheck): State => check.state ?? "skipped";
/** Failed ones first, then running, then the rest. */
const ORDER: Record<State, number> = { failure: 0, pending: 1, success: 2, cancelled: 3, skipped: 4 };
const WORDS: Record<State, string> = { failure: "failed", pending: "running", success: "passed", cancelled: "cancelled", skipped: "skipped" };
/** How many failed or running ones are listed before "Show all". */
const FIRST = 4;

/**
 * A commit's CI in its details (GitHub checks, or its latest GitLab pipeline's jobs): how
 * many passed and failed, in words and as a bar, the failed and running ones listed (all of
 * them when asked), and the failed ones run again from here. Only for commits the list knows
 * a state for.
 */
export function CommitChecks({ repoPath, id, notify }: { repoPath: string; id: string; notify: (text: string) => void }) {
  const state = useContext(CiStatesContext).get(id);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setChecks(null);
    setAll(false);
    if (!state) return;
    let current = true;
    commitChecks(repoPath, id)
      .then((found) => current && setChecks(found))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [repoPath, id, state]);
  const now = useNow(1000, Boolean(checks && anyRunning(checks.checks)));
  if (!state || !checks || checks.checks.length === 0) return null;

  const sorted = [...checks.checks].sort((a, b) => ORDER[stateOf(a)] - ORDER[stateOf(b)]);
  const counts = new Map<State, number>();
  for (const check of sorted) counts.set(stateOf(check), (counts.get(stateOf(check)) ?? 0) + 1);
  const failed = counts.get("failure") ?? 0;
  // Unless all are asked for, the ones that need a look: failed and running.
  const notable = sorted.filter((check) => stateOf(check) === "failure" || stateOf(check) === "pending");
  const shown = all ? sorted : notable.slice(0, FIRST);
  const jobs = checks.site === "GitLab" ? "jobs" : "checks";
  const rerun = () => {
    setBusy(true);
    rerunFailedChecks(repoPath, id)
      .then(notify)
      .catch((e) => notify(String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="details-section commit-checks">
      <div className="details-section-head">
        <h3>{checks.site === "GitLab" ? "Pipeline" : "Checks"}</h3>
        <span className="details-section-note">{checks.site}</span>
        {checks.canRerun && failed > 0 && (
          <button className="commit-checks-rerun" disabled={busy} onClick={rerun}>
            <RefreshIcon size={12} />
            <span className="button-label">{busy ? "Asking…" : "Re-run failed"}</span>
          </button>
        )}
      </div>
      <div className="commit-checks-summary">
        {[...counts].map(([what, n]) => (
          <span key={what} className={`commit-checks-count ${what}`}>
            <strong>{n}</strong> {WORDS[what]}
          </span>
        ))}
      </div>
      {/* How they went, as a bar: a length for each, in its colour. */}
      <div className="commit-checks-bar" aria-hidden>
        {[...counts].map(([what, n]) => (
          <span key={what} className={what} style={{ flexGrow: n }} />
        ))}
      </div>
      {shown.length > 0 && (
        <ul className="commit-checks-list">
          {shown.map((check, index) => (
            <CheckLine key={`${check.name}-${index}`} check={check} time={checkTime(check, now)} />
          ))}
        </ul>
      )}
      {(all || shown.length < sorted.length) && (
        <Button kind="link" className="commit-checks-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${sorted.length} ${jobs}`}
        </Button>
      )}
    </section>
  );
}

/** A check: how it went, its name (and what it said), how long it took, and its page. */
function CheckLine({ check, time }: { check: RequestCheck; time: string | null }) {
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
