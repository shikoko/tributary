import type { Action, CommitRow, RepoSnapshot, Visibility } from "./api";
import { copyText } from "./lib/clipboard";
import { isNotMergedError } from "./lib/errors";
import { stashIndexOf, type RefEntry, type RefPill } from "./lib/refs";
import { branchUrl, commitUrl, newPullRequestUrl, siteName, webRemote } from "./lib/weblinks";
import type { MenuItem } from "./components/ContextMenu";
import {
  BranchIcon,
  BranchPlusIcon,
  CherryIcon,
  CloudIcon,
  EyeIcon,
  MergeIcon,
  RebaseIcon,
  RevertIcon,
  CommitIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  PinIcon,
  PullRequestIcon,
  RewriteIcon,
  UserIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  ResetIcon,
  StashIcon,
  PushIcon,
  TagIcon,
  TrashIcon,
} from "./components/Icons";

/** Dialogs the app can show. */
export type OpenDialog =
  | { kind: "reset"; target: CommitRow }
  | { kind: "newBranch"; target: CommitRow }
  | { kind: "forcePush" }
  | { kind: "stash" }
  | { kind: "rename"; branch: string }
  | { kind: "deleteBranch"; branch: string; commitId: string }
  | { kind: "deleteRemoteBranch"; name: string }
  | { kind: "dropStash"; index: number; id: string; label: string }
  | { kind: "tag"; target: CommitRow }
  /** `restoreId`: what the tag points at (its tag object, when annotated), to undo. */
  | { kind: "deleteTag"; name: string; restoreId: string }
  | { kind: "deleteRemoteTag"; name: string; remote: string }
  | { kind: "clone" }
  /** `commits`: the commits after `onto`, newest first. */
  | { kind: "interactiveRebase"; onto: CommitRow; commits: CommitRow[] }
  | null;

/** What the menus need from the app. */
export interface MenuContext {
  snapshot: RepoSnapshot;
  /** False while an action runs, or for a bare repository. */
  canChange: boolean;
  /** Local branch names anywhere in the history. */
  localBranches: Set<string>;
  run: (action: Action) => void;
  open: (dialog: OpenDialog) => void;
  /** Highlight the history of a branch, tag or commit. */
  focus: (name: string, commitId: string) => void;
  /** Highlight everything an author committed. */
  focusAuthor: (name: string, email: string) => void;
  /** Which branches the graph shows. */
  visibility: Visibility;
  /** Hide these refs (full names), or show them again. */
  setHidden: (names: string[], hidden: boolean) => void;
  /** Show only these refs (full names), adding them to what's already soloed. */
  solo: (names: string[]) => void;
  /** Pinned refs in the sidebar (full names). */
  pins: string[];
  togglePin: (name: string) => void;
  /** The commits after `commit` on the checked-out branch, newest first, or why they can't be rewritten. */
  rewritable: (commit: CommitRow) => CommitRow[] | string;
  openUrl: (url: string) => void;
}

/** The full names of the refs a label stands for: a local branch and its remote copies, a remote branch, or a tag. */
export function pillRefNames(pill: RefPill): string[] {
  if (pill.kind === "tag") return [`refs/tags/${pill.name}`];
  if (pill.kind !== "branch") return [];
  if (!pill.local) return [`refs/remotes/${pill.name}`];
  return [`refs/heads/${pill.name}`, ...pill.remotes.map((remote) => `refs/remotes/${remote}/${pill.name}`)];
}

/** Hide, solo and pin entries for a label. */
function visibilityItems(ctx: MenuContext, pill: RefPill): MenuItem[] {
  const names = pillRefNames(pill);
  if (names.length === 0) return [];
  const own = names[0];
  const soloing = ctx.visibility.solo.length > 0;
  const pinned = ctx.pins.includes(own);
  return [
    {
      label: soloing ? `Also show only ${pill.name}` : `Show only ${pill.name}`,
      icon: <EyeIcon />,
      separated: true,
      disabled: names.every((name) => ctx.visibility.solo.includes(name)),
      onSelect: () => ctx.solo(names),
    },
    {
      label: `Hide ${pill.name}`,
      icon: <EyeOffIcon />,
      disabled: pill.current,
      onSelect: () => ctx.setHidden(names, true),
    },
    {
      label: pinned ? `Unpin ${pill.name}` : `Pin ${pill.name} in the sidebar`,
      icon: <PinIcon />,
      onSelect: () => ctx.togglePin(own),
    },
  ];
}

/** "Open on GitHub" and "Create pull request" for a branch, or "Open on GitHub" for a tag. */
function webItems(ctx: MenuContext, pill: RefPill): MenuItem[] {
  const { snapshot } = ctx;
  if (pill.kind === "tag") {
    const remote = webRemote(snapshot);
    const url = remote && branchUrl(remote, pill.name);
    return url && remote ? [{ label: `Open ${pill.name} on ${siteName(remote)}`, icon: <ExternalLinkIcon />, separated: true, onSelect: () => ctx.openUrl(url) }] : [];
  }
  if (pill.kind !== "branch") return [];
  // The remote copy of the branch: the one it tracks, or one with the same name.
  let remoteName: string | undefined;
  let branch = pill.name;
  if (pill.local) {
    const upstream = snapshot.commits.flatMap((c) => c.refs).find((ref) => ref.kind === "branch" && ref.name === pill.name)?.upstream;
    if (upstream) {
      ({ remote: remoteName, branch } = splitRemoteBranch(upstream, snapshot.remotes));
    } else if (pill.remotes.length > 0) {
      remoteName = pill.remotes[0];
    }
  } else {
    ({ remote: remoteName, branch } = splitRemoteBranch(pill.name, snapshot.remotes));
  }
  if (!remoteName) return [];
  const remote = snapshot.webRemotes.find((r) => r.name === remoteName);
  if (!remote) return [];
  const site = siteName(remote);
  const items: MenuItem[] = [];
  const page = branchUrl(remote, branch);
  if (page) items.push({ label: `Open ${branch} on ${site}`, icon: <ExternalLinkIcon />, separated: true, onSelect: () => ctx.openUrl(page) });
  const pullRequest = newPullRequestUrl(remote, branch);
  if (pullRequest) {
    items.push({
      label: remote.host === "gitlab" ? "Create merge request…" : "Create pull request…",
      icon: <PullRequestIcon />,
      separated: !page,
      onSelect: () => ctx.openUrl(pullRequest),
    });
  }
  return items;
}

