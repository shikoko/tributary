import { useCallback, useEffect, useState } from "react";
import { branchVersions, pullRequestDetails, requestConversation, type MergeCheck, type PullRequest, type RequestCheck, type RequestConversation, type RequestDetails, type RequestReview } from "../api";
import { plural, relativeTime } from "../lib/format";
import { checkMerge, describeMergeCheck } from "../lib/mergeChecks";
import { describeMergeable, requestNoun, requestNumber, summarizeChecks } from "../lib/pullRequests";
import { Avatar } from "./Avatar";
import { CloseIcon, CompareIcon, ExternalLinkIcon, MergeIcon, PullRequestIcon, RebaseIcon, RefreshIcon } from "./Icons";
import { ConversationList, MergeRequestDialog, ReviewBox } from "./RequestReview";

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
  /** Whether a commit is loaded in the list. */
  hasCommit: (id: string) => boolean;
  /** Compare its branch with the one it goes into, in the app. */
  onCompare: (details: RequestDetails) => void;
  /** Say what was done, like "Approved #12". */
  notify: (text: string) => void;
  /** Show what changed when its branch was force-pushed (`branch` and `base`: their names on the remote). */
  onShowRewrite: (branch: string, base: string) => void;
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
export function PullRequestView({ repoPath, request, onClose, openUrl, onShowBranch, hasCommit, onCompare, notify, onShowRewrite }: Props) {
  const [details, setDetails] = useState<RequestDetails | null>(null);
  const [conversation, setConversation] = useState<RequestConversation | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [merging, setMerging] = useState(false);
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

  const loadConversation = useCallback(() => {
    let current = true;
    requestConversation(repoPath, request.number)
      .then((found) => {
        if (!current) return;
        setConversation(found);
        setConversationError(null);
      })
      .catch((e) => current && setConversationError(String(e)));
    return () => {
      current = false;
    };
  }, [repoPath, request.number]);

  useEffect(() => {
    setDetails(null);
    setError(null);
    return load();
  }, [load]);

  useEffect(() => {
    setConversation(null);
    setConversationError(null);
    setReviewing(false);
    return loadConversation();
  }, [loadConversation]);

  /** After commenting, reviewing or merging: say so, and show where it stands now. */
  const done = (message: string) => {
    notify(message);
    setReviewing(false);
    setMerging(false);
    load();
    loadConversation();
  };

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
  // Its commits are loaded, so the app can compare them.
  const fetched = Boolean(details?.baseSha && details.headSha && hasCommit(details.baseSha) && hasCommit(details.headSha));
  // Which files conflict (the site only says that some do), or, when the site doesn't say,
  // whether it would merge: worked out here, from its commits.
  const [local, setLocal] = useState<MergeCheck | null>(null);
  const open = details?.state === "open" || details?.state === "draft";
  const wanted = fetched && open && details && (details.mergeable === "conflicts" || !merge) ? `${details.headSha}:${details.baseSha}` : null;
  useEffect(() => {
    setLocal(null);
    if (!wanted || !details?.headSha || !details.baseSha) return;
    let current = true;
    checkMerge(repoPath, details.headSha, details.baseSha, wanted)
      .then((found) => current && setLocal(found))
      .catch(() => {});
    return () => {
      current = false;
    };
    // `wanted` stands for the two commits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, wanted]);
  const localSaid = local && !merge ? describeMergeCheck(local, "merge") : null;
  // Its branch was force-pushed since this copy of the repository first saw it: offer what changed.
  const [forcePushed, setForcePushed] = useState(false);
  const remoteBranch = `${request.remote}/${request.branch}`;
  useEffect(() => {
    let current = true;
    setForcePushed(false);
    branchVersions(repoPath, remoteBranch)
      .then((versions) => current && setForcePushed(versions.some((version, index) => version.rewritten && index + 1 < versions.length)))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [repoPath, remoteBranch, details?.headSha]);
  const canAct = Boolean(conversation?.you) && (details?.state === "open" || details?.state === "draft");
  const created = details ? Date.parse(details.created) / 1000 : NaN;
  return (
    <section className="diff-view request-view" aria-label={`${noun} ${requestNumber(request)}`}>
      <header className="diff-header">
        <div className="diff-title" title={details?.title ?? request.title}>
          <PullRequestIcon size={14} />
          <span className="request-number">{requestNumber(request)}</span>
          <span className="request-title">{details?.title ?? request.title}</span>
        </div>
        <button
          className="icon-button"
          onClick={() => {
            load();
            loadConversation();
          }}
          disabled={loading}
          title="Refresh"
          aria-label={`Refresh the ${noun}`}
        >
          <RefreshIcon size={14} />
        </button>
        <button className="outline-button" onClick={() => openUrl(details?.url ?? request.url)} title={`Open it on ${site}`}>
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
            {localSaid && (
              <div className={`request-merge ${localSaid.tone === "bad" ? "bad" : localSaid.tone === "good" ? "good" : "waiting"}`}>
                Into {details.base}: {localSaid.text[0].toLowerCase() + localSaid.text.slice(1)} (checked here)
              </div>
            )}
            {local?.outcome === "conflicts" && local.conflicts.length > 0 && (
              <div className="request-conflicts">
                <span className="muted">{local.conflictCount === 1 ? "The file that conflicts" : `The ${local.conflictCount} files that conflict`}, as merged here:</span>
                <ul className="mono">
                  {local.conflicts.slice(0, 12).map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                  {local.conflictCount > 12 && <li className="muted">and {plural(local.conflictCount - 12, "more file")}</li>}
                </ul>
              </div>
            )}

            <div className="request-actions">
              <button
                className="outline-button"
                onClick={() => onCompare(details)}
                disabled={!fetched}
                title={fetched ? `What ${details.branch} changes, compared with ${details.base}` : `Fetch to see its changes here: its commits aren't loaded`}
              >
                <CompareIcon size={13} />
                <span className="button-label">See its changes</span>
              </button>
              {forcePushed && (
                <button
                  className="outline-button"
                  onClick={() => onShowRewrite(details.branch, details.base)}
                  title={`${details.branch} was force-pushed: see what changed, commit by commit`}
                >
                  <RebaseIcon size={13} />
                  <span className="button-label">Since the force-push</span>
                </button>
              )}
              {canAct && (
                <button className={`outline-button${reviewing ? " active" : ""}`} onClick={() => setReviewing(!reviewing)} aria-expanded={reviewing}>
                  <span className="button-label">Review</span>
                </button>
              )}
              {canAct && details.state === "open" && conversation && conversation.mergeMethods.length > 0 && (
                <button className="primary-small-button" onClick={() => setMerging(true)}>
                  <MergeIcon size={13} />
                  Merge…
                </button>
              )}
              {conversation && !conversation.you && (details.state === "open" || details.state === "draft") && (
                <span className="request-sign-in">
                  {details.forge === "gitlab"
                    ? "To comment, review or merge here, git needs a token for GitLab: push or fetch once to sign in."
                    : "To comment, review or merge here, sign in to GitHub in Settings."}
                </span>
              )}
            </div>
            {reviewing && conversation && <ReviewBox repoPath={repoPath} details={details} conversation={conversation} onDone={done} onCancel={() => setReviewing(false)} />}

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
            <section className="request-section" aria-label="Conversation">
              <h3 className="team-heading">Conversation</h3>
              {conversation ? (
                <ConversationList repoPath={repoPath} details={details} conversation={conversation} onDone={done} />
              ) : conversationError ? (
                <p className="muted request-empty">Couldn't read the comments: {conversationError}</p>
              ) : (
                <p className="muted request-empty">Loading…</p>
              )}
            </section>
            {error && <p className="request-stale">Couldn't refresh it: {error}</p>}
          </div>
        )}
      </div>
      {merging && details && conversation && (
        <MergeRequestDialog repoPath={repoPath} details={details} methods={conversation.mergeMethods} onCancel={() => setMerging(false)} onDone={done} />
      )}
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
