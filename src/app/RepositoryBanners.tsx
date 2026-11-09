import { cancelAction, WORKTREE_ID, type RepoSnapshot } from "../api";
import { hookFailure } from "../lib/errors";
import { usePresence } from "../lib/usePresence";
import { openInBrowser } from "../lib/weblinks";
import { CloseIcon } from "../components/Icons";
import { LfsHealthBanner } from "../components/LfsHealthBanner";
import { LockReleaseBanner } from "../components/LockReleaseBanner";
import { SubmoduleBanner } from "../components/SubmoduleBanner";
import { OperationBar } from "../components/OperationBar";
import { BisectBar } from "../components/BisectBar";
import { ProgressStrip } from "../components/ProgressStrip";
import { ViewBanner } from "../components/ViewBanner";
import { conflictSides } from "../components/WorktreeDetails";
import type { Actions } from "./useActions";
import type { Highlight } from "./useHighlight";
import type { LfsHealthState } from "./useLfsHealth";
import type { LockRelease } from "./useLockRelease";
import type { Repository } from "./useRepository";
import type { RepositorySettings } from "./useRepositorySettings";
import type { Selection } from "./useSelection";
import type { Submodules } from "./useSubmodules";

interface Props {
  snapshot: RepoSnapshot;
  repo: Repository;
  actions: Actions;
  selection: Selection;
  highlight: Highlight;
  settings: RepositorySettings;
  lfsHealth: LfsHealthState;
  lockRelease: LockRelease;
  /** Release locks after every push from now on. */
  alwaysReleaseLocks: () => void;
  submodules: Submodules;
  /** Update submodules after every checkout and pull from now on (null when that's already so). */
  alwaysUpdateSubmodules: (() => void) | null;
  /** Turn off "only the checked-out branch's own history". */
  showWholeHistory: () => void;
  /** Open another working tree, in its tab. */
  openWorktree: (path: string) => void;
  /** A commit was made from here (without hooks): the message box starts empty again. */
  onCommitted: () => void;
}

/**
 * The bars between the toolbar and the commit list: progress, a merge or rebase that
 * stopped, the last error, Git LFS trouble, and what part of the history is shown.
 */
export function RepositoryBanners(props: Props) {
  const { snapshot, repo, actions, selection, highlight, settings, lfsHealth, lockRelease, showWholeHistory, openWorktree } = props;
  const { act, running, progress } = actions;
  const { error, setError } = repo;
  const hook = error ? hookFailure(error.message) : null;
  const { focus } = highlight;
  const branchLabel = snapshot.headBranch ?? "HEAD";
  const conflicted = (snapshot.worktree?.unstaged ?? []).filter((file) => file.status === "conflicted").map((file) => file.path);

  // The progress bar slides open and closed, easing what's under it down and back up.
  const strip = usePresence(
    Boolean(progress?.visible),
    progress?.visible ? <ProgressStrip label={progress.label} progress={progress.value} onCancel={progress.cancellable ? () => cancelAction().catch(() => {}) : undefined} /> : null,
    180,
  );
  return (
    <>
      {strip.shown && (
        <div className={`slide-down${strip.closing ? " closing" : ""}`}>
          <div>{strip.content}</div>
        </div>
      )}
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
      {snapshot.bisect && (
        <BisectBar
          bisect={snapshot.bisect}
          testing={snapshot.headCommit ? { id: snapshot.headCommit, commit: selection.byId.get(snapshot.headCommit) } : null}
          found={snapshot.bisect.found ? selection.byId.get(snapshot.bisect.found) : undefined}
          busy={running !== null}
          onMark={(verdict) => act({ kind: "bisectMark", verdict, id: null })}
          onStop={() => act({ kind: "bisectReset" })}
          onShow={(id) => (selection.byId.has(id) ? selection.select(id) : repo.setError({ message: "That commit isn't loaded: load more commits" }))}
        />
      )}
      {error && hook && (
        <div className="error-banner inline hook-failure" role="alert">
          <div className="hook-failure-text">
            <strong>
              The {hook.hook} hook stopped the {hook.what}
            </strong>
            {hook.output ? <pre className="hook-output mono">{hook.output}</pre> : <span> without saying why.</span>}
          </div>
          {error.skipHooks && (
            <button
              className="error-action"
              disabled={running !== null}
              title={`Run it again without the repository's ${hook.what === "commit" ? "pre-commit and commit-msg hooks" : "pre-push hook"}: their checks are skipped this once`}
              onClick={() =>
                act(error.skipHooks!).then((done) => {
                  if (done && error.skipHooks?.kind === "commit") props.onCommitted();
                })
              }
            >
              {hook.what === "commit" ? "Commit anyway (skip hooks)" : "Push anyway (skip hooks)"}
            </button>
          )}
          <button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      {error && !hook && (
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
      {lockRelease.offered.length > 0 && (
        <LockReleaseBanner
          locks={lockRelease.offered}
          busy={running !== null}
          onRelease={lockRelease.release}
          onKeep={lockRelease.keep}
          onAlways={props.alwaysReleaseLocks}
        />
      )}
      {props.submodules.notice && !snapshot.operation && (
        <SubmoduleBanner
          notice={props.submodules.notice}
          busy={running !== null}
          onUpdate={() => props.submodules.update(props.submodules.notice!.paths)}
          onDismiss={props.submodules.dismiss}
          onAlways={props.submodules.notice.action.startsWith("Update") ? props.alwaysUpdateSubmodules : null}
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
