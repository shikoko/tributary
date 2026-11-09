// Reading a repository: its history and graph, refs, uncommitted changes and commit details.
import { invoke } from "@tauri-apps/api/core";

export type RefKind = "head" | "branch" | "remote" | "tag" | "stash";

/** What a row in the graph stands for. */
export type RowKind = "commit" | "stash" | "worktree";

/** The id of the row for uncommitted changes. */
export const WORKTREE_ID = "worktree";

export interface RefLabel {
  name: string;
  kind: RefKind;
  /** True for the branch that is checked out. */
  current: boolean;
  /** For a local branch: the remote branch it tracks, like "origin/main". */
  upstream?: string;
  /** For an annotated tag: the id of the tag object (the label sits on its commit). */
  target?: string;
  /** For a local branch with an upstream: commits it has that the upstream doesn't, and the other way round (git's count, over the whole history). */
  ahead?: number;
  behind?: number;
}

/** The full name of a branch, remote branch or tag, like "refs/heads/main". */
export function fullRefName(ref: { kind: RefKind; name: string }): string | null {
  switch (ref.kind) {
    case "branch":
      return `refs/heads/${ref.name}`;
    case "remote":
      return `refs/remotes/${ref.name}`;
    case "tag":
      return `refs/tags/${ref.name}`;
    default:
      return null;
  }
}

/**
 * One line segment inside a graph row, as `[kind, from, to]` columns:
 * - 0: a lane passing straight through the row
 * - 1: a lane coming in from the top and ending in the row's node
 * - 2: a line leaving the row's node towards a parent's lane at the bottom
 *
 * The fourth element is the row of the commit whose parent link this line draws (a
 * list of rows when several links share the lane). A fifth element of `1` means the
 * line is dashed (it belongs to a stash or to uncommitted changes).
 */
export type GraphLine =
  | [0 | 1 | 2, number, number, number | number[]]
  | [0 | 1 | 2, number, number, number | number[], 1];

export interface GraphRow {
  column: number;
  lines: GraphLine[];
}

export interface CommitRow {
  /** The commit id, or WORKTREE_ID for uncommitted changes. */
  id: string;
  kind: RowKind;
  summary: string;
  authorName: string;
  authorEmail: string;
  /** Author time in seconds since the Unix epoch. */
  time: number;
  /** Commit time in seconds since the Unix epoch. */
  commitTime: number;
  parents: string[];
  refs: RefLabel[];
  graph: GraphRow;
}

/** The name and email address commits are made with (`user.name`, `user.email`). */
export interface Identity {
  name: string | null;
  email: string | null;
}

export interface RepoSnapshot {
  path: string;
  name: string;
  /** True for a repository without a working tree. */
  bare: boolean;
  headBranch: string | null;
  /** The remote branch the checked-out branch pulls from, if it has one. */
  upstream: Upstream | null;
  /** Names of the configured remotes, like "origin". */
  remotes: string[];
  /** A merge, rebase, cherry-pick or revert that stopped, usually because of conflicts. */
  operation: Operation | null;
  /** A bisect under way. */
  bisect: Bisect | null;
  /** Only the checked-out branch's own history (first parents) was loaded. */
  firstParent: boolean;
  headCommit: string | null;
  /** Commits, plus rows for uncommitted changes and stashes. */
  commits: CommitRow[];
  /** Uncommitted changes, or null when the working tree is clean. */
  worktree: WorktreeStatus | null;
  laneCount: number;
  /** True when the repository has more commits than were loaded. */
  truncated: boolean;
  /** Branches, remote branches and tags left out of the graph (hidden, or not soloed). */
  hiddenRefs: HiddenRef[];
  /** Remotes whose repository has a web page. */
  webRemotes: WebRemote[];
  /** The name and email commits are made with here. */
  user: Identity | null;
  /** When the repository was last fetched from, in seconds since the Unix epoch. */
  lastFetched: number | null;
  /** Local branches whose remote branch was deleted (usually merged pull requests). */
  goneBranches: string[];
  /** After a squash merge: the message prepared for committing it. */
  squashMessage: string | null;
}

