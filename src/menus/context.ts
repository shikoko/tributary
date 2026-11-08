// What the menus need from the app, and helpers they share with the dialogs.
import type { Action, CommitRow, Lock, PullRequest, RepoSnapshot, Visibility, Worktree } from "../api";
import type { PullRequestLookup } from "../lib/pullRequests";
import { type RefPill } from "../lib/refs";
import { shortId } from "../lib/format";
import type { CompareRequest } from "../app/useComparison";

/** Dialogs the app can show. */
export type OpenDialog =
  | { kind: "reset"; target: CommitRow }
  | { kind: "newBranch"; target: CommitRow }
  | { kind: "forcePush" }
  /** `paths`: the files to start with (all of them when left out). */
  | { kind: "stash"; paths?: string[] }
  | { kind: "rename"; branch: string }
  | { kind: "deleteBranch"; branch: string; commitId: string }
  | { kind: "deleteRemoteBranch"; name: string }
  | { kind: "dropStash"; index: number; id: string; label: string }
  | { kind: "tag"; target: CommitRow }
  /** `restoreId`: what the tag points at (its tag object, when annotated), to undo. */
  | { kind: "deleteTag"; name: string; restoreId: string }
  | { kind: "deleteRemoteTag"; name: string; remote: string }
  | { kind: "clone" }
  /** Clean up local branches that are gone from the remote or merged. */
  | { kind: "prune" }
  /** Put back a branch from a backup. */
  | { kind: "restore" }
  /** A change to the protected, checked-out branch: type its name to go ahead. */
  | { kind: "protectedAction"; action: Action; branch: string }
  /** `commits`: the commits after `onto`, newest first. */
  | { kind: "interactiveRebase"; onto: CommitRow; commits: CommitRow[] }
  /** Release someone else's Git LFS lock. */
  | { kind: "forceUnlock"; lock: Lock }
  /** Clean up the local copies of Git LFS files. */
  | { kind: "pruneLfs" }
  /** HEAD's reflog: get back commits that are on no branch. */
  | { kind: "recover" }
  | { kind: "newWorktree"; branch?: string; start: CommitRow }
  | { kind: "removeWorktree"; worktree: Worktree }
  /** The repository's own settings: protected branches, who commits are made as, Git LFS. */
  | { kind: "repoSettings"; section?: string }
  /** Open a pull request for `branch` (its name on the remote); `url` opens it on the site instead. */
  | { kind: "createPullRequest"; branch: string; local: string | null; url: string | null }
  /** Start bisecting from `good` (which worked) to the checked-out commit. */
  | { kind: "bisect"; good: CommitRow }
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
  /** The open pull requests, to find a branch's. */
  requests: PullRequestLookup | null;
  /** Show a pull request in the app. */
  showRequest: (pr: PullRequest) => void;
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
  /** Protected branch names: they can't be deleted, and rewriting them needs their name typed. */
  protectedBranches: string[];
  toggleProtected: (name: string) => void;
  /** The commits after `commit` on the checked-out branch, newest first, or why they can't be rewritten. */
  rewritable: (commit: CommitRow) => CommitRow[] | string;
  /** The commit is in the checked-out commit's history (and isn't it). */
  beforeHead: (commit: CommitRow) => boolean;
  openUrl: (url: string) => void;
  /** The repository's working trees, to know which branches are checked out elsewhere. */
  worktrees: Worktree[];
  /** Open a working tree in a tab. */
  openWorktree: (path: string) => void;
  /** Compare two commits or branches, in the details panel. */
  compare: (request: CompareRequest) => void;
}

/** What to call a commit when comparing: its (first) local branch, or its short id. */
export function commitLabel(commit: CommitRow): string {
  return commit.refs.find((ref) => ref.kind === "branch")?.name ?? shortId(commit.id);
}

/** The checked-out commit as one side of a comparison, if there is one. */
export function headSide(snapshot: RepoSnapshot): { id: string; label: string } | null {
  return snapshot.headCommit ? { id: snapshot.headCommit, label: snapshot.headBranch ?? shortId(snapshot.headCommit) } : null;
}

/** The other working tree that has `branch` checked out, if one does. */
export function worktreeOf(ctx: MenuContext, branch: string): Worktree | undefined {
  return ctx.worktrees.find((worktree) => !worktree.current && worktree.branch === branch);
}

/** The full names of the refs a label stands for: a local branch and its remote copies, a remote branch, or a tag. */
export function pillRefNames(pill: RefPill): string[] {
  if (pill.kind === "tag") return [`refs/tags/${pill.name}`];
  if (pill.kind !== "branch") return [];
  if (!pill.local) return [`refs/remotes/${pill.name}`];
  return [`refs/heads/${pill.name}`, ...pill.remotes.map((remote) => `refs/remotes/${remote}/${pill.name}`)];
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

