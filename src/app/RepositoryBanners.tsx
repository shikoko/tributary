import { cancelAction, WORKTREE_ID, type RepoSnapshot } from "../api";
import { openInBrowser } from "../lib/weblinks";
import { CloseIcon } from "../components/Icons";
import { LfsHealthBanner } from "../components/LfsHealthBanner";
import { OperationBar } from "../components/OperationBar";
import { ProgressStrip } from "../components/ProgressStrip";
import { ViewBanner } from "../components/ViewBanner";
import { conflictSides } from "../components/WorktreeDetails";
import type { Actions } from "./useActions";
import type { Highlight } from "./useHighlight";
import type { LfsHealthState } from "./useLfsHealth";
import type { Repository } from "./useRepository";
import type { RepositorySettings } from "./useRepositorySettings";
import type { Selection } from "./useSelection";

interface Props {
  snapshot: RepoSnapshot;
  repo: Repository;
  actions: Actions;
  selection: Selection;
  highlight: Highlight;
  settings: RepositorySettings;
  lfsHealth: LfsHealthState;
  /** Turn off "only the checked-out branch's own history". */
  showWholeHistory: () => void;
  /** Open another working tree, in its tab. */
  openWorktree: (path: string) => void;
}

/**
 * The bars between the toolbar and the commit list: progress, a merge or rebase that
 * stopped, the last error, Git LFS trouble, and what part of the history is shown.
 */
export function RepositoryBanners({ snapshot, repo, actions, selection, highlight, settings, lfsHealth, showWholeHistory, openWorktree }: Props) {
  const { act, running, progress } = actions;
  const { error, setError } = repo;
  const { focus } = highlight;
  const branchLabel = snapshot.headBranch ?? "HEAD";
  const conflicted = (snapshot.worktree?.unstaged ?? []).filter((file) => file.status === "conflicted").map((file) => file.path);

  return (
    <>
      {progress?.visible && <ProgressStrip label={progress.label} progress={progress.value} onCancel={() => cancelAction().catch(() => {})} />}
      {snapshot.operation && (
        <OperationBar
          operation={snapshot.operation}
          branch={snapshot.operation.branch ?? branchLabel}
          conflicts={conflicted.length}
          sides={conflictSides(snapshot)}
          onKeepAll={(keep) => act({ kind: "resolveConflicts", paths: conflicted, keep })}
          busy={running !== null}
          onContinue={() => act({ kind: "continueOperation" })}
          onSkip={() => act({ kind: "skipCommit" })}
          onAbort={() => act({ kind: "abortOperation" })}
          onShowFiles={() => selection.select(WORKTREE_ID)}
        />
      )}
      {error && (
        <div className="error-banner inline" role="alert">
          <span>{error.message}</span>
          {error.retry && (
            <button className="error-action" onClick={() => act(error.retry!)} disabled={running !== null}>
              Stash changes and retry
            </button>
          )}
          {error.worktree && (
            <button className="error-action" onClick={() => openWorktree(error.worktree!)}>
              Open that worktree
            </button>
          )}
          <button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      {lfsHealth.notice && (
        <LfsHealthBanner
          health={lfsHealth.notice}
          busy={running !== null}
          onDownload={() => act({ kind: "downloadLfsFiles" }, "download")}
          onSetUp={() => act({ kind: "setUpLfs" }, "download")}
          onGetLfs={() => openInBrowser("https://git-lfs.com")}
          onDismiss={lfsHealth.dismiss}
        />
      )}
      {(focus || snapshot.firstParent || settings.soloing) && (
        <ViewBanner
          focus={focus}
          firstParent={snapshot.firstParent}
          solo={settings.visibility.solo}
          branchLabel={branchLabel}
          mine={highlight.highlightingMine}
          focusedCount={highlight.focusIds?.size ?? 0}
          pathMatches={highlight.pathMatches}
          selectedIndex={selection.selectedIndex}
          onStep={highlight.stepHistory}
          onShowEverything={() => (focus ? highlight.clear() : snapshot.firstParent ? showWholeHistory() : settings.showAllBranches())}
        />
      )}
    </>
  );
}
