import type { Action, CommitRow, RepoSnapshot } from "../api";
import type { DetailsAction } from "../components/CommitDetails";
import type { ColumnOptions } from "../components/CommitList";
import type { MenuItem } from "../components/ContextMenu";
import { ColumnsIcon, PushIcon, ResetIcon, StashIcon, TrashIcon } from "../components/Icons";
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
