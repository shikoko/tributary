import { useCallback, useEffect, useState, type ReactNode } from "react";
import { branchVersions, pullRequestDetails, requestConversation, type MergeCheck, type PullRequest, type RequestCheck, type RequestConversation, type RequestDetails, type RequestReview } from "../api";
import { copyText } from "../lib/clipboard";
import { plural, relativeTime } from "../lib/format";
import { checkMerge, describeMergeCheck } from "../lib/mergeChecks";
import { anyRunning, describeMergeable, describeReviews, requestNoun, requestNumber } from "../lib/pullRequests";
import { useNow } from "../lib/useNow";
import { Avatar } from "./Avatar";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  CompareIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  MergeIcon,
  PencilIcon,
  PullRequestIcon,
  RebaseIcon,
  RefreshIcon,
  UserIcon,
  WarningIcon,
} from "./Icons";
import { Loader } from "./Loader";
import { CheckTimeline } from "./CheckTimeline";
import { CheckTributaries } from "./CheckTributaries";
import { Markdown } from "./Markdown";
import { AskForReview, useRequestChange } from "./RequestControls";
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
  approved: "approved",
  changesRequested: "asked for changes",
  commented: "commented",
  requested: "asked to review",
};

/** How the status card looks: good to merge, something wrong, waiting, or done. */
type Tone = "good" | "bad" | "waiting" | "merged" | "closed" | "neutral";

const TONE_ICONS: Record<Tone, ReactNode> = {
  good: <CheckIcon size={16} />,
  bad: <WarningIcon size={16} />,
  waiting: <ClockIcon size={16} />,
  merged: <MergeIcon size={16} />,
  closed: <CloseIcon size={14} />,
  neutral: <PullRequestIcon size={15} />,
};

/** Failed first, then running, passed, and skipped last. */
const CHECK_ORDER: Record<string, number> = { failure: 0, pending: 1, success: 2, skipped: 3 };
const checkState = (check: RequestCheck) => check.state ?? "skipped";

/**
 * A pull request (or GitLab merge request), over the commit list: where it stands (with
 * Merge, and its checks), what can be done with it, its description and the
 * conversation. Checks still running are followed.
 */
