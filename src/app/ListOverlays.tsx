import type { Action, Lock, Overlap, PullRequest, RepoSnapshot, RequestConversation, RequestDetails } from "../api";
import { BlameView } from "../components/BlameView";
import { ChecksView, type ChecksOf } from "../components/ChecksView";
import { DiffView } from "../components/diff/DiffView";
import type { ReviewNotes } from "../components/diff/ReviewThreads";
import { PullRequestView } from "../components/PullRequestView";
import { RewriteView } from "../components/RewriteView";
import { TeamView } from "../components/TeamView";
import { conflictSides } from "../components/WorktreeDetails";
import { requestNumber } from "../lib/pullRequests";
import { openInBrowser } from "../lib/weblinks";
import { DIFF_SECTION } from "./settingsSections";
import type { FileViews } from "./useFileViews";
import type { Highlight } from "./useHighlight";

interface Props {
  snapshot: RepoSnapshot;
  views: FileViews;
  highlight: Highlight;
  run: (action: Action) => void | Promise<unknown>;
  hasCommit: (id: string) => boolean;
  select: (id: string) => void;
  /** Say that a commit isn't loaded. */
  notLoaded: () => void;
  openSettings: (section?: string) => void;
  locks: Lock[] | null;
  overlaps: Overlap[];
  teamOpen: boolean;
  onCloseTeam: () => void;
  request: PullRequest | null;
  onCloseRequest: () => void;
  /** The open pull request's details, as its site says, each time they're read. */
  onRequestDetails: (details: RequestDetails | null) => void;
  /** The open pull request's conversation, each time it's read, and what to do after a reply in its files' changes. */
  onRequestConversation: (conversation: RequestConversation | null, onReplied: (message: string) => void) => void;
  /** As last read: its comments on lines show at those lines in its files' changes. */
  requestConversation: { conversation: RequestConversation; onReplied: (message: string) => void } | null;
  notify: (text: string) => void;
  /** A branch whose rewrite is shown: what changed when it was rebased or force-pushed. */
  rewrite: RewriteShown | null;
  onShowRewrite: (rewrite: RewriteShown) => void;
  onCloseRewrite: () => void;
  /** A commit whose checks are shown, each run as a graph of its jobs. */
  checksOf: ChecksOf | null;
  /** Show a commit's checks, like a pull request's latest commit's. */
  onShowChecks: (commit: ChecksOf) => void;
  onCloseChecks: () => void;
}

/** A branch (like "origin/fix/door") and the branch it's on top of (found when null). */
export interface RewriteShown {
  branch: string;
  base: string | null;
}

/** What shows over the commit list: a file's changes, who changed each line, team activity, a pull request, a commit's checks. */
export function ListOverlays({
  snapshot,
  views,
  highlight,
  run,
  hasCommit,
  select,
  notLoaded,
  openSettings,
  locks,
  overlaps,
  teamOpen,
  onCloseTeam,
  request,
  onCloseRequest,
  onRequestDetails,
  onRequestConversation,
  requestConversation,
  notify,
  rewrite,
  onShowRewrite,
  onCloseRewrite,
  checksOf,
  onShowChecks,
  onCloseChecks,
}: Props) {
  const { shownDiff, diffTargets, diffIndex, stepDiff, closeDiff, showBlame, blameAt, closeBlame } = views;
  // A file's changes show over what was opened since, except one of the open pull request's
  // files: that shows over the pull request, with a way back to it.
  const overRequest = Boolean(request && views.overRequest);
  // Its comments on lines show at those lines in its files' changes, with a way to reply.
  const review: ReviewNotes | undefined =
    request && overRequest && requestConversation
      ? {
          repoPath: snapshot.path,
          number: request.number,
          comments: requestConversation.conversation.comments,
          canReply: Boolean(requestConversation.conversation.you),
          openUrl: openInBrowser,
          onReplied: requestConversation.onReplied,
        }
      : undefined;
  const diff = shownDiff && (
    <DiffView
      repoPath={snapshot.path}
      targets={diffTargets}
      index={diffIndex}
      onIndex={stepDiff}
      onClose={closeDiff}
      run={run}
      version={snapshot.worktree}
      onChooseTool={() => openSettings(DIFF_SECTION)}
      sides={conflictSides(snapshot)}
      onBlame={(target) => showBlame(target.file.path, target.source)}
      back={request && overRequest ? { label: `${requestNumber(request)} ${request.title}`, onBack: closeDiff } : undefined}
      review={review}
    />
  );
  return (
    <>
      {!overRequest && diff}
      {teamOpen && (
        <TeamView
          repoPath={snapshot.path}
          version={snapshot.commits}
          user={snapshot.user}
          locks={locks}
          overlaps={overlaps}
          onClose={onCloseTeam}
          onShowBranch={(branch) => {
            if (!hasCommit(branch.tip)) {
              notLoaded();
              return;
            }
            highlight.highlightHistory(branch.name, branch.tip);
            onCloseTeam();
          }}
          onShowPerson={(name, email) => {
            highlight.highlightAuthor(name, email);
            onCloseTeam();
          }}
        />
      )}
      {request && (
        <PullRequestView
          repoPath={snapshot.path}
          request={request}
          onClose={onCloseRequest}
          openUrl={openInBrowser}
          hasCommit={hasCommit}
          notify={notify}
          onShowRewrite={(branch, base) => onShowRewrite({ branch: `${request.remote}/${branch}`, base: `${request.remote}/${base}` })}
          onShowChecks={(id, summary) => onShowChecks({ id, summary })}
          onDetails={onRequestDetails}
          onConversation={onRequestConversation}
          onShowBranch={(branch) => {
            const ref = snapshot.commits.find((commit) => commit.refs.some((r) => r.kind === "branch" && (r.name === `${request.remote}/${branch}` || r.name === branch)));
            if (!ref) {
              notLoaded();
              return;
            }
            highlight.highlightHistory(branch, ref.id);
            onCloseRequest();
          }}
        />
      )}
      {overRequest && diff}
      {rewrite && <RewriteView repoPath={snapshot.path} branch={rewrite.branch} base={rewrite.base} onClose={onCloseRewrite} />}
      {checksOf && <ChecksView repoPath={snapshot.path} commit={checksOf} onClose={onCloseChecks} openUrl={openInBrowser} notify={notify} />}
      {blameAt && <BlameView repoPath={snapshot.path} path={blameAt.path} at={blameAt.at} onClose={closeBlame} onSelectCommit={select} hasCommit={hasCommit} />}
    </>
  );
}