/** Right-click while several commits are selected. */
export function selectionMenu(ctx: MenuContext, commits: CommitRow[]): MenuItem[] {
  const branch = ctx.snapshot.headBranch;
  const blocked = !ctx.canChange || !branch || ctx.snapshot.operation !== null || commits.some((c) => c.kind !== "commit" || c.parents.length > 1);
  const oldestFirst = [...commits].reverse().map((commit) => commit.id);
  return [
    {
      label: `Cherry-pick ${commits.length} commits onto ${branch ?? "HEAD"}`,
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

/** Merge and rebase entries for a branch, tag or commit, relative to the checked-out branch. */
function mergeItems(ctx: MenuContext, revision: string, label: string): MenuItem[] {
  const branch = ctx.snapshot.headBranch;
  const disabled = !ctx.canChange || !branch || ctx.snapshot.operation !== null;
  return [
    {
      label: `Merge ${label} into ${branch ?? "HEAD"}`,
      icon: <MergeIcon />,
      separated: true,
      disabled,
      onSelect: () => ctx.run({ kind: "merge", target: revision }),
    },
    {
      label: `Rebase ${branch ?? "HEAD"} onto ${label}`,
      icon: <RebaseIcon />,
      disabled,
      onSelect: () => ctx.run({ kind: "rebase", onto: revision }),
    },
  ];
}

/** Whether the checked-out branch can be hard reset to `commit`. */
export function canResetTo(snapshot: RepoSnapshot, commit: CommitRow): boolean {
  if (snapshot.bare || commit.kind !== "commit") return false;
  // Resetting to the current commit only makes sense when there are changes to discard.
  return commit.id !== snapshot.headCommit || snapshot.worktree !== null;
}

/** Splits "origin/feature/x" into the remote and the branch, using the known remote names. */
export function splitRemoteBranch(name: string, remotes: string[]): { remote: string; branch: string } {
  const remote =
    remotes.filter((r) => name.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0] ??
    name.slice(0, Math.max(0, name.indexOf("/")));
  return { remote, branch: name.slice(remote.length + 1) };
}

/** The action that checks out a branch label, or null when there's nothing to do. */
export function checkoutFor(ctx: MenuContext, pill: RefPill, commit: CommitRow): Action | null {
  if (pill.kind === "tag") return { kind: "checkoutCommit", id: commit.id };
  if (pill.kind !== "branch" || pill.current) return null;
  if (pill.local) return { kind: "checkoutBranch", name: pill.name };
  const { branch } = splitRemoteBranch(pill.name, ctx.snapshot.remotes);
  return ctx.localBranches.has(branch)
    ? { kind: "checkoutBranch", name: branch }
    : { kind: "checkoutRemoteBranch", name: pill.name };
}

/** Right-click on a commit row. */
export function commitMenu(ctx: MenuContext, commit: CommitRow): MenuItem[] {
  if (commit.kind === "worktree") return worktreeMenu(ctx);
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
      checkouts.push({
        label: `Check out ${ref.name}`,
        icon: <BranchIcon />,
        disabled: !canChange,
        onSelect: () => ctx.run({ kind: "checkoutBranch", name: ref.name }),
      });
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
export function worktreeMenu(ctx: MenuContext): MenuItem[] {
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
      ...mergeItems(ctx, pill.name, pill.name),
      highlight,
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
      { label: "Copy tag name", icon: <CopyIcon />, separated: true, onSelect: () => copyText(pill.name) },
    ];
  }

  const items: MenuItem[] = [];
  if (pill.local) {
    items.push(
      {
        label: pill.current ? `${pill.name} is checked out` : `Check out ${pill.name}`,
        icon: <BranchIcon />,
        disabled: !canChange || pill.current,
        onSelect: () => checkout && ctx.run(checkout),
      },
      {
        label: `Rename ${pill.name}…`,
        icon: <PencilIcon />,
        disabled: !canChange,
        onSelect: () => ctx.open({ kind: "rename", branch: pill.name }),
      },
      {
        label: `Delete ${pill.name}…`,
        icon: <TrashIcon />,
        danger: true,
        disabled: !canChange || pill.current,
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
  if (!pill.current) items.push(...mergeItems(ctx, pill.name, pill.name));
  items.push(highlight, ...visibilityItems(ctx, pill), ...webItems(ctx, pill));
  // Remote copies of this branch at the same commit.
  const remoteNames = pill.local ? pill.remotes.map((remote) => `${remote}/${pill.name}`) : [pill.name];
  remoteNames.forEach((name, i) => {
    const { remote, branch } = splitRemoteBranch(name, snapshot.remotes);
    items.push({
      label: `Delete ${branch} from ${remote}…`,
      icon: <TrashIcon />,
      danger: true,
      separated: i === 0,
      disabled: !canChange,
      onSelect: () => ctx.open({ kind: "deleteRemoteBranch", name }),
    });
  });
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
    remotes: [],
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
