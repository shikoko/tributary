import type { ReactNode } from "react";
import type { Action, FileChange, FileChecks, Lock, RepoSnapshot } from "../api";
import { CloseIcon, MinusIcon, PlusIcon, StashIcon, TrashIcon } from "./Icons";
import { ChangeWarnings } from "./worktree/ChangeWarnings";
import { CommitBox, type CommitDraft } from "./worktree/CommitBox";
import { ConflictList } from "./worktree/ConflictList";
import { FileSection } from "./worktree/FileSection";

export { EMPTY_DRAFT, type CommitDraft } from "./worktree/CommitBox";
export { lfsPattern } from "./worktree/ChangeWarnings";

interface Props {
  snapshot: RepoSnapshot;
  /** Runs a git action; resolves to true when it worked. */
  run: (action: Action, options?: { quiet?: boolean }) => Promise<boolean>;
  /** Something is already running. */
  busy: boolean;
  draft: CommitDraft;
  onDraft: (draft: CommitDraft) => void;
  onStash: () => void;
  onDiscard: () => void;
  onClose: () => void;
  /** A file's Git LFS lock. */
  lockOf: (path: string) => Lock | undefined;
  /** Right-click on a file. */
  onFileMenu: (file: FileChange, x: number, y: number) => void;
  /** Big files outside Git LFS and lockable files among the changes. */
  checks: FileChecks | null;
  /** The repository's server supports locking. */
  canLock: boolean;
  /** Help writing the commit message: recent messages and co-authors. */
  messageTools?: ReactNode;
}

/** What the two sides of a conflict are called, for buttons like "Keep main's version". */
export function conflictSides(snapshot: RepoSnapshot): { mine: string; theirs: string } {
  const operation = snapshot.operation;
  return {
    mine: operation?.mine ?? snapshot.headBranch ?? "your branch",
    theirs: operation?.theirs ?? "the other side",
  };
}

/** The "Uncommitted changes" panel: warnings, conflicts, staging files, then committing. */
export function WorktreeDetailsPanel(props: Props) {
  const { snapshot, run, busy, lockOf, onFileMenu, checks } = props;
  const status = snapshot.worktree ?? { staged: [], unstaged: [] };
  const conflicted = status.unstaged.filter((file) => file.status === "conflicted");
  const unstaged = status.unstaged.filter((file) => file.status !== "conflicted");
  const stagedPaths = new Set(status.staged.map((file) => file.path));
  const quietly = (action: Action) => run(action, { quiet: true });
  /** A renamed file is staged or unstaged with its old path. */
  const paths = (file: FileChange) => (file.oldPath ? [file.oldPath, file.path] : [file.path]);

  return (
    <aside className="details" aria-label="Uncommitted changes">
      <header className="details-header">
        <span className="details-label">Working tree</span>
        <span className="spacer" />
        <button className="icon-button" onClick={props.onStash} disabled={busy} title="Stash changes…" aria-label="Stash changes">
          <StashIcon />
        </button>
        <button className="icon-button" onClick={props.onDiscard} disabled={busy || !snapshot.headCommit} title="Discard all changes…" aria-label="Discard all changes">
          <TrashIcon />
        </button>
        <button className="icon-button" onClick={props.onClose} title="Close (Esc)" aria-label="Close details">
          <CloseIcon />
        </button>
      </header>

      <div className="details-scroll worktree">
        <ChangeWarnings staged={status.staged} unstaged={status.unstaged} lockOf={lockOf} checks={checks} canLock={props.canLock} busy={busy} run={run} />
        {conflicted.length > 0 && (
          <ConflictList conflicted={conflicted} {...conflictSides(snapshot)} busy={busy} lockOf={lockOf} onFileMenu={onFileMenu} run={run} />
        )}
        <FileSection
          title="Staged"
          files={status.staged}
          empty="Nothing staged yet. Stage the files you want to commit."
          bulk={{ label: "Unstage all", onClick: () => quietly({ kind: "unstageAll" }) }}
          lockOf={lockOf}
          onFileMenu={onFileMenu}
          fileAction={(file) => ({ label: "Unstage", icon: <MinusIcon size={13} />, onClick: () => quietly({ kind: "unstage", paths: paths(file) }) })}
          busy={busy}
        />
        <FileSection
          title="Unstaged"
          files={unstaged}
          empty="No other changes."
          bulk={{ label: "Stage all", onClick: () => quietly({ kind: "stageAll" }) }}
          lockOf={lockOf}
          onFileMenu={onFileMenu}
          fileAction={(file) => ({ label: "Stage", icon: <PlusIcon size={13} />, onClick: () => quietly({ kind: "stage", paths: paths(file) }) })}
          busy={busy}
        />
      </div>

      <CommitBox
        snapshot={snapshot}
        draft={props.draft}
        onDraft={props.onDraft}
        stagedCount={status.staged.length}
        largeStaged={(checks?.large ?? []).filter((file) => stagedPaths.has(file.path))}
        busy={busy}
        run={run}
        messageTools={props.messageTools}
      />
    </aside>
  );
}
