// Right-click menus of branch and tag labels (in the graph and the sidebar), and dropping a label on a commit.
import type { Action, CommitRow } from "../api";
import { copyText } from "../lib/clipboard";
import { isNotMergedError } from "../lib/errors";
import { type RefEntry, type RefPill } from "../lib/refs";
import type { MenuItem } from "../components/ContextMenu";
import {
  BranchIcon,
  LockIcon,
  CloudIcon,
  EyeIcon,
  FolderIcon,
  CopyIcon,
  PencilIcon,
  PushIcon,
  TagIcon,
  TrashIcon,
  CompareIcon,
  ResetIcon,
  RebaseIcon,
  NotesIcon } from "../components/Icons";
import { worktreeOf, splitRemoteBranch, headSide, canResetTo, type MenuContext } from "./context";
import { mergeItems, visibilityItems, webItems } from "./shared";
import { stashMenu } from "./commitMenus";

/** The action that checks out a branch label, or null when there's nothing to do. */
export function checkoutFor(_ctx: MenuContext, pill: RefPill, commit: CommitRow): Action | null {
  if (pill.kind === "tag") return { kind: "checkoutCommit", id: commit.id };
  if (pill.kind !== "branch" || pill.current) return null;
  if (pill.local) return { kind: "checkoutBranch", name: pill.name };
  // With a local branch already, it's checked out, and brought up to date when it's only
  // behind (a fast-forward); without one, a local branch tracking it is made.
  return { kind: "checkoutRemoteBranch", name: pill.name };
}