export function PullRequestView({ repoPath, request, onClose, openUrl, onShowBranch, hasCommit, onCompare, notify, onShowRewrite }: Props) {
  const [details, setDetails] = useState<RequestDetails | null>(null);
  const [conversation, setConversation] = useState<RequestConversation | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [merging, setMerging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
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
    setAsking(false);
    return loadConversation();
  }, [loadConversation]);

  /** After a comment or a reply: say so, and show the conversation as it is now. A review,
   *  a request for reviewers or a merge someone has started stays open. */
  const refresh = (message: string) => {
    notify(message);
    load();
    loadConversation();
  };
  /** After reviewing, merging or changing it: that's finished, so close it too. */
  const done = (message: string) => {
    setReviewing(false);
    setAsking(false);
    setMerging(false);
    refresh(message);
  };
  const { busy, error: changeError, change } = useRequestChange(repoPath, details, done);

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
  const canAct = Boolean(conversation?.you) && open;
  const created = details ? Date.parse(details.created) / 1000 : NaN;

  /** A menu under the button that opened it. */
  const showMenu = (button: HTMLElement, items: MenuItem[]) => {
    const box = button.getBoundingClientRect();
    setMenu({ x: box.left, y: box.bottom + 4, items });
  };

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
          <Loader title={`Loading ${noun} ${requestNumber(request)}`} detail={request.title} size={96} />
        ) : (
          <div className="request-content">
            <div className="request-meta">
              <span className={`request-state ${details.state}`}>
                {details.state === "merged" ? <MergeIcon size={13} /> : details.state === "closed" ? <CloseIcon size={12} /> : <PullRequestIcon size={13} />}
                <span className="chip-text">{STATES[details.state]}</span>
              </span>
              <span className="request-who chip-text">
                <strong>{details.author}</strong> wants to merge
              </span>
              <button className="request-ref" onClick={() => onShowBranch(details.branch)} title={`Highlight ${details.branch}'s history`}>
                <span className="chip-text">{details.branch}</span>
              </button>
              <span className="request-into" aria-label="into">
                <ChevronRightIcon size={14} />
              </span>
              <span className="request-ref">
                <span className="chip-text">{details.base}</span>
              </span>
              {Number.isFinite(created) && <span className="request-when chip-text">opened {relativeTime(created)}</span>}
            </div>
            <div className="request-facts">
              {details.additions !== null && details.deletions !== null && (
                <span className="request-lines">
                  <span className="added chip-text">+{details.additions}</span>
                  <span className="removed chip-text">−{details.deletions}</span>
                </span>
              )}
              {details.files !== null && <span className="chip-text">{plural(details.files, "file")}</span>}
              <span className="chip-text">{plural(details.comments, "comment")}</span>
              {details.reviews.length > 0 && (
                <span className="request-avatars" aria-label={describeReviews(details.reviews) ?? "Reviewers"}>
                  {details.reviews.map((review) => (
                    <span key={review.author} className={`request-avatar ${review.state}`} title={`${review.author} ${REVIEWS[review.state]}`}>
                      <Avatar name={review.author} email="" size={22} />
                    </span>
                  ))}
                </span>
              )}
            </div>

            <StatusCard
              details={details}
              title={
                details.state === "merged"
                  ? `Merged into ${details.base}`
                  : details.state === "closed"
                    ? "Closed without merging"
                    : details.state === "draft" && merge?.tone !== "bad"
                      ? "A draft: not ready for review yet"
                      : (merge?.text ?? (localSaid ? `Into ${details.base}: ${localSaid.text[0].toLowerCase() + localSaid.text.slice(1)} (checked here)` : "Open"))
              }
              tone={
                details.state === "merged"
                  ? "merged"
                  : details.state === "closed"
                    ? "closed"
                    : details.state === "draft" && merge?.tone !== "bad"
                      ? "neutral"
                      : (merge?.tone ?? (localSaid ? (localSaid.tone === "bad" ? "bad" : localSaid.tone === "good" ? "good" : "waiting") : "neutral"))
              }
              openUrl={openUrl}
              action={
                canAct && conversation ? (
                  details.state === "draft" ? (
                    <button className="primary-small-button request-primary" disabled={busy} onClick={() => void change({ kind: "draft", draft: false })}>
                      <span className="button-label">Ready for review</span>
                    </button>
                  ) : conversation.mergeMethods.length > 0 ? (
                    <span className="request-split">
                      <button className="primary-small-button request-primary" onClick={() => setMerging(true)}>
                        <MergeIcon size={14} />
                        <span className="button-label">Merge…</span>
                      </button>
                      <button
                        className="primary-small-button request-primary request-caret"
                        disabled={busy}
                        title="More ways to merge"
                        aria-label="More ways to merge"
                        onClick={(event) =>
                          showMenu(event.currentTarget, [
                            {
                              label: details.forge === "gitlab" ? "Merge when the pipeline succeeds" : "Merge when checks pass",
                              checked: details.autoMerge,
                              detail: details.autoMerge ? "It merges by itself: choose again to stop" : "It merges by itself once they pass",
                              onSelect: () => void change({ kind: "autoMerge", on: !details.autoMerge, method: conversation.mergeMethods[0] }),
                            },
                          ])
                        }
                      >
                        <ChevronDownIcon size={14} />
                      </button>
                    </span>
                  ) : null
                ) : null
              }
              note={
                conversation && !conversation.you && open
                  ? details.forge === "gitlab"
                    ? "To comment, review or merge here, git needs a token for GitLab: push or fetch once to sign in."
                    : "To comment, review or merge here, sign in to GitHub in Settings."
                  : null
              }
            >
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
            </StatusCard>

            <div className="request-toolbar">
              <button
                className="outline-button"
                onClick={() => onCompare(details)}
                disabled={!fetched}
                title={fetched ? `What ${details.branch} changes, compared with ${details.base}` : `Fetch to see its changes here: its commits aren't loaded`}
              >
                <CompareIcon size={14} />
                <span className="button-label">See its changes</span>
              </button>
              {forcePushed && (
                <button className="outline-button" onClick={() => onShowRewrite(details.branch, details.base)} title={`${details.branch} was force-pushed: see what changed, commit by commit`}>
                  <RebaseIcon size={14} />
                  <span className="button-label">Since the force-push</span>
                </button>
              )}
              {canAct && (
                <button className={`outline-button${reviewing ? " active" : ""}`} onClick={() => setReviewing(!reviewing)} aria-expanded={reviewing}>
                  <EyeIcon size={14} />
                  <span className="button-label">Review</span>
                </button>
              )}
              {canAct && (
                <button className={`outline-button${asking ? " active" : ""}`} disabled={busy} onClick={() => setAsking(!asking)} aria-expanded={asking}>
                  <UserIcon size={14} />
                  <span className="button-label">Ask for review…</span>
                </button>
              )}
              <button
                className="outline-button quiet"
                title="More"
                onClick={(event) =>
                  showMenu(event.currentTarget, [
                    ...(canAct && details.state === "open"
                      ? [{ label: "Back to draft", icon: <PencilIcon size={14} />, onSelect: () => void change({ kind: "draft", draft: true }) }]
                      : []),
                    {
                      label: "Copy link",
                      icon: <CopyIcon size={14} />,
                      onSelect: () =>
                        void copyText(details.url)
                          .then(() => notify(`Copied the link to ${requestNumber(request)}`))
                          .catch((e) => notify(String(e))),
                    },
                  ])
                }
              >
                <span className="button-label">More</span>
                <ChevronDownIcon size={13} />
              </button>
            </div>
            {asking && <AskForReview gitlab={details.forge === "gitlab"} busy={busy} onAsk={(reviewers) => void change({ kind: "reviewers", reviewers })} onCancel={() => setAsking(false)} />}
            {changeError && <p className="review-error">{changeError}</p>}
            {reviewing && conversation && <ReviewBox repoPath={repoPath} details={details} conversation={conversation} onDone={done} onCancel={() => setReviewing(false)} />}

            <section className="request-card request-description-card" aria-label="Description">
              {details.body.trim() ? <Markdown text={details.body.trim()} openUrl={openUrl} /> : <p className="muted request-empty">No description.</p>}
            </section>

            <section className="request-section" aria-label="Conversation">
              <h3 className="team-heading">Conversation</h3>
              {conversation ? (
                <ConversationList repoPath={repoPath} details={details} conversation={conversation} openUrl={openUrl} onDone={refresh} />
              ) : conversationError ? (
                <p className="muted request-empty">Couldn't read the comments: {conversationError}</p>
              ) : (
                <Loader size={48} title="Reading the conversation" />
              )}
            </section>
            {error && <p className="request-stale">Couldn't refresh it: {error}</p>}
          </div>
        )}
      </div>
      {merging && details && conversation && (
        <MergeRequestDialog repoPath={repoPath} details={details} methods={conversation.mergeMethods} onCancel={() => setMerging(false)} onDone={done} />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </section>
  );
}

