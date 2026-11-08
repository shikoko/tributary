import type { ReactNode } from "react";
import type { CommitRow, FileChange, FileChecks, Lock, Overlap, RepoSnapshot } from "../api";
import { webRemote } from "../lib/weblinks";
import type { DetailsAction } from "../components/CommitDetails";
import { CommitDetailsPanel } from "../components/CommitDetails";
import { MultiSelectPanel } from "../components/MultiSelectPanel";
import { WorktreeDetailsPanel } from "../components/WorktreeDetails";
import type { OpenDialog } from "../menus";
import type { Actions } from "./useActions";
import type { CommitDetailsCache } from "./useCommitDetails";
import type { Draft } from "./useDraft";
import type { Selection } from "./useSelection";

interface Props {
  snapshot: RepoSnapshot;
  selection: Selection;
  actions: Actions;
  canChange: boolean;
  draft: Draft;
  details: CommitDetailsCache;
  checks: FileChecks | null;
  /** Git LFS locks by path, or null when the repository doesn't use locking. */
  locks: Map<string, Lock> | null;
  /** In the history of the file or folder being highlighted. */
  isHistoryFile: ((path: string) => boolean) | undefined;
  /** The buttons under a commit's message, like Hard reset. */
  detailsActions: (commit: CommitRow) => DetailsAction[];
  /** Commit message help: recent messages, co-authors. */
  messageTools: ReactNode;
  openDialog: (dialog: OpenDialog) => void;
  onFileMenu: (file: FileChange, x: number, y: number, where: "worktree" | "commit") => void;
  /** Files you're changing that other branches also changed. */
  overlaps: Overlap[];
  /** A commit to show isn't among the loaded ones. */
  onNotLoaded: () => void;
}

/**
 * The details panel's content: several selected commits (pick or revert them all), the
 * uncommitted changes (stage and commit), or one commit.
 */
export function DetailsPane(props: Props) {
  const { snapshot, selection, actions, canChange, draft, details, locks } = props;
  const { selected, selectedCommits, select } = selection;
  const { act, running } = actions;
  if (selection.multi) {
    return (
      <MultiSelectPanel
        commits={selectedCommits}
        branch={snapshot.headBranch}
        canChange={canChange && !snapshot.operation}
        onCherryPick={() => act({ kind: "cherryPickMany", ids: [...selectedCommits].reverse().map((c) => c.id) })}
        onRevert={() => act({ kind: "revertMany", ids: selectedCommits.map((c) => c.id) })}
        onClose={selection.dropMultiple}
      />
    );
  }
  if (!selected) return null;
  if (selected.kind === "worktree") {
    const head = snapshot.headCommit ? selection.byId.get(snapshot.headCommit) : undefined;
    return (
      <WorktreeDetailsPanel
        snapshot={snapshot}
        run={(action, options) => act(action, "other", options)}
        busy={running !== null}
        draft={draft.draft}
        onDraft={draft.setDraft}
        onStash={() => props.openDialog({ kind: "stash" })}
        onDiscard={() => head && props.openDialog({ kind: "reset", target: head })}
        onClose={() => select(null)}
        lockOf={(path) => locks?.get(path)}
        onFileMenu={(file, x, y) => props.onFileMenu(file, x, y, "worktree")}
        checks={props.checks}
        canLock={locks !== null}
        messageTools={props.messageTools}
        overlaps={props.overlaps}
        onShowCommit={(id) => (selection.byId.has(id) ? select(id) : props.onNotLoaded())}
      />
    );
  }
  return (
    <CommitDetailsPanel
      repoPath={snapshot.path}
      commit={selected}
      cache={details.cache.current}
      hasCommit={(id) => selection.indexById.has(id)}
      onSelect={select}
      onClose={() => select(null)}
      actions={props.detailsActions(selected)}
      remote={webRemote(snapshot)}
      resolveCommit={details.resolve}
      onFileMenu={(file, x, y) => props.onFileMenu(file, x, y, "commit")}
      isHighlighted={props.isHistoryFile}
      lockOf={locks ? (path) => locks.get(path) : undefined}
    />
  );
}