/** Right-click on a branch or tag label. */
export function pillMenu(ctx: MenuContext, pill: RefPill, commit: CommitRow): MenuItem[] {
  if (pill.kind === "stash") return stashMenu(ctx, commit);
  if (pill.kind === "head") return [{ label: "Copy SHA", icon: <CopyIcon />, onSelect: () => copyText(commit.id) }];
  const { canChange, snapshot } = ctx;
  const checkout = checkoutFor(ctx, pill, commit);
  const highlight: MenuItem = {
    label: `Highlight ${pill.name}'s history`,
    icon: <EyeIcon />,
    separated: true,
    onSelect: () => ctx.focus(pill.name, commit.id),
  };
  const head = headSide(snapshot);
  /** Move the checked-out branch here, throwing away what's after (asks first, with what would be lost). */
  const reset: MenuItem[] =
    snapshot.headBranch && canResetTo(snapshot, commit)
      ? [
          {
            label: `Hard reset ${snapshot.headBranch} to ${pill.name}…`,
            icon: <ResetIcon />,
            danger: true,
            separated: true,
            disabled: !canChange,
            onSelect: () => ctx.open({ kind: "reset", target: commit }),
          },
        ]
      : [];
  /** A branch: what it has that the checked-out one doesn't (like a pull request). A tag: what's changed since. */
  const compare: MenuItem[] =
    head && commit.id !== head.id
      ? [
          {
            label: pill.kind === "tag" ? `What's changed in ${head.label} since ${pill.name}` : `Compare with ${head.label}`,
            icon: <CompareIcon />,
            onSelect: () =>
              pill.kind === "tag"
                ? ctx.compare({ from: { id: commit.id, label: pill.name }, to: head, split: false })
                : ctx.compare({ from: head, to: { id: commit.id, label: pill.name }, split: true }),
          },
        ]
      : [];
  // Built on an earlier version of a branch that was rewritten since: move it onto the new one.
  const stacked = pill.kind === "branch" && pill.local ? ctx.stackOf(pill.name) : undefined;
  if (stacked?.moved && stacked.old) {
    const old = stacked.old;
    compare.push({
      label: pill.current ? `Move ${pill.name} onto the new ${stacked.on}` : `Move it onto the new ${stacked.on}: check ${pill.name} out first`,
      icon: <RebaseIcon />,
      disabled: !ctx.canChange || !pill.current || snapshot.operation !== null,
      onSelect: () => ctx.run({ kind: "restack", onto: stacked.on, old }),
    });
  }
  // What changed when it was rebased, amended or force-pushed.
  if (pill.kind === "branch") {
    compare.push({
      label: pill.local ? `What changed when ${pill.name} was rewritten…` : `What changed when ${pill.name} was force-pushed…`,
      icon: <RebaseIcon />,
      onSelect: () => ctx.showRewrite({ branch: pill.name, base: null }),
    });
  }
  if (pill.kind === "tag") {
    const label = commit.refs.find((ref) => ref.kind === "tag" && ref.name === pill.name);
    const remote = snapshot.remotes.includes("origin") ? "origin" : (snapshot.remotes[0] ?? null);
    return [
      {
        label: `Check out ${pill.name} (detached)`,
        icon: <TagIcon />,
        disabled: !canChange || commit.id === snapshot.headCommit,
        onSelect: () => checkout && ctx.run(checkout),
      },
      ...mergeItems(ctx, pill.name, pill.name, commit.id),
      highlight,
      ...compare,
      {
        label: `Release notes for ${pill.name}…`,
        icon: <NotesIcon />,
        onSelect: () => ctx.open({ kind: "releaseNotes", tag: pill.name }),
      },
      ...visibilityItems(ctx, pill),
      ...webItems(ctx, pill),
      ...(remote
        ? [
            {
              label: `Push ${pill.name} to ${remote}`,
              icon: <PushIcon />,
              separated: true,
              disabled: !canChange,
              onSelect: () => ctx.run({ kind: "pushTag", name: pill.name, remote }),
            },
          ]
        : []),
      {
        label: `Delete tag ${pill.name}…`,
        icon: <TrashIcon />,
        danger: true,
        separated: !remote,
        disabled: !canChange,
        onSelect: () => ctx.open({ kind: "deleteTag", name: pill.name, restoreId: label?.target ?? commit.id }),
      },
      ...(remote
        ? [
            {
              label: `Delete ${pill.name} from ${remote}…`,
              icon: <TrashIcon />,
              danger: true,
              disabled: !canChange,
              onSelect: () => ctx.open({ kind: "deleteRemoteTag", name: pill.name, remote }),
            },
          ]
        : []),
      ...reset,
      { label: "Copy tag name", icon: <CopyIcon />, separated: true, onSelect: () => copyText(pill.name) },
    ];
  }

  const items: MenuItem[] = [];
  if (pill.local) {
    const elsewhere = worktreeOf(ctx, pill.name);
    items.push(
      elsewhere
        ? { label: `Open ${pill.name}'s worktree`, icon: <FolderIcon />, onSelect: () => ctx.openWorktree(elsewhere.path) }
        : {
            label: pill.current ? `${pill.name} is checked out` : `Check out ${pill.name}`,
            icon: <BranchIcon />,
            disabled: !canChange || pill.current,
            onSelect: () => checkout && ctx.run(checkout),
          },
      ...(elsewhere || pill.current
        ? []
        : [
            {
              label: "Open in a new worktree…",
              icon: <FolderIcon />,
              disabled: !canChange,
              onSelect: () => ctx.open({ kind: "newWorktree", branch: pill.name, start: commit }),
            },
          ]),
      {
        label: `Rename ${pill.name}…`,
        icon: <PencilIcon />,
        disabled: !canChange,
        onSelect: () => ctx.open({ kind: "rename", branch: pill.name }),
      },
      {
        label: ctx.protectedBranches.includes(pill.name) ? `Unprotect ${pill.name}` : `Protect ${pill.name}`,
        icon: <LockIcon />,
        onSelect: () => ctx.toggleProtected(pill.name),
      },
      {
        label: ctx.protectedBranches.includes(pill.name) ? `Delete ${pill.name} (protected)` : `Delete ${pill.name}…`,
        icon: <TrashIcon />,
        danger: true,
        disabled: !canChange || pill.current || ctx.protectedBranches.includes(pill.name),
        onSelect: () => ctx.open({ kind: "deleteBranch", branch: pill.name, commitId: commit.id }),
      },
    );
  } else {
    const { branch } = splitRemoteBranch(pill.name, snapshot.remotes);
    items.push({
      label: ctx.localBranches.has(branch) ? `Check out ${branch}` : `Check out ${branch} (tracking ${pill.name})`,
      icon: <CloudIcon />,
      disabled: !canChange,
      onSelect: () => checkout && ctx.run(checkout),
    });
  }
  if (!pill.current) items.push(...mergeItems(ctx, pill.name, pill.name, commit.id));
  items.push(highlight, ...compare, ...visibilityItems(ctx, pill), ...webItems(ctx, pill));
  // Remote copies of this branch at the same commit.
  const remoteNames = pill.local ? pill.remotes.map((remote) => `${remote}/${pill.name}`) : [pill.name];
  remoteNames.forEach((name, i) => {
    const { remote, branch } = splitRemoteBranch(name, snapshot.remotes);
    const guarded = ctx.protectedBranches.includes(branch);
    items.push({
      label: guarded ? `Delete ${branch} from ${remote} (protected)` : `Delete ${branch} from ${remote}…`,
      icon: <TrashIcon />,
      danger: true,
      separated: i === 0,
      disabled: !canChange || guarded,
      onSelect: () => ctx.open({ kind: "deleteRemoteBranch", name }),
    });
  });
  if (!pill.current) items.push(...reset);
  items.push({
    label: "Copy branch name",
    icon: <CopyIcon />,
    separated: true,
    onSelect: () => copyText(pill.local ? pill.name : splitRemoteBranch(pill.name, snapshot.remotes).branch),
  });
  return items;
}

/** A sidebar entry, as the label it stands for. */
export function pillForEntry(entry: RefEntry): RefPill {
  return {
    key: `${entry.kind}:${entry.name}`,
    name: entry.name,
    kind: entry.kind === "remote" ? "branch" : entry.kind,
    local: entry.kind === "branch",
    // Its copies on remotes, so its menu offers them too (delete from origin; hide both).
    remotes: entry.kind === "branch" ? (entry.remotes ?? []) : [],
    current: entry.current,
  };
}

/** Menu for a label dropped onto a commit: merge or rebase. */
export function dropMenu(ctx: MenuContext, revision: string): MenuItem[] {
  return mergeItems(ctx, revision, revision).map((item) => ({ ...item, separated: false }));
}

/** Delete-branch confirmations offer "Delete anyway" when git refuses an unmerged branch. */
export function deleteAnyway(branch: string) {
  return (error: string) =>
    isNotMergedError(error)
      ? { label: "Delete anyway", action: { kind: "deleteBranch", name: branch, force: true } as Action }
      : null;
}