export interface HiddenRef {
  name: string;
  kind: RefKind;
  /** The commit it points to. */
  commit: string;
  upstream?: string;
}

export type WebHost = "github" | "gitlab" | "bitbucket" | "gitea" | "other";

export interface WebRemote {
  /** Like "origin". */
  name: string;
  host: WebHost;
  /** The repository's page, like "https://github.com/owner/repo". */
  url: string;
}

/** Which branches the graph shows: hidden ones are left out; if any are soloed, only those. */
export interface Visibility {
  hidden: string[];
  solo: string[];
}

export type OperationKind = "merge" | "rebase" | "cherryPick" | "revert" | "applyPatches" | "other";

export interface Operation {
  kind: OperationKind;
  /** The commit message git prepared, for a merge, cherry-pick or revert. */
  message: string | null;
  /** For a rebase: the branch being rebased (HEAD is detached while it runs). */
  branch: string | null;
  /**
   * The two sides of a conflict: yours (the checked-out branch, or the branch being
   * rebased) and theirs (what's merged, picked, reverted or rebased onto), like "main"
   * and "feat/x" or "commit a1b2c3d".
   */
  mine: string | null;
  theirs: string | null;
}

export interface Upstream {
  /** Like "origin/main". */
  name: string;
  /** Where it points, or null if it hasn't been fetched yet. */
  commit: string | null;
}