/**
 * Where a request stands, in a card: whether it can be merged (and Merge), what its
 * reviewers said, and its checks, as a bar and a list.
 */
function StatusCard({
  details,
  title,
  tone,
  action,
  note,
  openUrl,
  children,
}: {
  details: RequestDetails;
  title: string;
  tone: Tone;
  action: ReactNode;
  note: string | null;
  openUrl: (url: string) => void;
  children?: ReactNode;
}) {
  const gitlab = details.forge === "gitlab";
  const settled = details.state === "merged" || details.state === "closed";
  const said = settled ? null : describeReviews(details.reviews);
  const checks = [...details.checks].sort((a, b) => CHECK_ORDER[checkState(a)] - CHECK_ORDER[checkState(b)]);
  const ran = checks.filter((check) => check.state !== null);
  // Running checks count up to the second; otherwise the clock's ends ("5 minutes ago") still move.
  const now = useNow(anyRunning(checks) ? 1000 : 30_000);
  return (
    <section className={`request-status ${tone}`} aria-label="Where it stands">
      <div className="request-status-top">
        <span className="request-status-icon" aria-hidden>
          {TONE_ICONS[tone]}
        </span>
        <div className="request-status-text">
          <div className="request-merge">{title}</div>
          {said && <div className="request-status-said">{said}</div>}
          {note && <div className="request-sign-in">{note}</div>}
        </div>
        {action}
      </div>
      {children}
      {checks.length > 0 && (
        <>
          <div className="request-checks-head">
            <span className="request-checks-title">{gitlab ? "Pipeline" : "Checks"}</span>
          </div>
          {ran.length > 0 && <CheckTributaries key={details.number} checks={ran} now={now} gitlab={gitlab} openUrl={openUrl} />}
          <CheckTimeline checks={checks} now={now} openUrl={openUrl} />
        </>
      )}
    </section>
  );
}

/** How long a check has been running, ticking, or how long it took. */
function CheckTime({ check, time }: { check: RequestCheck; time: string }) {
  const running = check.state === "pending";
  return (
    <span className="request-check-time" title={running ? `Running for ${time}` : `Took ${time}`}>
      {time}
    </span>
  );
}

/** A check in a commit's details: its state, its name, how long it took, and its page. */
export function CheckRow({ check, time, openUrl }: { check: RequestCheck; time: string | null; openUrl: (url: string) => void }) {
  const state = checkState(check);
  const words = { success: "Passed", failure: "Failed", pending: "Running", skipped: "Skipped" }[state];
  return (
    <li className={`request-check ${state}`}>
      <span className="request-check-dot" aria-label={words} title={words} />
      <span className="request-check-name">{check.name}</span>
      {check.detail && <span className="request-check-detail">{check.detail}</span>}
      {time && <CheckTime check={check} time={time} />}
      {check.url && (
        <button className="link-button request-check-link" onClick={() => openUrl(check.url!)}>
          Details
        </button>
      )}
    </li>
  );
}
