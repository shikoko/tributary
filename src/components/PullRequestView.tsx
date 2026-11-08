import { useCallback, useEffect, useState } from "react";
import { pullRequestDetails, type PullRequest, type RequestCheck, type RequestDetails, type RequestReview } from "../api";
import { plural, relativeTime } from "../lib/format";
import { describeMergeable, requestNoun, requestNumber, summarizeChecks } from "../lib/pullRequests";
import { Avatar } from "./Avatar";
import { CloseIcon, ExternalLinkIcon, PullRequestIcon, RefreshIcon } from "./Icons";

/** While checks are running, they're asked about again this often. */
const POLL = 20_000;

interface Props {
  repoPath: string;
  /** The request as the badges know it: shown while its details load. */
  request: PullRequest;
  onClose: () => void;
  openUrl: (url: string) => void;
  /** Highlight its branch's history in the list. */
  onShowBranch: (branch: string) => void;
}

const STATES: Record<RequestDetails["state"], string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

const REVIEWS: Record<RequestReview["state"], string> = {
  approved: "Approved",
  changesRequested: "Asked for changes",
  commented: "Commented",
  requested: "Asked to review",
};

/**
 * A pull request (or GitLab merge request), over the commit list: where it stands, what
 * reviewers said, each check, and its description. Checks still running are followed.
 */
export function PullRequestView({ repoPath, request, onClose, openUrl, onShowBranch }: Props) {
  const [details, setDetails] = useState<RequestDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const noun = requestNoun(request.forge);
  const site = request.forge === "gitlab" ? "GitLab" : "GitHub";

  const load = useCallback(() => {
    let current = true;
    setLoading(true);
    pullRequestDetails(repoPath, request.number)
      .then((found) => {
        if (!current) return;
        setDetails(found);
        setError(null);
      })
      .catch((e) => current && setError(String(e)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [repoPath, request.number]);

  useEffect(() => {
    setDetails(null);
    setError(null);
    return load();
  }, [load]);

  // Follow checks that are still running.
  const running = details?.checks.some((check) => check.state === "pending") || details?.mergeable === "checking";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(load, POLL);
    return () => window.clearInterval(timer);
  }, [running, load]);

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

  const merge = details && describeMergeable(details);
  const created = details ? Date.parse(details.created) / 1000 : NaN;
  return (
    <section className="diff-view request-view" aria-label={`${noun} ${requestNumber(request)}`}>
      <header className="diff-header">
        <div className="diff-title" title={details?.title ?? request.title}>
          <PullRequestIcon size={14} />
          <span className="request-number">{requestNumber(request)}</span>
          <span className="request-title">{details?.title ?? request.title}</span>
        </div>
        <button className="icon-button" onClick={load} disabled={loading} title="Refresh" aria-label={`Refresh the ${noun}`}>
          <RefreshIcon size={14} />
        </button>
        <button className="outline-button" onClick={() => openUrl(details?.url ?? request.url)} title={`Open it on ${site} to comment, review or merge`}>
          <ExternalLinkIcon size={13} />
          <span className="button-label">Open on {site}</span>
        </button>
        <button className="icon-button" onClick={onClose} title="Close (Esc)" aria-label={`Close the ${noun}`}>
          <CloseIcon />
        </button>
      </header>
      <div className="diff-body request-body-scroll">
        {error && !details ? (
          <div className="diff-message">
            <strong>Couldn't read {noun} {requestNumber(request)}</strong>
            <span>{error}</span>
          </div>
        ) : !details ? (
          <div className="diff-message muted">Loading…</div>
        ) : (
          <div className="request-content">
            <div className="request-meta">
              <span className={`request-state ${details.state}`}>{STATES[details.state]}</span>
              <span>
                <strong>{details.author}</strong> wants to merge{" "}
                <button className="request-ref mono" onClick={() => onShowBranch(details.branch)} title={`Highlight ${details.branch}'s history`}>
                  {details.branch}
                </button>{" "}
                into <span className="request-ref mono">{details.base}</span>
                {Number.isFinite(created) && <> · opened {relativeTime(created)}</>}
              </span>
            </div>
            <div className="request-facts">
              {details.additions !== null && details.deletions !== null && (
                <span className="request-lines">
                  <span className="added">+{details.additions}</span> <span className="removed">−{details.deletions}</span>
                </span>
              )}
              {details.files !== null && <span>{plural(details.files, "file")}</span>}
              <span>{plural(details.comments, "comment")}</span>
            </div>

            {merge && <div className={`request-merge ${merge.tone}`}>{merge.text}</div>}

            <div className="request-columns">
              <section className="request-section" aria-label="Reviews">
                <h3 className="team-heading">Reviews</h3>
                {details.reviews.length === 0 ? (
                  <p className="muted request-empty">No reviews yet.</p>
                ) : (
                  <ul className="request-reviews">
                    {details.reviews.map((review) => (
                      <li key={review.author}>
                        <Avatar name={review.author} email="" size={22} />
                        <span className="request-reviewer">{review.author}</span>
                        <span className={`request-review ${review.state}`}>{REVIEWS[review.state]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="request-section" aria-label="Checks">
                <h3 className="team-heading">
                  {details.forge === "gitlab" ? "Pipeline" : "Checks"}
                  {details.checks.length > 0 && <span className="request-check-summary">{summarizeChecks(details.checks)}</span>}
                </h3>
                {details.checks.length === 0 ? (
                  <p className="muted request-empty">{details.forge === "gitlab" ? "No pipeline ran for it." : "No checks ran on it."}</p>
                ) : (
                  <ul className="request-checks">
                    {details.checks.map((check, index) => (
                      <CheckRow key={`${check.name}-${index}`} check={check} openUrl={openUrl} />
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className="request-section" aria-label="Description">
              <h3 className="team-heading">Description</h3>
              {details.body.trim() ? <div className="request-description">{details.body.trim()}</div> : <p className="muted request-empty">No description.</p>}
            </section>
            {error && <p className="request-stale">Couldn't refresh it: {error}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function CheckRow({ check, openUrl }: { check: RequestCheck; openUrl: (url: string) => void }) {
  const state = check.state ?? "skipped";
  const words = { success: "Passed", failure: "Failed", pending: "Running", skipped: "Skipped" }[state];
  return (
    <li className={`request-check ${state}`}>
      <span className="request-check-dot" aria-label={words} title={words} />
      <span className="request-check-name">{check.name}</span>
      {check.detail && <span className="request-check-detail">{check.detail}</span>}
      {check.url && (
        <button className="link-button request-check-link" onClick={() => openUrl(check.url!)}>
          Details
        </button>
      )}
    </li>
  );
}