export interface Person {
  name: string;
  email: string;
  time: number;
  /** Timezone offset from UTC in seconds. */
  offset: number;
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted";

export interface FileChange {
  path: string;
  oldPath: string | null;
  status: FileStatus;
}

export interface WorktreeStatus {
  /** Changes in the index, compared to HEAD. */
  staged: FileChange[];
  /** Changes in the working tree compared to the index, and untracked files. */
  unstaged: FileChange[];
}

export interface CommitDetails {
  id: string;
  summary: string;
  body: string;
  author: Person;
  committer: Person;
  parents: string[];
  files: FileChange[];
  /** Its signature, when it's signed. */
  signature: CommitSignature | null;
}

/** A signed commit's signature, as git checks it. */
export interface CommitSignature {
  /**
   * good: a trusted key's; untrusted: good, but the key isn't trusted; expired or revoked:
   * good, by a key that no longer is; bad: it doesn't match; unchecked: it couldn't be checked.
   */
  status: "good" | "untrusted" | "expired" | "revoked" | "bad" | "unchecked";
  kind: "gpg" | "ssh" | "x509";
  /** Who signed it, as the key says. */
  signer: string | null;
  key: string | null;
}

/** A bisect under way: the commits marked good and bad, and the first bad one once found. */
export interface Bisect {
  /** Where it started (a branch or a commit), to go back to. */
  start: string | null;
  bad: string | null;
  good: string[];
  skipped: string[];
  /** Commits that could still be the first bad one. */
  left: number | null;
  /** About how many more commits to test. */
  steps: number | null;
  found: string | null;
}

/** How many commits are loaded at a time. */
export const PAGE_SIZE = 10_000;

/**
 * Load a repository. Reading uncommitted changes (`includeStatus`) can take a while in
 * large working trees, so the app loads without them first and then again with them.
 */
export function openRepository(
  path: string,
  limit = PAGE_SIZE,
  includeStatus = true,
  firstParent = false,
  visibility: Visibility = { hidden: [], solo: [] },
): Promise<RepoSnapshot> {
  return invoke<RepoSnapshot>("open_repository", {
    path,
    limit,
    includeStatus,
    firstParent,
    hidden: visibility.hidden,
    solo: visibility.solo,
  });
}

export function commitDetails(path: string, id: string): Promise<CommitDetails> {
  return invoke<CommitDetails>("commit_details", { path, id });
}

/** What to search commits for, besides their messages: a file's path, or code they added or removed. */
export type CommitSearchMode = "files" | "code";

/** The commits (newest first, in every branch) that changed a matching file, or added or removed the code. */
export function searchCommits(path: string, mode: CommitSearchMode, query: string): Promise<{ ids: string[]; truncated: boolean }> {
  return invoke<{ ids: string[]; truncated: boolean }>("search_commits", { path, mode, query });
}

/** Two commits (or branches) compared: the files that differ, and the commits each has that the other doesn't. */
export interface Comparison {
  /** What the files are compared from: `from` itself, or (since they split) where they split. Null when they share no history. */
  base: string | null;
  /** Where the two split (their merge base). */
  splitAt: string | null;
  onlyFrom: number;
  onlyTo: number;
  files: FileChange[];
}

/** Compare commit `to` with `from`: directly, or with `split`, since they split (like a pull request). */
export function compareCommits(path: string, from: string, to: string, split: boolean): Promise<Comparison> {
  return invoke<Comparison>("compare_commits", { path, from, to, split });
}

/** The commits that changed a file or folder. */
export interface FileHistory {
  /** Relative to the repository's root, without a trailing slash. */
  path: string;
  folder: boolean;
  /** Newest first. */
  ids: string[];
  /** For a file: every path it had, following renames. */
  names: string[];
  truncated: boolean;
}

/** `file` is relative to the repository's root, or an absolute path inside it. */
export function fileHistory(path: string, file: string): Promise<FileHistory> {
  return invoke<FileHistory>("file_history", { path, file });
}

/** A working tree of the repository: the main one, or one linked with `git worktree add`. */
export interface Worktree {
  path: string;
  /** The checked-out branch, or null when HEAD is detached. */
  branch: string | null;
  head: string | null;
  main: boolean;
  /** The one that's open. */
  current: boolean;
  locked: boolean;
  /** Its folder is gone. */
  prunable: boolean;
}

export function worktrees(path: string): Promise<Worktree[]> {
  return invoke<Worktree[]>("worktrees", { path });
}

/** Something that moved HEAD: a commit, checkout, reset, rebase, … */
export interface ReflogEntry {
  id: string;
  previous: string | null;
  /** As git wrote it, like "reset: moving to HEAD~2". */
  message: string;
  /** Seconds since the Unix epoch. */
  time: number;
  summary: string;
  authorName: string;
}

export function reflog(path: string, limit?: number): Promise<ReflogEntry[]> {
  return invoke<ReflogEntry[]>("reflog", { path, limit });
}

/** Where the remote branches point, and which one the checked-out branch tracks. */
export interface RemoteState {
  tips: Record<string, string>;
  upstream: string | null;
  remotes: string[];
}

export function remoteState(path: string): Promise<RemoteState> {
  return invoke<RemoteState>("remote_state", { path });
}

export function commitsBetween(path: string, from: string, to: string): Promise<{ count: number; authors: string[] }> {
  return invoke("commits_between", { path, from, to });
}

/** The latest change to a file on another branch. */
export interface OtherChange {
  /** Like "origin/art/lighting" or "feature/tags". */
  branch: string;
  commit: string;
  summary: string;
  author: string;
  /** Seconds since the Unix epoch. */
  time: number;
}

/** A file you're working on that another branch also changed since yours split off from it. */
export interface Overlap {
  path: string;
  /** It can't be merged (Git LFS, lockable or binary): one version will have to win. */
  unmergeable: boolean;
  /** Your change is uncommitted (otherwise it's in a commit on your branch). */
  uncommitted: boolean;
  /** The other branches' latest changes to it, newest first. */
  elsewhere: OtherChange[];
}

/** Of `changed` (your uncommitted changes) and your branch's own changes: the files recently changed branches also changed. */
export function changedElsewhere(path: string, changed: string[]): Promise<Overlap[]> {
  return invoke<Overlap[]>("changed_elsewhere", { path, changed });
}

/** Who committed where lately: people, the branches they work on, and how far those are from the main branch. */
export interface TeamActivity {
  /** Since when (seconds since the Unix epoch). */
  since: number;
  /** The branch the others are compared with, like "origin/main". */
  main: string;
  people: TeamPerson[];
  branches: BranchActivity[];
  mainCommits: number;
}

export interface TeamPerson {
  name: string;
  email: string;
  commits: number;
  /** When they last committed. */
  latest: number;
  /** The branches they committed to (the main one included). */
  branches: string[];
}

export interface BranchActivity {
  name: string;
  tip: string;
  latest: number;
  /** Commits it has that the main branch doesn't, and the other way round. */
  ahead: number;
  behind: number;
  /** Files it changed since it split from the main branch. */
  files: number;
  people: { name: string; email: string; commits: number }[];
}

export function teamActivity(path: string, days: number): Promise<TeamActivity> {
  return invoke<TeamActivity>("team_activity", { path, days });
}

/** Where a recent repository stands, for the start screen. */
export interface RepoSummary {
  /** The folder is there and holds a repository. */
  found: boolean;
  /** The checked-out branch (null when HEAD is detached). */
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Files with uncommitted changes (new ones included), and with conflicts. */
  changes: number;
  conflicts: number;
}

export function repoSummary(path: string): Promise<RepoSummary> {
  return invoke<RepoSummary>("repo_summary", { path });
}

/** A folder that could be checked out. */
export interface FolderChoice {
  /** Like "Content/Characters". */
  path: string;
  /** It's inside another folder offered. */
  nested: boolean;
}

/** Which folders the repository has checked out (a sparse checkout), and which it could. */
export interface SparseSettings {
  /** Only some folders are checked out. */
  sparse: boolean;
  /** It's git's usual kind of sparse checkout (by folders), which Tributary can change. */
  cone: boolean;
  /** The folders checked out, when only some are. */
  folders: string[];
  /** The folders at the top, and those just inside them. */
  available: FolderChoice[];
  /** A partial clone: files outside the checked-out folders aren't downloaded. */
  partial: boolean;
}

export function sparseSettings(path: string): Promise<SparseSettings> {
  return invoke<SparseSettings>("sparse_settings", { path });
}

/** One of git's speed-ups for big repositories. */
export type SpeedUp = "fileWatcher" | "untrackedCache" | "commitGraph" | "maintenance";

/** How big the repository is, and which of git's speed-ups are on. */
export interface SpeedSettings {
  /** Files in the index. */
  files: number;
  /** Big enough for the speed-ups to matter. */
  big: boolean;
  /** Null where git has no file watcher of its own (Linux, or git before 2.36). */
  fileWatcher: boolean | null;
  untrackedCache: boolean;
  commitGraph: boolean;
  maintenance: boolean;
  gitVersion: string;
}

export function speedSettings(path: string): Promise<SpeedSettings> {
  return invoke<SpeedSettings>("speed_settings", { path });
}

/** A patch file's commits and files, and whether it applies to the files as they are. */
export interface PatchInfo {
  /** Its commits (when it holds commits, as git format-patch writes them). */
  commits: { summary: string; author: string }[];
  /** The files it changes, with lines added and removed (null for binary files). */
  files: { path: string; additions: number | null; deletions: number | null }[];
  applies: boolean;
}

export function patchInfo(path: string, file: string): Promise<PatchInfo> {
  return invoke<PatchInfo>("patch_info", { path, file });
}

/** Commits as one patch, oldest first. */
export function patchText(path: string, ids: string[]): Promise<string> {
  return invoke<string>("patch_text", { path, ids });
}

/** How a merge would go, worked out without merging. */
export interface MergeCheck {
  /** "unknown": git is older than 2.38, or the two share no history. */
  outcome: "upToDate" | "fastForward" | "clean" | "conflicts" | "unknown";
  /** The files that would conflict (the first 200). */
  conflicts: string[];
  conflictCount: number;
  /** Commits merging would bring in. */
  incoming: number;
  /** Commits on the branch merged into that aren't on the other (those a rebase replays). */
  outgoing: number;
}

/** How merging `from` into `into` (the checked-out commit, when left out) would go. */
export function mergeCheck(path: string, from: string, into?: string): Promise<MergeCheck> {
  return invoke<MergeCheck>("merge_check", { path, from, into: into ?? null });
}

/** Who owns each of `files`, by the repository's CODEOWNERS (empty when it has none). */
export function codeOwners(path: string, files: string[]): Promise<{ path: string; owners: string[] }[]> {
  return invoke<{ path: string; owners: string[] }[]>("code_owners", { path, files });
}

/** Where a branch pointed, and how it got there. */
export interface BranchVersion {
  id: string;
  /** When it moved there (seconds since 1970). */
  at: number;
  /** It was rewritten to get there: a forced update, a rebase, a reset or an amend. */
  rewritten: boolean;
  /** What moved it, as git says, like "fetch: forced-update". */
  how: string;
}

/** Where branch `name` (like "fix/door" or "origin/fix/door") pointed, newest first. */
export function branchVersions(path: string, name: string): Promise<BranchVersion[]> {
  return invoke<BranchVersion[]>("branch_versions", { path, name });
}

/** A commit of a branch's old version matched with its new version (git range-diff). */
export interface CommitPair {
  status: "same" | "changed" | "added" | "removed";
  /** Short ids. */
  old: string | null;
  new: string | null;
  summary: string;
  /** For a changed commit, how its changes differ: git's diff of the two diffs. */
  changes: string[];
  cut: boolean;
}

export interface RangeDiff {
  /** The branch both versions were compared on top of. */
  base: string | null;
  pairs: CommitPair[];
}

/**
 * How version `next` of a branch differs from version `old`, commit by commit; `base`: the
 * branch both are on top of (found from `branch`'s remote when left out).
 */
export function rangeDiff(path: string, old: string, next: string, base?: string | null, branch?: string): Promise<RangeDiff> {
  return invoke<RangeDiff>("range_diff", { path, old, new: next, base: base ?? null, branch: branch ?? null });
}

/** A local branch built on another unmerged branch. */
export interface Stacked {
  branch: string;
  /** The branch it's built on. */
  on: string;
  /** It's built on an earlier version of `on`, since rewritten: it can be moved onto the new one. */
  moved: boolean;
  /** For a moved one: the earlier version of `on` it's built on. */
  old: string | null;
}

/** The local branches built on other unmerged branches, and those whose base was rewritten. */
export function branchStacks(path: string): Promise<Stacked[]> {
  return invoke<Stacked[]>("branch_stacks", { path });
}

/** What went into a release, between the tag before it and its own. */
export interface ReleaseNotes {
  /** The tag (or commit) they start after; null when there's no earlier tag. */
  from: string | null;
  to: string;
  /** The earlier tags in its history, newest first. */
  earlier: string[];
  /** Each change on the main line, newest first. */
  items: { title: string; number: string | null; author: string; id: string; body: string }[];
  /** Who made its commits, most commits first. */
  contributors: string[];
  commits: number;
}

/** What went into `to` since `from` (the tag before it when left out). */
export function releaseNotes(path: string, to: string, from?: string | null): Promise<ReleaseNotes> {
  return invoke<ReleaseNotes>("release_notes", { path, to, from: from ?? null });
}

/** Publish a release for `tag` (pushed already) on GitHub or GitLab; resolves to its page. */
export function publishRelease(path: string, tag: string, title: string, notes: string): Promise<string> {
  return invoke<string>("publish_release", { path, tag, title, notes });
}
