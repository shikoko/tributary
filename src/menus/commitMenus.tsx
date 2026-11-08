// Right-click menus of commit rows: a commit, several selected commits, the uncommitted changes and a stash.
import type { CommitRow } from "../api";
import { copyText } from "../lib/clipboard";
import { stashIndexOf } from "../lib/refs";
import { commitUrl, siteName, webRemote } from "../lib/weblinks";
import type { MenuItem } from "../components/ContextMenu";
import {
  BranchIcon,
  BranchPlusIcon,
  CherryIcon,
  CloudIcon,
  EyeIcon,
  FolderIcon,
  RevertIcon,
  CommitIcon,
  CopyIcon,
  ExternalLinkIcon,
  RewriteIcon,
  FixupIcon,
  UserIcon,
  MinusIcon,
  PlusIcon,
  ResetIcon,
  StashIcon,
  TagIcon,
  TrashIcon,
  CompareIcon } from "../components/Icons";
import { worktreeOf, canResetTo, splitRemoteBranch, commitLabel, headSide, type MenuContext } from "./context";

/** Right-click while several commits are selected. */
export function selectionMenu(ctx: MenuContext, commits: CommitRow[]): MenuItem[] {
  const branch = ctx.snapshot.headBranch;
  const blocked = !ctx.canChange || !branch || ctx.snapshot.operation !== null || commits.some((c) => c.kind !== "commit" || c.parents.length > 1);
  const oldestFirst = [...commits].reverse().map((commit) => commit.id);
  const compare: MenuItem[] =
    commits.length === 2 && commits.every((commit) => commit.kind === "commit")
      ? [
          {
            label: "Compare these two commits",
            icon: <CompareIcon />,
            // The older one first: what changed from it to the newer one.
            onSelect: () =>
              ctx.compare({ from: { id: commits[1].id, label: commitLabel(commits[1]) }, to: { id: commits[0].id, label: commitLabel(commits[0]) }, split: false }),
          },
        ]
      : [];
  return [
    ...compare,
    {
      label: `Cherry-pick ${commits.length} commits onto ${branch ?? "HEAD"}`,
      separated: compare.length > 0,
      icon: <CherryIcon />,
      disabled: blocked,
      onSelect: () => ctx.run({ kind: "cherryPickMany", ids: oldestFirst }),
    },
    {
      label: `Revert ${commits.length} commits`,
      icon: <RevertIcon />,
      disabled: blocked,
      onSelect: () => ctx.run({ kind: "revertMany", ids: commits.map((commit) => commit.id) }),
    },
    {
      label: "Copy SHAs",
      icon: <CopyIcon />,
      separated: true,
      onSelect: () => copyText(commits.map((commit) => commit.id).join("\n")),
    },
  ];
}

