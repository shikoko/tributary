import { useContext, useEffect, useState } from "react";
import { commitChecks, rerunFailedChecks, type CommitChecks as Checks } from "../api";
import { CiStatesContext } from "../lib/ciStates";
import { summarizeChecks } from "../lib/pullRequests";
import { openInBrowser } from "../lib/weblinks";
import { CheckRow } from "./PullRequestView";

/**
 * A commit's CI in its details (GitHub checks, or its latest GitLab pipeline's jobs), with
 * the failed ones run again from here. Only for commits the list knows a state for.
 */
export function CommitChecks({ repoPath, id, notify }: { repoPath: string; id: string; notify: (text: string) => void }) {
  const state = useContext(CiStatesContext).get(id);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setChecks(null);
    setOpen(false);
    if (!state) return;
    let current = true;
    commitChecks(repoPath, id)
      .then((found) => current && setChecks(found))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [repoPath, id, state]);
  if (!state || !checks || checks.checks.length === 0) return null;
  const failed = checks.checks.filter((check) => check.state === "failure");
  // Failures first, then the rest when asked.
  const shown = open ? checks.checks : failed.length > 0 ? failed.slice(0, 6) : [];
  return (
    <div className="commit-checks">
      <div className="commit-checks-head">
        <span className={`ci-dot ${state}`} />
        <span>
          {checks.site} {checks.site === "GitLab" ? "pipeline" : "checks"}: {summarizeChecks(checks.checks)}
        </span>
        <button className="link-button" onClick={() => setOpen(!open)}>
          {open ? "Fewer" : "All"}
        </button>
        {checks.canRerun && (
          <button
            className="outline-button small"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              rerunFailedChecks(repoPath, id)
                .then(notify)
                .catch((e) => notify(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            <span className="button-label">{busy ? "Asking…" : "Re-run failed"}</span>
          </button>
        )}
      </div>
      {shown.length > 0 && (
        <ul className="request-checks">
          {shown.map((check, index) => (
            <CheckRow key={`${check.name}-${index}`} check={check} openUrl={openInBrowser} />
          ))}
        </ul>
      )}
    </div>
  );
}
