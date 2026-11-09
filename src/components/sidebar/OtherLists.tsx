import type { MouseEvent } from "react";
import type { Lock, Submodule, Worktree } from "../../api";
import { describeActor, useActorNames } from "../../lib/actorNames";
import { submoduleName, submoduleNote, submoduleTitle } from "../../lib/submodules";
import { worktreeName, worktreeNote } from "../../lib/worktrees";
import { lockTitle } from "../FileLine";
import { CheckIcon, FolderIcon, LockIcon, SubmoduleIcon } from "../Icons";

interface WorktreeProps {
  worktrees: Worktree[];
  /** Click: the commit it has checked out. */
  onSelect: (commitId: string) => void;
  /** Double-click or Enter: open it in a tab. */
  onOpen: (worktree: Worktree) => void;
  onMenu: (worktree: Worktree, x: number, y: number) => void;
}

/** The repository's working trees, by folder, with what each has checked out. */
export function WorktreeList({ worktrees, onSelect, onOpen, onMenu }: WorktreeProps) {
  return (
    <ul>
      {worktrees.map((worktree) => (
        <li key={worktree.path}>
          <div
            className={`sidebar-item sidebar-worktree${worktree.current ? " current" : ""}${worktree.prunable ? " hidden-ref" : ""}`}
            role="button"
            tabIndex={0}
            title={`${worktree.path}${worktree.prunable ? " (its folder is gone)" : worktree.current ? " (open)" : ""}`}
            onDoubleClick={() => onOpen(worktree)}
            onKeyDown={(event) => event.key === "Enter" && onOpen(worktree)}
            onClick={(event) => (worktree.prunable ? onMenu(worktree, event.clientX, event.clientY) : worktree.head && onSelect(worktree.head))}
            onContextMenu={(event: MouseEvent) => {
              event.preventDefault();
              onMenu(worktree, event.clientX, event.clientY);
            }}
          >
            <span className="sidebar-icon">{worktree.current ? <CheckIcon size={13} /> : <FolderIcon size={13} />}</span>
            <span className="sidebar-name">{worktreeName(worktree)}</span>
            {worktreeNote(worktree) && <span className="sidebar-lock-owner">{worktreeNote(worktree)}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

interface SubmoduleProps {
  submodules: Submodule[];
  /** Double-click or Enter: open it in a tab. */
  onOpen: (submodule: Submodule) => void;
  /** Click or right-click: what can be done with it. */
  onMenu: (submodule: Submodule, x: number, y: number) => void;
}

/** The repository's submodules, each with a word on where it is when that needs doing something about. */
export function SubmoduleList({ submodules, onOpen, onMenu }: SubmoduleProps) {
  return (
    <ul>
      {submodules.map((submodule) => {
        const note = submoduleNote(submodule);
        return (
          <li key={submodule.path}>
            <div
              className={`sidebar-item sidebar-submodule ${submodule.state}${submodule.state === "notSetUp" ? " hidden-ref" : ""}`}
              role="button"
              tabIndex={0}
              title={submoduleTitle(submodule)}
              onDoubleClick={() => submodule.state !== "notSetUp" && onOpen(submodule)}
              onKeyDown={(event) => event.key === "Enter" && submodule.state !== "notSetUp" && onOpen(submodule)}
              onClick={(event) => onMenu(submodule, event.clientX, event.clientY)}
              onContextMenu={(event: MouseEvent) => {
                event.preventDefault();
                onMenu(submodule, event.clientX, event.clientY);
              }}
            >
              <span className="sidebar-icon">
                <SubmoduleIcon size={13} />
              </span>
              <span className="sidebar-name">{submoduleName(submodule)}</span>
              {note && <span className="sidebar-lock-owner submodule-note">{note}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

interface LockProps {
  repoPath: string;
  locks: Lock[];
  /** Why the locks couldn't be refreshed. */
  error: string | null;
  onMenu: (lock: Lock, x: number, y: number) => void;
}

/** Files locked with Git LFS, and who holds each. */
export function LockedFileList({ repoPath, locks, error, onMenu }: LockProps) {
  // Unreal actors saved in their own files, named as they are in the editor.
  const actors = useActorNames(repoPath, null, null, locks);
  return (
    <ul>
      {locks.map((lock) => (
        <li key={lock.id}>
          <div
            className={`sidebar-item sidebar-locked${lock.mine ? " mine" : ""}`}
            role="button"
            tabIndex={0}
            title={`${lock.path}${actors.has(lock.path) ? `\n${describeActor(actors.get(lock.path)!)}` : ""}\n${lockTitle(lock)}`}
            onClick={(event) => onMenu(lock, event.clientX, event.clientY)}
            onContextMenu={(event: MouseEvent) => {
              event.preventDefault();
              onMenu(lock, event.clientX, event.clientY);
            }}
          >
            <span className="sidebar-icon">
              <LockIcon size={12} />
            </span>
            <span className="sidebar-name">{actors.get(lock.path)?.label ?? actors.get(lock.path)?.class ?? lock.path.split("/").pop()}</span>
            <span className="sidebar-lock-owner">{lock.mine ? "you" : lock.owner}</span>
          </div>
        </li>
      ))}
      {error && (
        <li className="sidebar-empty" title={error}>
          Couldn't refresh the locks
        </li>
      )}
    </ul>
  );
}