/** Right-click on a commit row. */
export function commitMenu(ctx: MenuContext, commit: CommitRow): MenuItem[] {
  if (commit.kind === "worktree") return uncommittedMenu(ctx);
  if (commit.kind === "stash") return stashMenu(ctx, commit);
  const { snapshot, canChange } = ctx;
  const items: MenuItem[] = [{ label: "Copy SHA", icon: <CopyIcon />, onSelect: () => copyText(commit.id) }];
  const remote = webRemote(snapshot);
  const page = remote && commitUrl(remote, commit.id);
  if (page && remote) {
    items.push({ label: `Open on ${siteName(remote)}`, icon: <ExternalLinkIcon />, onSelect: () => ctx.openUrl(page) });
  }

  const checkouts: MenuItem[] = [];
  for (const ref of commit.refs) {
    if (ref.kind === "branch" && !ref.current) {
      const elsewhere = worktreeOf(ctx, ref.name);
      checkouts.push(
        elsewhere
          ? { label: `Open ${ref.name}'s worktree`, icon: <FolderIcon />, onSelect: () => ctx.openWorktree(elsewhere.path) }
          : {
              label: `Check out ${ref.name}`,
              icon: <BranchIcon />,
              disabled: !canChange,
              onSelect: () => ctx.run({ kind: "checkoutBranch", name: ref.name }),
            },
      );
    } else if (ref.kind === "remote") {
      const { branch } = splitRemoteBranch(ref.name, snapshot.remotes);
      if (ctx.localBranches.has(branch)) continue;
      checkouts.push({
        label: `Check out ${branch} (tracking ${ref.name})`,
        icon: <CloudIcon />,
        disabled: !canChange,
        onSelect: () => ctx.run({ kind: "checkoutRemoteBranch", name: ref.name }),
      });
    }
  }
  if (!commit.refs.some((ref) => ref.kind === "branch") && commit.id !== snapshot.headCommit) {
    checkouts.push({
      label: "Check out this commit (detached)",
      icon: <CommitIcon />,
      disabled: !canChange,
      onSelect: () => ctx.run({ kind: "checkoutCommit", id: commit.id }),
    });
  }
  items.push(...checkouts.slice(0, 6).map((item, i) => ({ ...item, separated: i === 0 })));
  items.push({
    label: "New worktree here…",
    icon: <FolderIcon />,
    separated: checkouts.length === 0,
    disabled: !canChange || snapshot.bare,
    onSelect: () => ctx.open({ kind: "newWorktree", start: commit }),
  });
  const busy = !canChange || snapshot.operation !== null;
  const isHead = commit.id === snapshot.headCommit;
  items.push(
    {
      label: `Cherry-pick onto ${snapshot.headBranch ?? "HEAD"}`,
      icon: <CherryIcon />,
      separated: true,
      disabled: busy || isHead,
      onSelect: () => ctx.run({ kind: "cherryPick", id: commit.id }),
    },
    {
      label: "Revert this commit",
      icon: <RevertIcon />,
      disabled: busy,
      onSelect: () => ctx.run({ kind: "revert", id: commit.id }),
    },
    {
      label: "Highlight history up to here",
      icon: <EyeIcon />,
      onSelect: () => ctx.focus(commit.summary || commit.id.slice(0, 7), commit.id),
    },
    ...(() => {
      const head = headSide(snapshot);
      return head && !isHead
        ? [
            {
              label: `Compare with ${head.label}`,
              icon: <CompareIcon />,
              onSelect: () => ctx.compare({ from: head, to: { id: commit.id, label: commitLabel(commit) }, split: false }),
            },
          ]
        : [];
    })(),
    {
      label: `Highlight ${commit.authorName || commit.authorEmail}'s commits`,
      icon: <UserIcon />,
      onSelect: () => ctx.focusAuthor(commit.authorName, commit.authorEmail),
    },
  );
  const rewritable = ctx.rewritable(commit);
  items.push({
    label:
      typeof rewritable === "string"
        ? `Interactive rebase: ${rewritable}`
        : `Interactive rebase of the ${rewritable.length === 1 ? "commit" : `${rewritable.length} commits`} after this…`,
    icon: <RewriteIcon />,
    separated: true,
    disabled: busy || typeof rewritable === "string",
    onSelect: () => typeof rewritable !== "string" && ctx.open({ kind: "interactiveRebase", onto: commit, commits: rewritable }),
  });
  // Folding the staged changes into this commit rewrites it and the commits after it.
  const staged = snapshot.worktree?.staged.length ?? 0;
  const fixupBlocked = !snapshot.headBranch
    ? "check out a branch first"
    : commit.parents.length > 1
      ? "a merge commit can't be fixed up"
      : !isHead && typeof rewritable === "string"
        ? rewritable
        : staged === 0
          ? "stage the changes to fold in first"
          : null;
  items.push({
    label: fixupBlocked ? `Fix up this commit: ${fixupBlocked}` : `Fix up this commit with the staged changes (${staged === 1 ? "1 file" : `${staged} files`})`,
    icon: <FixupIcon />,
    disabled: busy || fixupBlocked !== null,
    onSelect: () => ctx.run({ kind: "fixupInto", id: commit.id }),
  });
  items.push(
    {
      label: "New branch here…",
      icon: <BranchPlusIcon />,
      separated: true,
      disabled: !canChange,
      onSelect: () => ctx.open({ kind: "newBranch", target: commit }),
    },
    {
      label: "New tag here…",
      icon: <TagIcon />,
      disabled: !canChange,
      onSelect: () => ctx.open({ kind: "tag", target: commit }),
    },
    {
      label: `Hard reset ${snapshot.headBranch ?? "HEAD"} to this commit…`,
      icon: <ResetIcon />,
      danger: true,
      separated: true,
      disabled: !canChange || !canResetTo(snapshot, commit),
      onSelect: () => ctx.open({ kind: "reset", target: commit }),
    },
  );
  return items;
}

/** Right-click on the uncommitted changes row. */
export function uncommittedMenu(ctx: MenuContext): MenuItem[] {
  const { snapshot, canChange } = ctx;
  const head = snapshot.commits.find((commit) => commit.id === snapshot.headCommit);
  return [
    { label: "Stage all changes", icon: <PlusIcon />, disabled: !canChange, onSelect: () => ctx.run({ kind: "stageAll" }) },
    {
      label: "Unstage all changes",
      icon: <MinusIcon />,
      disabled: !canChange || !snapshot.worktree?.staged.length,
      onSelect: () => ctx.run({ kind: "unstageAll" }),
    },
    {
      label: "Stash changes…",
      icon: <StashIcon />,
      separated: true,
      disabled: !canChange,
      onSelect: () => ctx.open({ kind: "stash" }),
    },
    {
      label: "Discard all changes…",
      icon: <TrashIcon />,
      danger: true,
      separated: true,
      disabled: !canChange || !head,
      onSelect: () => head && ctx.open({ kind: "reset", target: head }),
    },
  ];
}

/** Right-click on a stash row or label. */
export function stashMenu(ctx: MenuContext, commit: CommitRow): MenuItem[] {
  const index = stashIndexOf(commit);
  const items: MenuItem[] = [];
  if (index !== null) {
    const disabled = !ctx.canChange;
    items.push(
      {
        label: "Apply stash",
        icon: <StashIcon />,
        disabled,
        onSelect: () => ctx.run({ kind: "stashApply", index, id: commit.id }),
      },
      {
        label: "Pop stash",
        icon: <StashIcon />,
        disabled,
        onSelect: () => ctx.run({ kind: "stashPop", index, id: commit.id }),
      },
      {
        label: "Drop stash…",
        icon: <TrashIcon />,
        danger: true,
        disabled,
        onSelect: () => ctx.open({ kind: "dropStash", index, id: commit.id, label: `stash@{${index}}` }),
      },
    );
  }
  items.push({
    label: "Copy SHA",
    icon: <CopyIcon />,
    separated: items.length > 0,
    onSelect: () => copyText(commit.id),
  });
  return items;
}

