import type { Action, DiffSource, FileChange, FileChecks, Lock, RepoSnapshot } from "../api";
import type { MenuItem } from "../components/ContextMenu";
import {
  CheckIcon,
  CloudIcon,
  CopyIcon,
  DiffIcon,
  ExternalLinkIcon,
  FileHistoryIcon,
  FolderIcon,
  IgnoreIcon,
  LockIcon,
  MergeIcon,
  StashIcon,
  TrashIcon,
  UnlockIcon,
} from "../components/Icons";
import { conflictSides, lfsPattern } from "../components/WorktreeDetails";
import { copyText } from "../lib/clipboard";
import { baseName, folderOf } from "../lib/paths";
import { isMac } from "../lib/platform";
import type { OpenDialog } from "../menus";

/** What the file menus need from the app. */
export interface FileMenuContext {
  snapshot: RepoSnapshot;
  /** False while an action runs, or for a bare repository. */
  canChange: boolean;
  run: (action: Action) => void;
  openDialog: (dialog: OpenDialog) => void;
  showHistory: (path: string) => void;
  /** Git LFS locks by path, or null when the repository doesn't use locking. */
  locks: Map<string, Lock> | null;
  checks: FileChecks | null;
  /** Show a file in Finder or Explorer. */
  reveal: (path: string) => void;
  /** Show a file's changes in the diff view. */
  showChanges: (file: FileChange, source: DiffSource) => void;
}

/** Lock, unlock or force-unlock a file. */
function lockItems(ctx: FileMenuContext, path: string, lock: Lock | undefined, separated: boolean): MenuItem[] {
  const { canChange, run, openDialog } = ctx;
  if (!lock) {
    return [{ label: "Lock file", icon: <LockIcon />, separated, disabled: !canChange, onSelect: () => run({ kind: "lockFiles", paths: [path] }) }];
  }
  if (lock.mine) {
    return [
      {
        label: "Unlock file",
        icon: <UnlockIcon />,
        separated,
        disabled: !canChange,
        onSelect: () => run({ kind: "unlockFiles", locks: [{ id: lock.id, path: lock.path }] }),
      },
    ];
  }
  return [
    { label: `Locked by ${lock.owner || "someone else"}`, icon: <LockIcon />, separated, disabled: true, onSelect: () => {} },
    { label: "Force unlock…", icon: <UnlockIcon />, danger: true, disabled: !canChange, onSelect: () => openDialog({ kind: "forceUnlock", lock }) },
  ];
}

/** Right-click on a file in a commit (a "commit" source) or in your changes (staged or unstaged). */
export function fileMenuItems(ctx: FileMenuContext, file: FileChange, source: DiffSource): MenuItem[] {
  const { snapshot, canChange, run, openDialog, showHistory, locks, checks, reveal } = ctx;
  const where = source.kind === "commit" ? "commit" : "worktree";
  const folder = file.path.endsWith("/");
  const path = file.path.replace(/\/+$/, "");
  const dir = folderOf(path);
  const items: MenuItem[] = [];
  const conflicted = where === "worktree" && file.status === "conflicted";
  if (!folder) {
    items.push(
      { label: "Show changes", icon: <DiffIcon />, onSelect: () => ctx.showChanges(file, source) },
      conflicted
        ? { label: "Open in merge tool", icon: <ExternalLinkIcon />, disabled: !canChange, onSelect: () => run({ kind: "openInMergeTool", path }) }
        : { label: "Open in diff tool", icon: <ExternalLinkIcon />, disabled: file.status === "untracked", onSelect: () => run({ kind: "openInDiffTool", source, path }) },
    );
  }
  if (conflicted) {
    const sides = conflictSides(snapshot);
    items.push(
      {
        label: `Keep mine (${sides.mine})`,
        icon: <CheckIcon />,
        separated: items.length > 0,
        disabled: !canChange,
        onSelect: () => run({ kind: "resolveConflicts", paths: [path], keep: "mine" }),
      },
      { label: `Take theirs (${sides.theirs})`, icon: <MergeIcon />, disabled: !canChange, onSelect: () => run({ kind: "resolveConflicts", paths: [path], keep: "theirs" }) },
    );
  }
  items.push({
    label: folder ? "Show this folder's history" : "Show this file's history",
    icon: <FileHistoryIcon />,
    separated: items.length > 0,
    onSelect: () => showHistory(folder ? `${path}/` : path),
  });
  if (dir) items.push({ label: `Show the history of ${dir}/`, icon: <FolderIcon />, onSelect: () => showHistory(`${dir}/`) });
  if (locks && !folder) items.push(...lockItems(ctx, path, locks.get(path), true));
  if (where === "worktree" && file.status !== "conflicted") {
    const paths = file.oldPath ? [file.oldPath, path] : [path];
    const big = checks?.large.some((large) => large.path === file.path);
    if (big) {
      const pattern = lfsPattern(file.path);
      const staged = snapshot.worktree?.staged.some((other) => other.path === file.path);
      items.push({
        label: `Track ${pattern} with Git LFS`,
        icon: <CloudIcon />,
        separated: true,
        disabled: !canChange,
        onSelect: () => run({ kind: "trackWithLfs", patterns: [pattern], paths: staged ? [file.path] : [] }),
      });
    }
    if (file.status === "untracked") {
      const name = baseName(path);
      const pattern = lfsPattern(path);
      items.push({
        label: folder ? `Ignore the folder ${name}/` : `Ignore ${name}`,
        icon: <IgnoreIcon />,
        separated: !big,
        disabled: !canChange,
        onSelect: () => run({ kind: "ignorePaths", patterns: [folder ? `/${path}/` : `/${path}`] }),
      });
      if (!folder && pattern !== path) {
        items.push({ label: `Ignore all ${pattern} files`, icon: <IgnoreIcon />, disabled: !canChange, onSelect: () => run({ kind: "ignorePaths", patterns: [pattern] }) });
      }
      if (dir) {
        items.push({ label: `Ignore the folder ${dir}/`, icon: <IgnoreIcon />, disabled: !canChange, onSelect: () => run({ kind: "ignorePaths", patterns: [`/${dir}/`] }) });
      }
    }
    items.push(
      {
        label: folder ? "Stash this folder…" : "Stash this file…",
        icon: <StashIcon />,
        separated: true,
        disabled: !canChange,
        onSelect: () => openDialog({ kind: "stash", paths }),
      },
      {
        label: folder ? "Delete this folder" : file.status === "untracked" ? "Delete this file" : "Discard changes",
        icon: <TrashIcon />,
        danger: true,
        disabled: !canChange,
        onSelect: () => run({ kind: "discardFiles", paths }),
      },
    );
  }
  items.push({ label: "Copy path", icon: <CopyIcon />, separated: true, onSelect: () => copyText(path) });
  if (where === "worktree" && file.status !== "deleted") {
    items.push({ label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, onSelect: () => reveal(path) });
  }
  return items;
}

/** A locked file in the sidebar. */
export function lockMenuItems(ctx: FileMenuContext, lock: Lock): MenuItem[] {
  return [
    { label: "Show this file's history", icon: <FileHistoryIcon />, onSelect: () => ctx.showHistory(lock.path) },
    ...lockItems(ctx, lock.path, lock, true),
    { label: "Copy path", icon: <CopyIcon />, separated: true, onSelect: () => copyText(lock.path) },
    { label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, onSelect: () => ctx.reveal(lock.path) },
  ];
}
