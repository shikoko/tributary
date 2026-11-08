import type { Action, CommitRow, RepoSnapshot, Submodule, Worktree } from "../api";
import type { DetailsAction } from "../components/CommitDetails";
import type { ColumnOptions } from "../components/CommitList";
import type { MenuItem } from "../components/ContextMenu";
import { BroomIcon, ColumnsIcon, CopyIcon, DownloadIcon, FolderIcon, PlusIcon, PushIcon, ResetIcon, StashIcon, SubmoduleIcon, TrashIcon } from "../components/Icons";
import { copyText } from "../lib/clipboard";
import { isMac } from "../lib/platform";
import { stashIndexOf } from "../lib/refs";
import { canResetTo, type OpenDialog } from "../menus";

/** The menu next to Push. */
export function pushMenuItems(push: () => void, openDialog: (dialog: OpenDialog) => void): MenuItem[] {
  return [
    { label: "Push", icon: <PushIcon />, onSelect: push },
    { label: "Force push…", icon: <PushIcon />, danger: true, separated: true, onSelect: () => openDialog({ kind: "forcePush" }) },
  ];
}

/** Right-click on the column headings: which columns, and how dates are shown. */
export function columnMenuItems(
  options: ColumnOptions,
  setOptions: (options: ColumnOptions) => void,
  daySeparators: boolean,
  setDaySeparators: (on: boolean) => void,
): MenuItem[] {
  const toggle = (key: "author" | "date" | "sha") => setOptions({ ...options, [key]: !options[key] });
  return [
    { label: "Author", icon: <ColumnsIcon />, checked: options.author, onSelect: () => toggle("author") },
    { label: "Date", icon: <ColumnsIcon />, checked: options.date, onSelect: () => toggle("date") },
    { label: "SHA", icon: <ColumnsIcon />, checked: options.sha, onSelect: () => toggle("sha") },
    {
      label: "Relative dates (“3 hours ago”)",
      separated: true,
      checked: options.dateFormat === "relative",
      disabled: !options.date,
      onSelect: () => setOptions({ ...options, dateFormat: "relative" }),
    },
    {
      label: "Exact dates and times",
      checked: options.dateFormat === "exact",
      disabled: !options.date,
      onSelect: () => setOptions({ ...options, dateFormat: "exact" }),
    },
    {
      label: "When it was written (author date)",
      separated: true,
      checked: options.dateKind === "authored",
      disabled: !options.date,
      onSelect: () => setOptions({ ...options, dateKind: "authored" }),
    },
    {
      label: "When it was committed (commit date)",
      checked: options.dateKind === "committed",
      disabled: !options.date,
      onSelect: () => setOptions({ ...options, dateKind: "committed" }),
    },
    { label: "Day separators", separated: true, checked: daySeparators, onSelect: () => setDaySeparators(!daySeparators) },
  ];
}

/** The buttons under a commit's (or stash's) details. */
export function detailsActionsFor(
  commit: CommitRow,
  snapshot: RepoSnapshot,
  canChange: boolean,
  run: (action: Action) => void,
  openDialog: (dialog: OpenDialog) => void,
): DetailsAction[] {
  if (commit.kind === "stash") {
    const index = stashIndexOf(commit);
    if (index === null || !canChange) return [];
    return [
      { label: "Apply", icon: <StashIcon size={14} />, onClick: () => run({ kind: "stashApply", index, id: commit.id }) },
      { label: "Pop", icon: <StashIcon size={14} />, onClick: () => run({ kind: "stashPop", index, id: commit.id }) },
      {
        label: "Drop…",
        icon: <TrashIcon size={14} />,
        danger: true,
        onClick: () => openDialog({ kind: "dropStash", index, id: commit.id, label: `stash@{${index}}` }),
      },
    ];
  }
  if (!canChange || !canResetTo(snapshot, commit)) return [];
  return [
    {
      label: `Hard reset ${snapshot.headBranch ?? "HEAD"} to this commit…`,
      icon: <ResetIcon size={14} />,
      danger: true,
      onClick: () => openDialog({ kind: "reset", target: commit }),
    },
  ];
}

/** What the menu of a working tree in the sidebar needs. */
export interface WorktreeMenuContext {
  canChange: boolean;
  open: (path: string) => void;
  reveal: (path: string) => void;
  remove: (worktree: Worktree) => void;
  /** Forget the working trees whose folders are gone. */
  prune: () => void;
}

/** A working tree in the sidebar: open it, show its folder, or remove it. */
export function worktreeMenuItems(worktree: Worktree, ctx: WorktreeMenuContext): MenuItem[] {
  if (worktree.prunable) {
    return [{ label: "Forget worktrees whose folders are gone", icon: <BroomIcon />, disabled: !ctx.canChange, onSelect: ctx.prune }];
  }
  return [
    { label: worktree.current ? "This worktree is open" : "Open", icon: <FolderIcon />, disabled: worktree.current, onSelect: () => ctx.open(worktree.path) },
    { label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, onSelect: () => ctx.reveal(worktree.path) },
    { label: "Copy path", icon: <CopyIcon />, onSelect: () => copyText(worktree.path) },
    {
      label: worktree.main ? "The main worktree stays" : worktree.current ? "Remove (open another one first)" : "Remove worktree…",
      icon: <TrashIcon />,
      danger: true,
      separated: true,
      disabled: !ctx.canChange || worktree.main || worktree.current || worktree.locked,
      onSelect: () => ctx.remove(worktree),
    },
  ];
}

/** What the submodule menu needs from the app. */
export interface SubmoduleMenuContext {
  canChange: boolean;
  /** Open it in a tab. */
  open: (submodule: Submodule) => void;
  update: (paths: string[]) => void;
  /** Stage it: record the commit it's at. */
  stage: (path: string) => void;
  reveal: (submodule: Submodule) => void;
}

/** A submodule in the sidebar: open it, bring it to the commit recorded for it, or record where it is. */
export function submoduleMenuItems(submodule: Submodule, ctx: SubmoduleMenuContext): MenuItem[] {
  const items: MenuItem[] = [];
  const { state } = submodule;
  if (state === "notSetUp") {
    items.push({ label: "Set it up (clone it here)", icon: <DownloadIcon />, disabled: !ctx.canChange, onSelect: () => ctx.update([submodule.path]) });
  } else {
    items.push({ label: "Open in a new tab", icon: <SubmoduleIcon />, onSelect: () => ctx.open(submodule) });
    if (state === "behind" || state === "different" || state === "ahead") {
      items.push({
        label: "Update it to the recorded commit",
        icon: <DownloadIcon />,
        separated: true,
        disabled: !ctx.canChange || submodule.changed,
        onSelect: () => ctx.update([submodule.path]),
      });
    }
    if (state === "ahead" || state === "different" || state === "conflicted") {
      items.push({
        label: "Stage it, to record the commit it's at",
        icon: <PlusIcon />,
        separated: state === "conflicted",
        disabled: !ctx.canChange,
        onSelect: () => ctx.stage(submodule.path),
      });
    }
    items.push({ label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, separated: true, onSelect: () => ctx.reveal(submodule) });
  }
  items.push({ label: "Copy path", icon: <CopyIcon />, separated: state === "notSetUp", onSelect: () => copyText(submodule.path) });
  if (submodule.url) items.push({ label: "Copy its address", icon: <CopyIcon />, onSelect: () => copyText(submodule.url!) });
  return items;
}
