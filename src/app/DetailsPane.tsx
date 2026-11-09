import type { ReactNode } from "react";
import type { CommitRow, DiffSource, FileChange, FileChecks, Lock, Overlap, RepoSnapshot } from "../api";
import { isShown, type ShownDiff } from "../lib/diffTargets";
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
import type { CompareRequest } from "./useComparison";
import { commitLabel } from "../menus/context";

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
  onFileMenu: (file: FileChange, x: number, y: number, source: DiffSource) => void;
  /** Show a file's changes. */
  onOpenFile: (file: FileChange, source: DiffSource) => void;
  /** The file whose changes are shown, if any. */
  shownDiff: ShownDiff | null;
  /** Files you're changing that other branches also changed. */
  overlaps: Overlap[];
  /** A commit to show isn't among the loaded ones. */
  onNotLoaded: () => void;
  /** Compare two commits, in this panel. */
  onCompare: (request: CompareRequest) => void;
  /** Say what was done, briefly. */
  notify: (text: string) => void;
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
        onCompare={
          selectedCommits.length === 2 && selectedCommits.every((commit) => commit.kind === "commit")
            ? () => {
                // The older one first: what changed from it to the newer one.
                const [newer, older] = selectedCommits;
                props.onCompare({ from: { id: older.id, label: commitLabel(older) }, to: { id: newer.id, label: commitLabel(newer) }, split: false });
              }
            : undefined
        }
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
        onShelve={() => props.openDialog({ kind: "shelves" })}
        onDiscard={() => head && props.openDialog({ kind: "reset", target: head })}
        onClose={() => select(null)}
        lockOf={(path) => locks?.get(path)}
        onFileMenu={props.onFileMenu}
        onOpenFile={props.onOpenFile}
        isShown={(path, source) => isShown(props.shownDiff, source, path)}
        checks={props.checks}
        canLock={locks !== null}
        messageTools={props.messageTools}
        overlaps={props.overlaps}
        onShowCommit={(id) => (selection.byId.has(id) ? select(id) : props.onNotLoaded())}
      />
    );
  }
  const source: DiffSource = { kind: "commit", id: selected.id };
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
      onFileMenu={(file, x, y) => props.onFileMenu(file, x, y, source)}
      onOpenFile={(file) => props.onOpenFile(file, source)}
      isShown={(path) => isShown(props.shownDiff, source, path)}
      isHighlighted={props.isHistoryFile}
      lockOf={locks ? (path) => locks.get(path) : undefined}
      notify={props.notify}
    />
  );
}
