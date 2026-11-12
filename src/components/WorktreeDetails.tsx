import { stagedMetaWarnings } from "../lib/unityMeta";
import { useState, type ReactNode } from "react";
import type { Action, DiffSource, FileChange, FileChecks, Lock, Overlap, RepoSnapshot } from "../api";
import { ActorNames, useActorNames } from "../lib/actorNames";
import { useUnitySetup } from "./UnitySettingsRows";
import { FILTER_FROM, filterFiles } from "../lib/fileFilter";
import { FileFilter } from "./FileList";
import { CloseIcon, MinusIcon, PlusIcon, ShelfIcon, StashIcon, TrashIcon } from "./Icons";
import { ChangeWarnings } from "./worktree/ChangeWarnings";
import { CommitBox, type CommitDraft } from "./worktree/CommitBox";
import { ConflictList } from "./worktree/ConflictList";
import { ElsewhereWarning } from "./worktree/ElsewhereWarning";
import { FileSection } from "./worktree/FileSection";
import { Button } from "./ui/Button";

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
  onShelve: () => void;
  onDiscard: () => void;
  onClose: () => void;
  /** A file's Git LFS lock. */
  lockOf: (path: string) => Lock | undefined;
  /** Right-click on a file, staged or not. */
  onFileMenu: (file: FileChange, x: number, y: number, source: DiffSource) => void;
  /** Show a file's changes. */
  onOpenFile: (file: FileChange, source: DiffSource) => void;
  /** The file whose changes are shown. */
  isShown: (path: string, source: DiffSource) => boolean;
  /** Big files outside Git LFS and lockable files among the changes. */
  checks: FileChecks | null;
  /** The repository's server supports locking. */
  canLock: boolean;
  /** Help writing the commit message: recent messages and co-authors. */
  messageTools?: ReactNode;
  /** Files you're changing that other branches also changed. */
  overlaps: Overlap[];
  /** Select a commit in the graph. */
  onShowCommit: (id: string) => void;
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
  const opening = { onOpen: props.onOpenFile, isShown: props.isShown };
  const status = snapshot.worktree ?? { staged: [], unstaged: [] };
  // Many changes can be narrowed down (and then staged or unstaged a folder at a time).
  const [query, setQuery] = useState("");
  const total = status.staged.length + status.unstaged.length;
  const filtering = query.trim() !== "" && total > FILTER_FROM;
  // Unreal actors among the files, named as they are in the editor.
  const actors = useActorNames(snapshot.path, null, null, [...status.staged, ...status.unstaged]);
  // In a Unity project, conflicted scenes and prefabs can be merged with Smart Merge.
  const [unity] = useUnitySetup(snapshot.path);
  const staged = filtering ? filterFiles(status.staged, query, actors) : status.staged;
  const allUnstaged = filtering ? filterFiles(status.unstaged, query, actors) : status.unstaged;
  const conflicted = allUnstaged.filter((file) => file.status === "conflicted");
  const unstaged = allUnstaged.filter((file) => file.status !== "conflicted");
  const stagedPaths = new Set(status.staged.map((file) => file.path));
  const quietly = (action: Action) => run(action, { quiet: true });
  const elsewhere = new Map(props.overlaps.map((overlap) => [overlap.path, overlap]));
  const elsewhereOf = (path: string) => elsewhere.get(path);
  /** A renamed file is staged or unstaged with its old path. */
  const paths = (file: FileChange) => (file.oldPath ? [file.oldPath, file.path] : [file.path]);

  return (
    <ActorNames.Provider value={actors}>
      <aside className="details" aria-label="Uncommitted changes">
        <header className="details-header">
          <span className="details-label">Working tree</span>
          <span className="spacer" />
          <Button kind="icon" onClick={props.onShelve} disabled={busy} title="Shelve changes for the team…" aria-label="Shelve changes">
            <ShelfIcon />
          </Button>
          <Button kind="icon" onClick={props.onStash} disabled={busy} title="Stash changes…" aria-label="Stash changes">
            <StashIcon />
          </Button>
          <Button kind="icon" onClick={props.onDiscard} disabled={busy || !snapshot.headCommit} title="Discard all changes…" aria-label="Discard all changes">
            <TrashIcon />
          </Button>
          <Button kind="icon" onClick={props.onClose} title="Close (Esc)" aria-label="Close details">
            <CloseIcon />
          </Button>
        </header>

        <div className="details-scroll worktree">
          <ElsewhereWarning overlaps={props.overlaps} onShow={props.onShowCommit} />
          <ChangeWarnings staged={status.staged} unstaged={status.unstaged} lockOf={lockOf} checks={checks} canLock={props.canLock} busy={busy} run={run} />
          {total > FILTER_FROM && <FileFilter value={query} onChange={setQuery} shown={staged.length + allUnstaged.length} total={total} />}
          {conflicted.length > 0 && (
            <ConflictList
              conflicted={conflicted}
              {...conflictSides(snapshot)}
              busy={busy}
              lockOf={lockOf}
              onFileMenu={onFileMenu}
              run={run}
              elsewhereOf={elsewhereOf}
              smartMerge={unity?.configuredTool ?? unity?.tools[0] ?? null}
              {...opening}
            />
          )}
          <FileSection
            title="Staged"
            files={staged}
            source={{ kind: "staged" }}
            {...opening}
            empty={filtering ? "No staged files match." : "Nothing staged yet. Stage the files you want to commit."}
            bulk={
              filtering
                ? { label: `Unstage these ${staged.length.toLocaleString()}`, onClick: () => quietly({ kind: "unstage", paths: staged.flatMap(paths) }) }
                : { label: "Unstage all", onClick: () => quietly({ kind: "unstageAll" }) }
            }
            lockOf={lockOf}
            onFileMenu={onFileMenu}
            elsewhereOf={elsewhereOf}
            fileAction={(file) => ({ label: "Unstage", icon: <MinusIcon size={13} />, onClick: () => quietly({ kind: "unstage", paths: paths(file) }) })}
            busy={busy}
          />
          <FileSection
            title="Unstaged"
            files={unstaged}
            source={{ kind: "unstaged" }}
            {...opening}
            empty={filtering ? "No other changes match." : "No other changes."}
            bulk={
              filtering
                ? { label: `Stage these ${unstaged.length.toLocaleString()}`, onClick: () => quietly({ kind: "stage", paths: unstaged.flatMap(paths) }) }
                : { label: "Stage all", onClick: () => quietly({ kind: "stageAll" }) }
            }
            lockOf={lockOf}
            onFileMenu={onFileMenu}
            elsewhereOf={elsewhereOf}
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
          namesStaged={(checks?.names ?? []).filter((problem) => stagedPaths.has(problem.path))}
          metasStaged={stagedMetaWarnings(checks?.metas ?? [], status.staged, status.unstaged)}
          busy={busy}
          run={run}
          messageTools={props.messageTools}
        />
      </aside>
    </ActorNames.Provider>
  );
}
