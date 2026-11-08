import type { Action, Lock, Overlap, PullRequest, RepoSnapshot } from "../api";
import { BlameView } from "../components/BlameView";
import { DiffView } from "../components/diff/DiffView";
import { PullRequestView } from "../components/PullRequestView";
import { TeamView } from "../components/TeamView";
import { conflictSides } from "../components/WorktreeDetails";
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
}

/** What shows over the commit list: a file's changes, who changed each line, team activity, a pull request. */
export function ListOverlays({ snapshot, views, highlight, run, hasCommit, select, notLoaded, openSettings, locks, overlaps, teamOpen, onCloseTeam, request, onCloseRequest }: Props) {
  const { shownDiff, diffTargets, diffIndex, stepDiff, closeDiff, showBlame, blameAt, closeBlame } = views;
  return (
    <>
      {shownDiff && (
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
        />
      )}
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
      {blameAt && <BlameView repoPath={snapshot.path} path={blameAt.path} at={blameAt.at} onClose={closeBlame} onSelectCommit={select} hasCommit={hasCommit} />}
    </>
  );
}
