// Made from the Rust types by a test (src-tauri/src/bindings.rs), so don't change it by
// hand: change the Rust type, and `cargo test` brings this file up to date.

/**
 * One of your repositories, on GitHub or GitLab.
 */
export type AccountRepo = {
  /**
   * "GitHub" or "GitLab".
   */
  forge: string;
  /**
   * The user or organization (a GitLab group, with its subgroups) it belongs to.
   */
  owner: string;
  name: string;
  description: string | null;
  private: boolean;
  /**
   * When it last changed, as the server says it (ISO 8601).
   */
  updated: string;
  /**
   * The address to clone it from (HTTPS).
   */
  url: string;
};

/**
 * Something to do to the repository, as sent by the frontend.
 */
export type Action =
  | { kind: "resetHard"; id: string }
  | { kind: "checkoutBranch"; name: string }
  | { kind: "checkoutRemoteBranch"; name: string }
  | { kind: "checkoutCommit"; id: string }
  | { kind: "createBranch"; name: string; id: string; checkout: boolean }
  | { kind: "fetch"; background?: boolean }
  | { kind: "pull" }
  | { kind: "fetchLatest" }
  | { kind: "push"; force: boolean; noVerify?: boolean }
  | { kind: "shelve"; paths?: Array<string>; description: string; keep?: boolean }
  | { kind: "restoreFromHistory"; reference: string; paths?: Array<string> }
  | { kind: "openShelf"; reference: string }
  | { kind: "deleteShelf"; reference: string }
  | { kind: "anyDiskSpace"; action: Action }
  | { kind: "stashAndRetry"; action: Action; includeUntracked?: boolean }
  | {
    kind: "stashPush";
    message?: string | null;
    includeUntracked?: boolean;
    /**
     * Only these files (all changes when empty).
     */
    paths?: Array<string>;
  }
  | { kind: "stashApply"; index: number; id: string }
  | { kind: "stashPop"; index: number; id: string }
  | { kind: "stashDrop"; index: number; id: string }
  | { kind: "stage"; paths: Array<string> }
  | { kind: "stageIgnored"; paths: Array<string> }
  | { kind: "unstage"; paths: Array<string> }
  | { kind: "stageAll" }
  | { kind: "unstageAll" }
  | { kind: "commit"; message: string; amend: boolean; noVerify?: boolean }
  | { kind: "resetSoft"; id: string }
  | { kind: "deleteBranch"; name: string; force: boolean }
  | { kind: "deleteRemoteBranch"; name: string }
  | { kind: "deleteBranches"; branches: Array<BranchTip> }
  | { kind: "restoreBranches"; branches: Array<BranchTip> }
  | { kind: "restoreRemoteBranch"; name: string; id: string }
  | { kind: "restoreBackup"; reference: string }
  | { kind: "removeBackup"; reference: string }
  | { kind: "renameBranch"; name: string; newName: string }
  | { kind: "merge"; target: string; mode?: MergeMode }
  | { kind: "rebase"; onto: string }
  | { kind: "cherryPick"; id: string }
  | { kind: "revert"; id: string }
  | { kind: "continueOperation" }
  | { kind: "skipCommit" }
  | { kind: "abortOperation" }
  | { kind: "cherryPickMany"; ids: Array<string> }
  | { kind: "revertMany"; ids: Array<string> }
  | { kind: "interactiveRebase"; onto: string; steps: Array<RebaseStep> }
  | { kind: "fixupInto"; id: string }
  | { kind: "splitCommit"; id: string; paths: Array<string>; first: string; second: string }
  | { kind: "migrateToLfs"; patterns: Array<string>; everything?: boolean }
  | { kind: "restack"; onto: string; old: string }
  | { kind: "createTag"; name: string; id: string; message?: string | null }
  | { kind: "deleteTag"; name: string }
  | { kind: "restoreTag"; name: string; id: string }
  | { kind: "pushTag"; name: string; remote?: string | null }
  | { kind: "deleteRemoteTag"; name: string; remote: string }
  | { kind: "resolveConflicts"; paths: Array<string>; keep: Side }
  | { kind: "recreateConflicts"; paths: Array<string> }
  | { kind: "resolveWithText"; file: string; text: string }
  | { kind: "lockFiles"; paths: Array<string> }
  | { kind: "trackWithLfs"; patterns: Array<string>; paths?: Array<string> }
  | { kind: "discardFiles"; paths: Array<string> }
  | { kind: "discardAll" }
  | { kind: "restoreDiscarded"; reference: string }
  | {
    kind: "applyLines";
    file: string;
    mode: LineMode;
    added?: Array<number>;
    removed?: Array<number>;
  }
  | { kind: "ignorePaths"; patterns: Array<string> }
  | { kind: "unignorePaths"; patterns: Array<string> }
  | { kind: "pruneLfs" }
  | { kind: "downloadLfsFiles" }
  | { kind: "setLfsFetchFolders"; include?: Array<string>; exclude?: Array<string> }
  | { kind: "setUpLfs" }
  | { kind: "addWorktree"; path: string; branch: string; create?: boolean; start?: string | null }
  | { kind: "removeWorktree"; path: string; force?: boolean }
  | { kind: "pruneWorktrees" }
  | { kind: "openInDiffTool"; source: DiffSource; path: string }
  | { kind: "openInMergeTool"; path: string }
  | { kind: "untrackWithLfs"; patterns: Array<string> }
  | { kind: "setIdentity"; name: string; email: string }
  | { kind: "setCommitTemplate"; text: string }
  | { kind: "fixSetup"; fix: SetupFix }
  | { kind: "bisectStart"; bad: string; good: string }
  | { kind: "bisectMark"; verdict: Verdict; id?: string | null }
  | { kind: "bisectReset" }
  | { kind: "addRemote"; name: string; url: string }
  | { kind: "renameRemote"; from: string; to: string }
  | { kind: "removeRemote"; name: string }
  | { kind: "setRemoteUrl"; name: string; url: string; push: boolean }
  | { kind: "setSparseFolders"; folders: Array<string> }
  | { kind: "savePatch"; ids: Array<string>; file: string }
  | { kind: "applyPatch"; file: string; asCommits: boolean }
  | { kind: "setSpeedUp"; which: SpeedUp; on: boolean }
  | { kind: "speedUpAll" }
  | { kind: "setUpUnityMerge"; tool: string }
  | { kind: "removeUnityMerge" }
  | { kind: "unitySmartMerge"; file: string; tool: string }
  | { kind: "setSigning"; mode: SigningMode; key?: string | null }
  | { kind: "updateSubmodules"; paths?: Array<string> }
  | { kind: "unlockFiles"; locks: Array<LockRef>; force?: boolean };

/**
 * What an actor's file holds.
 */
export type ActorName = {
  /**
   * Its name in the editor's outliner, like "SM_RackShelf_215".
   */
  label: string | null;
  /**
   * Its class, short: "StaticMeshActor", or a Blueprint's name, like "BP_Door".
   */
  class: string | null;
  /**
   * The level it's in, like "Maps/Tavern".
   */
  level: string | null;
};

/**
 * Where a branch was before Tributary deleted, reset, rebased or force-pushed it, kept
 * for [`BACKUP_DAYS`] days so it can be put back.
 */
export type Backup = {
  /**
   * The backup's own ref, under `refs/tributary/backups/`.
   */
  reference: string;
  event: BackupEvent;
  /**
   * The branch, like `feat/x`, or `origin/feat/x` for a remote one.
   */
  name: string;
  remote: boolean;
  /**
   * The commit it pointed to, its summary, and when the backup was made.
   */
  id: string;
  summary: string;
  /**
   * When the backup was made (seconds).
   */
  time: number;
  /**
   * Where the branch points now, if it still exists.
   */
  current: string | null;
};

/**
 * What happened to a branch that made Tributary keep a backup of it.
 */
export type BackupEvent =
  | "deleted"
  | "deletedFromRemote"
  | "forcePushed"
  | "reset"
  | "rebased";

export type BigFile = {
  path: string;
  /**
   * Its size, and what it takes on disk (compressed, maybe stored as a change to another).
   */
  bytes: number;
  diskBytes: number;
  /**
   * It's in the checked-out commit (otherwise it was deleted or changed since).
   */
  current: boolean;
  /**
   * Files like it are stored with Git LFS now (so only old versions are in the history).
   */
  inLfs: boolean;
};

/**
 * A bisect under way: the commits marked good and bad, and the first bad one once found.
 */
export type Bisect = {
  /**
   * Where it started (a branch, or a commit), to go back to.
   */
  start: string | null;
  bad: string | null;
  good: Array<string>;
  skipped: Array<string>;
  /**
   * Commits that could still be the first bad one.
   */
  left: number | null;
  /**
   * About how many more commits to test.
   */
  steps: number | null;
  /**
   * The first bad commit, once it's found.
   */
  found: string | null;
};

/**
 * Who changed each line of a file last.
 */
export type Blame = {
  /**
   * The commits the lines come from, in the order they first appear.
   */
  commits: Array<BlameCommit>;
  /**
   * Each line, in order: its text and which of `commits` it comes from.
   */
  lines: Array<BlameLine>;
};

export type BlameCommit = {
  /**
   * The full id, or None for lines that aren't committed yet.
   */
  id: string | null;
  author: string;
  email: string;
  /**
   * Seconds since the Unix epoch.
   */
  time: number;
  summary: string;
  /**
   * The file's path in that commit (it may have been renamed since).
   */
  name: string;
  /**
   * The commit before it that had the file, and the file's path there: where to look
   * for who changed these lines before. None when this commit added the file.
   */
  previous: string | null;
  previousName: string | null;
};

export type BlameLine = {
  text: string;
  /**
   * Index into [`Blame::commits`].
   */
  commit: number;
  /**
   * The line's number in that commit's version of the file.
   */
  original: number;
};

export type BranchActivity = {
  /**
   * Like "origin/feature/export", or a local branch that isn't pushed.
   */
  name: string;
  tip: string;
  latest: number;
  /**
   * Commits it has that `main` doesn't, and the other way round.
   */
  ahead: number;
  behind: number;
  /**
   * How many files it changed since it split from `main`.
   */
  files: number;
  /**
   * Who committed to it since then, the busiest first.
   */
  people: Array<BranchPerson>;
  /**
   * When each of its own commits since then was made, the newest first.
   */
  times: Array<number>;
};

export type BranchPerson = { name: string; email: string; commits: number };

/**
 * A local branch, the commit it points to and, to restore it as it was, its upstream
 * (`branch.<name>.remote` and `branch.<name>.merge`).
 */
export type BranchTip = { name: string; id: string; remote?: string | null; merge?: string | null };

/**
 * Where a branch pointed, and how it got there.
 */
export type BranchVersion = {
  id: string;
  /**
   * When it moved there (seconds since 1970).
   */
  at: number;
  /**
   * It was rewritten to get there (not just moved forward): a forced update, a rebase,
   * a reset or an amended commit.
   */
  rewritten: boolean;
  /**
   * What moved it, as git says: "fetch: forced-update", "rebase (finish): …".
   */
  how: string;
};

/**
 * How a pull request's checks (GitHub Actions and others) went.
 */
export type CheckState =
  | "success"
  | "failure"
  | "pending"
  | "cancelled";

export type CheckStatus = "good" | "warning" | "problem";

/**
 * Ways to make a clone of a big repository smaller and quicker.
 */
export type CloneOptions = {
  /**
   * Leave files stored with Git LFS as small pointer files, to download later (all at
   * once, or as other branches are checked out).
   */
  skipLfs?: boolean;
  /**
   * Only check out these folders (a sparse checkout). The contents of files outside
   * them aren't downloaded at all.
   */
  folders?: Array<string>;
  /**
   * Only download this many of the latest commits (a shallow clone).
   */
  depth?: number | null;
  /**
   * Also clone its submodules (and theirs), each at the commit it records.
   */
  submodules?: boolean;
};

export type CommitBrief = { id: string; summary: string; time: number };

/**
 * A commit's checks in full.
 */
export type CommitChecks = {
  checks: Array<RequestCheck>;
  /**
   * Failed ones can be run again from here (signed in, and some failed).
   */
  canRerun: boolean;
  /**
   * "GitHub" or "GitLab".
   */
  site: string;
};

export type CommitDetails = {
  id: string;
  summary: string;
  body: string;
  author: Person;
  committer: Person;
  parents: Array<string>;
  /**
   * Files changed compared to the first parent.
   */
  files: Array<FileChange>;
  /**
   * Its signature, when it's signed.
   */
  signature: CommitSignature | null;
};

/**
 * A commit's message: its first line, and the rest.
 */
export type CommitMessage = { summary: string; body: string };

/**
 * A commit of the old version, its new version, or both.
 */
export type CommitPair = {
  status: PairStatus;
  /**
   * Short ids.
   */
  old: string | null;
  new: string | null;
  summary: string;
  /**
   * For a changed commit, how its changes differ (git's diff of the two diffs).
   */
  changes: Array<string>;
  /**
   * More lines than were kept.
   */
  cut: boolean;
};

export type CommitRow = {
  /**
   * The commit id, or [`WORKTREE_ID`] for the uncommitted changes row.
   */
  id: string;
  kind: RowKind;
  summary: string;
  authorName: string;
  authorEmail: string;
  /**
   * Author time, in seconds since the Unix epoch.
   */
  time: number;
  /**
   * Commit time, in seconds since the Unix epoch.
   */
  commitTime: number;
  parents: Array<string>;
  refs: Array<RefLabel>;
  graph: GraphRow;
};

/**
 * What to search commits for, besides their messages: a file's path, or code they added or removed.
 */
export type CommitSearchMode =
  | "files"
  | "code";

/**
 * A signed commit's signature, as git checks it.
 */
export type CommitSignature = {
  /**
   * good: a trusted key's; untrusted: good, but the key isn't trusted; expired or revoked:
   * good, by a key that no longer is; bad: it doesn't match; unchecked: it couldn't be checked.
   */
  status: SignatureStatus;
  /**
   * "gpg", "ssh" or "x509".
   */
  kind: string;
  /**
   * Who signed it, as the key says.
   */
  signer: string | null;
  /**
   * The key it was signed with.
   */
  key: string | null;
};

/**
 * The message new commits start from: git's `commit.template`, which a team can share (a
 * file in the repository, set up for everyone) or Tributary keeps for one repository.
 */
export type CommitTemplate = {
  /**
   * What the file says (None when there's no template, or it can't be read).
   */
  text: string | null;
  /**
   * The file, as configured.
   */
  file: string | null;
  /**
   * It's the one Tributary keeps for this repository (so it can be edited here).
   */
  ours: boolean;
};

/**
 * Two commits (or branches) compared: the files that differ, and the commits each has that the other doesn't.
 */
export type Comparison = {
  /**
   * What the files are compared from: `from` itself, or (since they split) where the
   * two histories meet. None when they don't share any history.
   */
  base: string | null;
  /**
   * Where the two split (their merge base), whichever way they're compared.
   */
  splitAt: string | null;
  /**
   * Commits in `from`'s history that aren't in `to`'s, and the other way round.
   */
  onlyFrom: number;
  onlyTo: number;
  /**
   * The files that differ, from `base` to `to`.
   */
  files: Array<FileChange>;
};

/**
 * A conflicted file as it is now, with git's conflict markers, to resolve in the app.
 */
export type ConflictText = {
  /**
   * None when it can't be resolved here, and why.
   */
  text: string | null;
  reason: string | null;
};

/**
 * For reporting a problem: versions, the platform, and how the repository is set up.
 */
export type Diagnostics = {
  /**
   * Tributary's version.
   */
  version: string;
  /**
   * Like "macOS 15.1 (aarch64)".
   */
  platform: string;
  /**
   * `git --version`, or why git couldn't be run.
   */
  git: string;
  /**
   * Where that git is.
   */
  gitPath: string | null;
  /**
   * `git lfs version`, if Git LFS is installed.
   */
  gitLfs: string | null;
  repository: RepositoryInfo | null;
  /**
   * What went wrong in the window lately, and the crash reports saved for sending.
   */
  problems: Summary;
};

/**
 * One line of a diff, with its number before and after the change.
 */
export type DiffLine = {
  kind: LineKind;
  /**
   * Line numbers before and after.
   */
  old: number | null;
  new: number | null;
  text: string;
};

/**
 * Which change to a file.
 */
export type DiffSource =
  | { kind: "commit"; id: string }
  | { kind: "staged" }
  | { kind: "unstaged" }
  | { kind: "range"; from: string; to: string };

export type DiffToolSettings = {
  /**
   * The tool names set (`diff.tool`, `merge.tool`), like "meld" or "vscode".
   */
  diff: string | null;
  merge: string | null;
  /**
   * Their commands, when they're set up with one (`difftool.<name>.cmd`).
   */
  diffCommand: string | null;
  mergeCommand: string | null;
  /**
   * The tools git can open here (when asked for), the windowed ones only.
   */
  available: Array<ToolChoice>;
};

/**
 * How far the download has got, sent as `update-progress` events.
 */
export type DownloadProgress = { downloaded: number; total: number | null };

export type Engine = "unreal" | "unity";

export type FileChange = {
  path: string;
  /**
   * The previous path, for renames and copies.
   */
  oldPath: string | null;
  status: FileStatus;
};

/**
 * Changed files to look at before committing.
 */
export type FileChecks = {
  /**
   * Big files that aren't stored with Git LFS: committed like this, everyone who
   * clones the repository downloads them forever.
   */
  large: Array<LargeFile>;
  /**
   * Files marked `lockable` in `.gitattributes`.
   */
  lockable: Array<string>;
  /**
   * The repository uses Git LFS.
   */
  usesLfs: boolean;
  /**
   * New files whose names will cause trouble on Windows or macOS.
   */
  names: Array<NameProblem>;
  /**
   * In a Unity project: files whose `.meta` is missing, orphaned or left behind.
   */
  metas: Array<MetaProblem>;
};

export type FileCount = { done: number; total: number };

export type FileDiff = {
  path: string;
  /**
   * Not text: shown by its sizes (or as media), not line by line.
   */
  binary: boolean;
  /**
   * Stored with Git LFS.
   */
  lfs: boolean;
  /**
   * Too long to show line by line.
   */
  tooLarge: boolean;
  additions: number;
  deletions: number;
  hunks: Array<Hunk>;
  /**
   * In bytes, when the content isn't shown line by line. None where the file doesn't exist.
   */
  sizeBefore: number | null;
  sizeAfter: number | null;
  /**
   * For pictures, sounds, videos and 3D models: both versions, to show as what they are.
   */
  media: Media | null;
  /**
   * It's a submodule: which commits it moved by.
   */
  submodule: SubmoduleChange | null;
};

/**
 * The commits that changed a file or folder.
 */
export type FileHistory = {
  /**
   * Relative to the repository's root, with forward slashes, without a trailing slash.
   */
  path: string;
  folder: boolean;
  /**
   * Newest first, from every branch, remote branch and tag.
   */
  ids: Array<string>;
  /**
   * For a file: every path it had, following renames, newest first.
   */
  names: Array<string>;
  /**
   * More commits changed it than were listed.
   */
  truncated: boolean;
};

export type FileKind = "code" | "art" | "levels" | "audio" | "other";

/**
 * A file and who owns it.
 */
export type FileOwners = { path: string; owners: Array<string> };

export type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted";

/**
 * A folder that could be checked out.
 */
export type FolderChoice = {
  /**
   * Like "Content/Characters".
   */
  path: string;
  /**
   * It's inside another folder offered.
   */
  nested: boolean;
};

/**
 * The site a pull (or merge) request is on.
 */
export type Forge = "github" | "gitlab";

/**
 * A GitHub user.
 */
export type GitHubAccount = {
  login: string;
  name: string | null;
  /**
   * Where GitHub keeps the account's picture.
   */
  avatarUrl: string | null;
  /**
   * The account's picture, as a `data:` URL (for showing who's signed in).
   */
  picture: string | null;
};

/**
 * Who's signed in to GitHub, and how one can sign in.
 */
export type GitHubStatus = {
  account: GitHubAccount | null;
  /**
   * Git keeps a token that GitHub no longer accepts.
   */
  tokenRejected: boolean;
  /**
   * Git can keep a token: it has a credential helper.
   */
  canKeepToken: boolean;
  /**
   * Git Credential Manager is set up, so signing in can happen in the browser.
   */
  browserSignIn: boolean;
};

/**
 * Where git is (if it's anywhere), which version, and what's in the way when it isn't.
 */
export type GitInstall = {
  /**
   * The git that runs, when there is one.
   */
  path: string | null;
  /**
   * Like "2.39.3".
   */
  version: string | null;
  /**
   * Older than [`RECOMMENDED`]: it works, but not everything does.
   */
  old: boolean;
  /**
   * On a Mac: Apple's Command Line Tools (which bring git) aren't installed.
   */
  needsCommandLineTools: boolean;
};

/**
 * A GitLab user.
 */
export type GitLabAccount = {
  username: string;
  name: string | null;
  /**
   * Where the server keeps the account's picture (maybe Gravatar).
   */
  avatarUrl: string | null;
  /**
   * The account's picture, as a `data:` URL (for showing who's signed in).
   */
  picture: string | null;
};

/**
 * Who's signed in to a GitLab server, and how one can sign in.
 */
export type GitLabStatus = {
  /**
   * Like "gitlab.com".
   */
  host: string;
  account: GitLabAccount | null;
  /**
   * Git keeps a token that the server no longer accepts.
   */
  tokenRejected: boolean;
  /**
   * Git can keep a token: it has a credential helper.
   */
  canKeepToken: boolean;
  /**
   * Git Credential Manager is set up, so signing in can happen in the browser.
   */
  browserSignIn: boolean;
};

/**
 * One segment of a row's graph: `[kind, from, to, child]`, with a fifth `1` when
 * it's dashed (a stash's or uncommitted changes'). The kind is 0 for a lane passing
 * through, 1 for one ending in the row's node, 2 for one leaving it towards a parent;
 * `child` is the row whose parent link it draws, or a list of rows sharing the lane.
 */
export type GraphLine =
  | [0 | 1 | 2, number, number, number | number[]]
  | [0 | 1 | 2, number, number, number | number[], 1];

export type GraphRow = {
  /**
   * The column of this row's commit node.
   */
  column: number;
  lines: Array<GraphLine>;
};

export type HiddenRef = {
  name: string;
  kind: RefKind;
  /**
   * The commit it points to.
   */
  commit: string;
  upstream?: string;
};

export type Hotspot = {
  path: string;
  kind: FileKind;
  /**
   * How many commits changed it, and who made them (emails), the most first.
   */
  changes: number;
  people: Array<string>;
  /**
   * It can't be merged line by line (Git LFS, lockable or binary): one version wins.
   */
  unmergeable: boolean;
};

/**
 * A stretch of changed lines with some unchanged ones around them.
 */
export type Hunk = {
  /**
   * What git says the lines are in, like a function's name.
   */
  section: string;
  lines: Array<DiffLine>;
};

/**
 * The name and email address commits are made with (`user.name`, `user.email`).
 */
export type Identity = { name: string | null; email: string | null };

/**
 * Why a file is ignored, if it is.
 */
export type IgnoreReason = {
  /**
   * The file, relative to the repository's top.
   */
  path: string;
  /**
   * It's tracked: ignore rules don't apply to files already committed.
   */
  tracked: boolean;
  /**
   * The rule that ignores it, if one does.
   */
  rule: IgnoreRule | null;
};

export type IgnoreRule = {
  /**
   * The file it's in, like ".gitignore" or "Content/.gitignore" (relative to the
   * repository's top when it's inside it).
   */
  source: string;
  line: number;
  pattern: string;
};

/**
 * An editor or terminal installed on this computer.
 */
export type InstalledApp = { id: string; name: string; terminal: boolean };

/**
 * One issue.
 */
export type Issue = {
  /**
   * Like "FEAST-12", or "#12".
   */
  key: string;
  title: string;
  /**
   * Like "In Progress".
   */
  status: string | null;
  /**
   * Done, closed or cancelled.
   */
  done: boolean;
  url: string;
};

export type KindCount = {
  kind: FileKind;
  /**
   * File changes (a file changed in three commits counts three times).
   */
  files: number;
  /**
   * The share of the commits' work: each commit counts as one, split between the kinds of
   * file it changed (so importing 2,000 generated files is one commit's work, not 2,000).
   */
  work: number;
};

/**
 * A big file that isn't stored with Git LFS.
 */
export type LargeFile = {
  path: string;
  /**
   * In bytes.
   */
  size: number;
};

/**
 * A folder with files stored with Git LFS, to choose whether to download them.
 */
export type LfsFolder = {
  /**
   * Like `Content/Characters`.
   */
  path: string;
  files: number;
  /**
   * Their sizes, together (the latest versions').
   */
  bytes: number;
  /**
   * How many of them are downloaded here.
   */
  downloaded: number;
};

/**
 * What's wrong with Git LFS in a repository that uses it, if anything.
 */
export type LfsHealth = {
  /**
   * Git LFS isn't installed: files stored with it are left as pointer files, and
   * files can't be locked.
   */
  notInstalled: boolean;
  /**
   * Git LFS is installed, but git doesn't use it (`git lfs install` was never run),
   * so checking out leaves pointer files.
   */
  notSetUp: boolean;
  /**
   * Files in the working tree whose contents weren't downloaded: they're still the
   * small pointer files Git LFS replaces them with.
   */
  pointers: number;
  /**
   * A few of those, as paths in the repository.
   */
  examples: Array<string>;
};

/**
 * Which files a repository stores with Git LFS, and which big ones it could.
 */
export type LfsSettings = {
  /**
   * Git LFS is installed on this computer.
   */
  installed: boolean;
  /**
   * The patterns stored with Git LFS, as `.gitattributes` lists them (like `*.psd`).
   */
  patterns: Array<string>;
  /**
   * Kinds of big files here that aren't stored with it, biggest first.
   */
  suggestions: Array<LfsSuggestion>;
  /**
   * Download only the Git LFS files in these folders (or matching these patterns)…
   */
  fetchInclude: Array<string>;
  /**
   * …and not those in these.
   */
  fetchExclude: Array<string>;
  /**
   * The folders with files stored with Git LFS, biggest first.
   */
  folders: Array<LfsFolder>;
};

/**
 * The Git LFS files kept on this computer.
 */
export type LfsStorage = {
  bytes: number;
  files: number;
  /**
   * Where they are.
   */
  folder: string;
};

export type LfsSuggestion = {
  /**
   * Like `*.psd`.
   */
  pattern: string;
  /**
   * How many files of that kind are big, and how big they are together.
   */
  files: number;
  bytes: number;
};

export type LineKind = "context" | "added" | "removed";

/**
 * What to do with the chosen lines.
 */
export type LineMode = "stage" | "unstage" | "discard";

/**
 * A file locked with Git LFS.
 */
export type Lock = {
  id: string;
  /**
   * Relative to the repository's root, with forward slashes.
   */
  path: string;
  /**
   * Who holds it: their name on the server (on GitHub, their username).
   */
  owner: string;
  /**
   * When it was locked, like "2016-05-17T15:49:06+00:00".
   */
  lockedAt: string | null;
  /**
   * Locked by you.
   */
  mine: boolean;
};

/**
 * A Git LFS lock: its id, and the file it's on (for messages).
 */
export type LockRef = { id: string; path: string };

export type Locks = {
  /**
   * The repository uses Git LFS and its server supports locking. When false, there is
   * nothing to show and no reason to ask again.
   */
  supported: boolean;
  /**
   * Yours first, then by path.
   */
  locks: Array<Lock>;
  /**
   * Why the locks couldn't be listed this time (offline, signed out, …).
   */
  error: string | null;
};

/**
 * A git command Tributary ran, for the activity log.
 */
export type LogEntry = {
  id: number;
  /**
   * When it started, in milliseconds since the Unix epoch.
   */
  started: number;
  durationMs: number;
  /**
   * The folder it ran in.
   */
  folder: string;
  /**
   * Everything after `git`.
   */
  args: Array<string>;
  success: boolean;
  /**
   * What git printed, shortened when it's long.
   */
  output: string;
  /**
   * Run by Tributary on its own, like the fetch every few minutes.
   */
  background: boolean;
};

/**
 * Commits that would be lost with a branch: on it, and on no other branch, remote
 * branch or tag.
 */
export type LostCommits = {
  count: number;
  /**
   * The newest few.
   */
  commits: Array<CommitBrief>;
};

/**
 * A picture, sound, video or 3D model before and after, as `data:` URLs: None where the
 * file doesn't exist, or (with its size known) is too big to show here.
 */
export type Media = {
  kind: MediaKind;
  /**
   * Its extension, like "glb" (3D models are read by it).
   */
  format: string;
  before: string | null;
  after: string | null;
  /**
   * How big a picture is, width and height, when what's shown is a preview of it (a
   * texture the window can't show by itself, made smaller when it's big).
   */
  beforeDimensions: [number, number] | null;
  afterDimensions: [number, number] | null;
  /**
   * Why a side that's there can't be shown, like a kind of DDS that can't be read.
   */
  beforeNote: string | null;
  afterNote: string | null;
};

/**
 * What kind of file a picture, sound, video or 3D model is, to show it as one.
 */
export type MediaKind =
  | "image"
  | "audio"
  | "video"
  | "model";

/**
 * How a merge of `from` into `into` would go.
 */
export type MergeCheck = {
  /**
   * "unknown": git is older than 2.38, or the two share no history.
   */
  outcome: MergeOutcome;
  /**
   * The files that would conflict.
   */
  conflicts: Array<string>;
  /**
   * More conflicting files than [`MOST_FILES`]: how many in all.
   */
  conflictCount: number;
  /**
   * The commits merging would bring in (on `from`, not on `into`).
   */
  incoming: number;
  /**
   * The commits on `into` that aren't on `from` (those a rebase would replay).
   */
  outgoing: number;
};

/**
 * How to merge a request.
 */
export type MergeMethod = "merge" | "squash" | "rebase";

/**
 * How to merge.
 */
export type MergeMode = "default" | "noFastForward" | "squash";

export type MergeOutcome = "upToDate" | "fastForward" | "clean" | "conflicts" | "unknown";

/**
 * What merging a request should do.
 */
export type MergeRequestOptions = {
  method: MergeMethod;
  /**
   * The merge (or squashed) commit's summary and message; the site's own when empty.
   */
  title: string;
  message: string;
  /**
   * Delete its branch afterwards.
   */
  deleteBranch: boolean;
};

/**
 * Whether a request can be merged as it is.
 */
export type Mergeable =
  | "ready"
  | "conflicts"
  | "behind"
  | "blocked"
  | "checking";

export type MetaKind = "missing" | "orphan" | "leftBehind";

/**
 * A file whose `.meta` is wrong.
 */
export type MetaProblem = {
  /**
   * The asset (or folder) or, for an orphan, the `.meta` file.
   */
  path: string;
  problem: MetaKind;
};

/**
 * A new file whose name will cause trouble elsewhere.
 */
export type NameProblem = {
  path: string;
  /**
   * caseClash: another file or folder has the same name but for capitals (`detail`: its path);
   * reserved: a name Windows keeps for devices, like CON (`detail`: the name);
   * character: a character Windows doesn't allow (`detail`: it);
   * trailingDot: a name ending in a dot or space (`detail`: the name);
   * tooLong: a long path (`detail`: its length).
   */
  problem: Problem;
  /**
   * The part of the path at fault: a name, a character, or for a clash, the other path.
   */
  detail: string;
};

export type NamedSize = { name: string; size: number };

/**
 * Commits that arrived on a branch.
 */
export type NewCommits = {
  count: number;
  /**
   * Who wrote them, most commits first.
   */
  authors: Array<string>;
};

/**
 * A pull request to open: `branch` (on the remote) into `base`.
 */
export type NewRequest = {
  branch: string;
  base: string;
  title: string;
  body?: string;
  draft?: boolean;
  /**
   * People (`@user`) and teams (`@org/team`) to ask for a review.
   */
  reviewers?: Array<string>;
};

/**
 * What the dialog for a new pull request starts from.
 */
export type NewRequestInfo = {
  forge: Forge;
  /**
   * The remote on the site, like "origin".
   */
  remote: string;
  /**
   * The branches on that remote, to merge into (without the remote's name).
   */
  bases: Array<string>;
  /**
   * The one to suggest: the remote's default branch.
   */
  base: string | null;
  /**
   * Git keeps a token for the site (without one, the request is opened in the browser).
   */
  signedIn: boolean;
  /**
   * The branch is on the remote already.
   */
  onRemote: boolean;
  /**
   * Commits of the local branch that aren't on the remote yet.
   */
  unpushed: number;
  /**
   * The commits the request would bring into the suggested base, oldest first (at most 50).
   */
  commits: Array<CommitMessage>;
  /**
   * Who owns the files it changes, by the repository's CODEOWNERS (most files first).
   */
  owners: Array<string>;
};

export type Operation = {
  kind: OperationKind;
  /**
   * The commit message git prepared, for a merge, cherry-pick or revert.
   */
  message: string | null;
  /**
   * For a rebase: the branch being rebased (HEAD is detached while it runs).
   */
  branch: string | null;
  /**
   * What the two sides of a conflict are called: yours (the checked-out branch, or
   * the branch being rebased) and theirs (what's being merged, picked, reverted or
   * rebased onto), like "main" and "feat/x" or "commit a1b2c3d".
   */
  mine: string | null;
  theirs: string | null;
};

export type OperationKind = "merge" | "rebase" | "cherryPick" | "revert" | "applyPatches" | "other";

/**
 * The latest change to a file on another branch.
 */
export type OtherChange = {
  /**
   * Like "origin/art/lighting" or "feature/tags".
   */
  branch: string;
  commit: string;
  summary: string;
  author: string;
  /**
   * Seconds since the Unix epoch.
   */
  time: number;
};

/**
 * What an action did.
 */
export type Outcome = {
  /**
   * A short message for the user.
   */
  message: string;
  /**
   * After pushing a new branch: the page the remote suggested for opening a pull request.
   */
  pullRequest?: string;
  /**
   * Where what the action threw away was kept, to undo it (like discarded changes).
   */
  backup?: string;
  /**
   * After a push: the files the pushed commits changed.
   */
  pushedFiles?: Array<string>;
};

/**
 * A file that's also changed elsewhere, and where.
 */
export type Overlap = {
  path: string;
  /**
   * It can't be merged (Git LFS, lockable or binary): one version will have to win.
   */
  unmergeable: boolean;
  /**
   * Your change is uncommitted (otherwise it's in a commit on your branch).
   */
  uncommitted: boolean;
  /**
   * The other branches' latest changes to it, newest first.
   */
  elsewhere: Array<OtherChange>;
};

export type PairStatus = "same" | "changed" | "added" | "removed";

export type PatchCommit = { summary: string; author: string };

export type PatchFile = { path: string; additions: number | null; deletions: number | null };

/**
 * What a patch file holds.
 */
export type PatchInfo = {
  /**
   * Its commits' summaries and authors, when it's commits (as `git format-patch` writes).
   */
  commits: Array<PatchCommit>;
  /**
   * The files it changes, with lines added and removed (None for binary files).
   */
  files: Array<PatchFile>;
  /**
   * It applies to the files as they are now, without conflicts.
   */
  applies: boolean;
};

export type Person = {
  name: string;
  email: string;
  /**
   * Seconds since the Unix epoch.
   */
  time: number;
  /**
   * The author's timezone offset from UTC, in seconds.
   */
  offset: number;
};

export type PersonWork = {
  email: string;
  kinds: Array<KindCount>;
  /**
   * Lines of code added and removed.
   */
  added: number;
  removed: number;
};

export type Problem = "caseClash" | "reserved" | "character" | "trailingDot" | "tooLong";

/**
 * How far a fetch, pull or push has got.
 */
export type Progress = {
  /**
   * Like "Receiving objects".
   */
  phase: string;
  /**
   * None until git reports a percentage.
   */
  percent: number | null;
  /**
   * More about it, like "2 of 5 files · 56 MB of 80 MB · 12 MB/s".
   */
  detail?: string;
  /**
   * Files done of how many, when the percentage is about something else (the bytes of all
   * of them, or of the one being downloaded).
   */
  files?: FileCount;
  /**
   * Bytes a second, the file being transferred, about how many seconds are left, and the
   * biggest file still to come (Git LFS transfers).
   */
  rate?: number;
  current?: string;
  remaining?: number;
  biggestLeft?: NamedSize;
};

/**
 * How a repository is set up for a game project, check by check.
 */
export type ProjectSetup = {
  engine: Engine | null;
  /**
   * The project's folder in the repository ("" for the top), like "Game".
   */
  project: string | null;
  checks: Array<SetupCheck>;
};

/**
 * A local branch that could be pruned: its remote branch is gone, or it's merged.
 */
export type PruneCandidate = {
  name: string;
  id: string;
  /**
   * Its last commit's summary and commit time.
   */
  summary: string;
  time: number;
  /**
   * The remote branch it tracked, like `origin/feat/x`.
   */
  upstream: string | null;
  /**
   * Its remote branch was deleted (usually: its pull request was merged).
   */
  gone: boolean;
  /**
   * All its commits are in the base branch (or the local branch of that name).
   */
  merged: boolean;
  /**
   * How many of its commits aren't in the base branch (0 when merged).
   */
  unmerged: number;
  /**
   * Its upstream configuration, to put back if the prune is undone.
   */
  remote: string | null;
  merge: string | null;
};

/**
 * What [`prune_candidates`] found.
 */
export type PruneInfo = {
  /**
   * What "merged" is measured against, like `origin/main`.
   */
  base: string | null;
  candidates: Array<PruneCandidate>;
};

/**
 * An open pull request on GitHub, or merge request on GitLab.
 */
export type PullRequest = {
  number: number;
  title: string;
  url: string;
  /**
   * The remote it's on, like "origin".
   */
  remote: string;
  /**
   * Its branch on that remote, like "feat/menu".
   */
  branch: string;
  draft: boolean;
  author: string;
  /**
   * None when it has no checks (or they couldn't be read).
   */
  checks: CheckState | null;
  /**
   * Where it is: a pull request on GitHub, or a merge request on GitLab.
   */
  forge: Forge;
};

export type RangeDiff = {
  /**
   * The branch both versions are compared against, if one was found.
   */
  base: string | null;
  pairs: Array<CommitPair>;
};

/**
 * One commit in an interactive rebase.
 */
export type RebaseStep = {
  id: string;
  action: StepAction;
  /**
   * The new message, for [`StepAction::Reword`].
   */
  message?: string | null;
};

/**
 * A pull or merge request, for Team activity's figures.
 */
export type RecentRequest = {
  number: number;
  title: string;
  /**
   * Its author's login.
   */
  author: string;
  draft: boolean;
  /**
   * When it was opened, merged and closed (RFC 3339).
   */
  created: string;
  merged: string | null;
  closed: string | null;
};

export type RefKind = "head" | "branch" | "remote" | "tag" | "stash";

export type RefLabel = {
  name: string;
  kind: RefKind;
  /**
   * `true` for the branch that is checked out.
   */
  current: boolean;
  /**
   * For a local branch: the remote branch it tracks, like `origin/main`.
   */
  upstream?: string;
  /**
   * For an annotated tag: the id of the tag object itself (`kind` points at its commit).
   */
  target?: string;
  /**
   * For a local branch with an upstream: how far it is ahead of the upstream, and behind
   * it, along each one's own line (first parents): a merged pull request counts once.
   */
  ahead?: number;
  behind?: number;
  /**
   * The same as git counts it (`git status`): every commit, those a merge brought in too.
   */
  aheadCommits?: number;
  behindCommits?: number;
};

/**
 * One entry of HEAD's reflog: something that moved HEAD (a commit, checkout, reset, …).
 */
export type ReflogEntry = {
  /**
   * Where HEAD went.
   */
  id: string;
  /**
   * Where it was before (empty for the first entry).
   */
  previous: string | null;
  /**
   * What happened, as git wrote it, like "reset: moving to HEAD~2".
   */
  message: string;
  /**
   * When, in seconds since the Unix epoch.
   */
  time: number;
  /**
   * The summary of the commit it went to.
   */
  summary: string;
  authorName: string;
};

export type ReleaseItem = {
  title: string;
  /**
   * Its pull request's number (GitHub `#12`) or merge request's (GitLab `!12`).
   */
  number: string | null;
  author: string;
  /**
   * The commit (a merge, or the change itself).
   */
  id: string;
  /**
   * The rest of its message, for issue keys mentioned there.
   */
  body: string;
};

/**
 * What went into a release, between the tag before it and its own.
 */
export type ReleaseNotes = {
  /**
   * The tag (or commit) they start after; None when there's no earlier tag.
   */
  from: string | null;
  to: string;
  /**
   * The earlier tags in its history, newest first, to start from instead.
   */
  earlier: Array<string>;
  /**
   * Each change on the main line, newest first.
   */
  items: Array<ReleaseItem>;
  /**
   * Who made its commits, most commits first.
   */
  contributors: Array<string>;
  /**
   * How many commits it has in all.
   */
  commits: number;
};

/**
 * A remote and where it is.
 */
export type RemoteInfo = {
  name: string;
  /**
   * Its address, without a password or token in it.
   */
  url: string;
  /**
   * The address pushes go to, when it's a different one.
   */
  pushUrl: string | null;
  /**
   * Its address has a password or token in it (left out above).
   */
  hasCredentials: boolean;
};

/**
 * Where the remote branches point, and which one the checked-out branch tracks: enough
 * to tell, after a fetch, what's new.
 */
export type RemoteState = {
  /**
   * Like "origin/main" → its commit.
   */
  tips: { [key in string]: string };
  /**
   * Like "origin/main".
   */
  upstream: string | null;
  remotes: Array<string>;
};

/**
 * Who commits are made as here, and where that comes from.
 */
export type RepoIdentity = {
  /**
   * Set for this repository only (`git config --local`).
   */
  localName: string | null;
  localEmail: string | null;
  /**
   * The usual one, for every repository (`git config --global`).
   */
  globalName: string | null;
  globalEmail: string | null;
};

/**
 * What makes a repository big.
 */
export type RepoSize = {
  /**
   * The history's size on disk (git's packed and loose objects), in bytes.
   */
  historyBytes: number;
  /**
   * How many file versions the history holds.
   */
  versions: number;
  /**
   * The biggest file versions, biggest first.
   */
  biggest: Array<BigFile>;
  /**
   * What each top folder costs (all versions of its files, on disk), most first.
   */
  folders: Array<SizeGroup>;
  /**
   * What each kind of file costs (by extension), most first.
   */
  kinds: Array<SizeGroup>;
};

export type RepoSnapshot = {
  /**
   * The repository's working directory (or git directory for bare repositories).
   */
  path: string;
  name: string;
  /**
   * `true` for a repository without a working tree.
   */
  bare: boolean;
  /**
   * The checked out branch, or `None` when HEAD is detached or unborn.
   */
  headBranch: string | null;
  /**
   * The remote branch the checked-out branch pulls from, if it has one.
   */
  upstream: Upstream | null;
  /**
   * Names of the configured remotes, like `origin`.
   */
  remotes: Array<string>;
  /**
   * A merge, rebase, cherry-pick or revert that stopped, usually because of conflicts.
   */
  operation: Operation | null;
  /**
   * A bisect under way.
   */
  bisect: Bisect | null;
  /**
   * Only the checked-out branch's own history (first parents) was loaded.
   */
  firstParent: boolean;
  headCommit: string | null;
  /**
   * Commits, plus a row for uncommitted changes and one for each stash.
   */
  commits: Array<CommitRow>;
  /**
   * Uncommitted changes, or `None` when the working tree is clean (or there is none).
   */
  worktree: WorktreeStatus | null;
  /**
   * The number of graph columns needed to draw every row.
   */
  laneCount: number;
  /**
   * `true` when there are more commits than were loaded.
   */
  truncated: boolean;
  /**
   * Branches, remote branches and tags left out of the graph because they're hidden
   * (or not soloed), so they can still be listed and shown again.
   */
  hiddenRefs: Array<HiddenRef>;
  /**
   * Remotes whose repository has a web page.
   */
  webRemotes: Array<WebRemote>;
  /**
   * The name and email address commits are made with here (`user.name`, `user.email`).
   */
  user: Identity | null;
  /**
   * When the repository was last fetched from (seconds since the Unix epoch).
   */
  lastFetched: number | null;
  /**
   * Local branches whose remote branch was deleted (typically merged pull requests),
   * apart from the checked-out branch and long-lived ones like main.
   */
  goneBranches: Array<string>;
  /**
   * After a squash merge: the message prepared for committing it.
   */
  squashMessage: string | null;
};

/**
 * Where a recent repository stands, for the start screen.
 */
export type RepoSummary = {
  /**
   * The folder is there and holds a repository.
   */
  found: boolean;
  /**
   * The checked-out branch (None when HEAD is detached).
   */
  branch: string | null;
  /**
   * Like "origin/main".
   */
  upstream: string | null;
  /**
   * How far it's ahead of the upstream, and behind it, along each one's own line (a merged
   * pull request counts once).
   */
  ahead: number;
  behind: number;
  /**
   * Files with changes not committed yet (new files included), and with conflicts.
   */
  changes: number;
  conflicts: number;
};

/**
 * How a repository is set up.
 */
export type RepositoryInfo = {
  path: string;
  /**
   * The checked-out branch, or the commit when HEAD is detached.
   */
  head: string;
  /**
   * "origin https://github.com/owner/name.git", without credentials.
   */
  remotes: Array<string>;
  /**
   * Only some history was cloned (`--depth`).
   */
  shallow: boolean;
  /**
   * Only some folders are checked out.
   */
  sparse: boolean;
  /**
   * File contents are downloaded when needed (`--filter`).
   */
  partial: boolean;
  /**
   * A merge, rebase, cherry-pick or revert waiting to be finished.
   */
  operation: string | null;
  lfs: LfsHealth | null;
  /**
   * Why the repository couldn't be read, if it couldn't.
   */
  error: string | null;
};

/**
 * A change to an open request, from its view.
 */
export type RequestChange =
  | { kind: "draft"; draft: boolean }
  | { kind: "reviewers"; reviewers: Array<string> }
  | { kind: "autoMerge"; on: boolean; method?: string | null };

/**
 * One check (GitHub) or pipeline job (GitLab).
 */
export type RequestCheck = {
  name: string;
  /**
   * None when it was skipped, or neither passed nor failed.
   */
  state: CheckState | null;
  /**
   * Its page on the site.
   */
  url: string | null;
  /**
   * A line about it, like the stage of a GitLab job.
   */
  detail: string | null;
  /**
   * When it started running (RFC 3339), if it has.
   */
  startedAt: string | null;
  /**
   * When it finished (RFC 3339), if it has.
   */
  finishedAt: string | null;
  /**
   * What it's part of, to group it by: its GitHub workflow (or the app that ran it),
   * or its GitLab stage.
   */
  workflow: string | null;
  /**
   * What started that, in words, like "on push to develop".
   */
  trigger: string | null;
};

/**
 * One comment in a request's conversation.
 */
export type RequestComment = {
  id: string;
  author: string;
  /**
   * As written (Markdown).
   */
  body: string;
  /**
   * When (RFC 3339).
   */
  created: string;
  /**
   * A review's verdict, when the comment is one.
   */
  review: ReviewState | null;
  /**
   * The file and line it's on, for a comment on the changes.
   */
  path: string | null;
  line: number | null;
  /**
   * The lines it's about, from the diff (GitHub).
   */
  hunk: string | null;
  /**
   * The thread it's in: replies go to it. None when it can't be replied to.
   */
  thread: string | null;
  /**
   * It answers an earlier comment in its thread.
   */
  reply: boolean;
};

/**
 * A request's conversation, and what you can do with it.
 */
export type RequestConversation = {
  /**
   * Oldest first; replies follow their thread's first comment.
   */
  comments: Array<RequestComment>;
  /**
   * Who you are on the site, when git has a token for it.
   */
  you: string | null;
  /**
   * The ways it can be merged here, the site's default first.
   */
  mergeMethods: Array<MergeMethod>;
  /**
   * Asking for changes is possible (GitHub).
   */
  canRequestChanges: boolean;
};

/**
 * One pull (or merge) request in full.
 */
export type RequestDetails = {
  number: number;
  title: string;
  url: string;
  /**
   * Its description, as written (Markdown).
   */
  body: string;
  author: string;
  state: RequestState;
  /**
   * The branch it goes into, and its own.
   */
  base: string;
  branch: string;
  /**
   * When it was opened (RFC 3339).
   */
  created: string;
  additions: number | null;
  deletions: number | null;
  files: number | null;
  comments: number;
  /**
   * None when it's closed, merged or a draft.
   */
  mergeable: Mergeable | null;
  reviews: Array<RequestReview>;
  checks: Array<RequestCheck>;
  forge: Forge;
  /**
   * The commits it's between: where the branch it goes into is, and its own branch's
   * last commit (to compare them in the app once they're fetched).
   */
  baseSha: string | null;
  headSha: string | null;
  /**
   * It merges by itself once its checks pass (GitHub's auto-merge, GitLab's "merge when
   * the pipeline succeeds").
   */
  autoMerge: boolean;
};

export type RequestReview = { author: string; state: ReviewState };

/**
 * Where a request is.
 */
export type RequestState = "open" | "draft" | "merged" | "closed";

/**
 * What a reviewer made of a request.
 */
export type ReviewState =
  | "approved"
  | "changesRequested"
  | "commented"
  | "requested";

/**
 * What a review says.
 */
export type ReviewVerdict = "approve" | "requestChanges" | "comment";

/**
 * What a row in the graph stands for.
 */
export type RowKind =
  | "commit"
  | "stash"
  | "worktree";

export type SearchResult = {
  /**
   * Newest first.
   */
  ids: Array<string>;
  /**
   * More commits matched than were listed.
   */
  truncated: boolean;
};

export type SetupCheck = {
  /**
   * Stable, for the frontend ("ignore", "lfs", …).
   */
  id: string;
  status: CheckStatus;
  title: string;
  detail: string;
  /**
   * Some of what was found (file names, patterns).
   */
  examples: Array<string>;
  fix: SetupFix | null;
  /**
   * What the fix does, for its button.
   */
  fixLabel: string | null;
};

/**
 * A change that puts a check right.
 */
export type SetupFix =
  | { kind: "ignore"; patterns: Array<string> }
  | { kind: "untrack"; folders: Array<string> }
  | { kind: "track"; patterns: Array<string> }
  | { kind: "lockable"; patterns: Array<string> }
  | { kind: "textAuto" }
  | { kind: "longPaths" }
  | { kind: "installLfs" };

/**
 * A shelf, someone's or your own.
 */
export type Shelf = {
  /**
   * Its ref, under `refs/tributary/shelves/`.
   */
  reference: string;
  id: string;
  /**
   * What it's for, as its author wrote it.
   */
  description: string;
  author: string;
  email: string;
  /**
   * When it was shelved (seconds since the epoch).
   */
  time: number;
  /**
   * The branch it was shelved on, and the commit its files were changed from.
   */
  branch: string | null;
  base: string | null;
  /**
   * Whether it's yours (by its email).
   */
  mine: boolean;
  files: Array<ShelfFile>;
};

export type ShelfFile = {
  path: string;
  /**
   * "added", "modified" or "deleted".
   */
  change: string;
};

/**
 * Which version of a conflicted file to keep.
 */
export type Side = "mine" | "theirs";

export type SignatureStatus = "good" | "untrusted" | "expired" | "revoked" | "bad" | "unchecked";

/**
 * A key commits could be signed with.
 */
export type SigningKey = {
  /**
   * What `user.signingkey` takes: a GPG key id, or an SSH public key's file.
   */
  id: string;
  /**
   * Who or what it is: the GPG key's user, or the SSH key's file and comment.
   */
  label: string;
  format: SigningMode;
};

/**
 * How commits in this repository are signed.
 */
export type SigningMode =
  | "usual"
  | "off"
  | "gpg"
  | "ssh";

export type SigningSettings = {
  /**
   * What's set for this repository (`Usual` when nothing is).
   */
  mode: SigningMode;
  /**
   * Whether commits here end up signed, and how (from every level of git's config).
   */
  signs: boolean;
  /**
   * "openpgp", "ssh" or "x509".
   */
  format: string;
  key: string | null;
  /**
   * The keys found: GPG's secret keys, and SSH public keys in ~/.ssh.
   */
  keys: Array<SigningKey>;
};

export type SizeGroup = { name: string; diskBytes: number; versions: number };

/**
 * A snapshot of uncommitted work.
 */
export type Snapshot = {
  reference: string;
  id: string;
  /**
   * When it was taken (milliseconds since the epoch).
   */
  time: number;
  /**
   * The files that were changed then, compared with the commit checked out then.
   */
  files: Array<SnapshotFile>;
};

export type SnapshotFile = {
  path: string;
  /**
   * "added", "modified" or "deleted".
   */
  change: string;
};

/**
 * What's checked out, and what could be.
 */
export type SparseSettings = {
  /**
   * Only some folders are checked out.
   */
  sparse: boolean;
  /**
   * The sparse checkout is git's usual kind (by folders), which this app can change.
   */
  cone: boolean;
  /**
   * The folders checked out, when only some are.
   */
  folders: Array<string>;
  /**
   * The folders at the top of the checked-out commit, and those just inside them.
   */
  available: Array<FolderChoice>;
  /**
   * A partial clone: files outside the checked-out folders aren't downloaded.
   */
  partial: boolean;
};

/**
 * How big the repository is, and which speed-ups are on.
 */
export type SpeedSettings = {
  /**
   * Files in the index.
   */
  files: number;
  /**
   * Big enough for the speed-ups to matter.
   */
  big: boolean;
  /**
   * None where git has no file watcher of its own (Linux, or git before 2.36).
   */
  fileWatcher: boolean | null;
  untrackedCache: boolean;
  commitGraph: boolean;
  maintenance: boolean;
  /**
   * Like "2.45.1".
   */
  gitVersion: string;
};

/**
 * One of git's speed-ups.
 */
export type SpeedUp =
  | "fileWatcher"
  | "untrackedCache"
  | "commitGraph"
  | "maintenance";

/**
 * A branch built on another unmerged branch.
 */
export type Stacked = {
  branch: string;
  /**
   * The branch it's built on.
   */
  on: string;
  /**
   * It's built on an earlier version of `on`, which has since been rewritten: it can be
   * moved onto the new one.
   */
  moved: boolean;
  /**
   * For a moved one: the earlier version of `on` it's built on.
   */
  old: string | null;
};

export type StepAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export type Submodule = {
  /**
   * Its name in `.gitmodules` (usually its path).
   */
  name: string;
  /**
   * Its folder, relative to this repository's.
   */
  path: string;
  url: string | null;
  state: SubmoduleState;
  /**
   * The commit this repository records for it.
   */
  recorded: string | null;
  /**
   * The commit checked out in it.
   */
  current: string | null;
  /**
   * Commits the recorded one has that the checked-out one doesn't, and the other way round.
   */
  behind: number;
  ahead: number;
  /**
   * It has uncommitted changes of its own.
   */
  changed: boolean;
};

/**
 * A submodule moved from one commit to another.
 */
export type SubmoduleChange = {
  before: string | null;
  after: string | null;
  /**
   * Its own files have uncommitted changes.
   */
  dirty: boolean;
  /**
   * The commits it moved forward by, newest first (or back by, when `rewound`), as far
   * as its checked-out copy knows them.
   */
  commits: Array<SubmoduleCommit>;
  rewound: boolean;
  /**
   * There are more commits than listed.
   */
  more: boolean;
};

export type SubmoduleCommit = { id: string; summary: string };

/**
 * Where a submodule is, compared with the commit this repository records for it.
 */
export type SubmoduleState =
  | "notSetUp"
  | "upToDate"
  | "behind"
  | "ahead"
  | "different"
  | "conflicted";

/**
 * What Diagnostics shows of the log and the saved crash reports.
 */
export type Summary = {
  /**
   * The folder with the log and the crash reports, once the app knows it.
   */
  folder: string | null;
  /**
   * The log's last few lines, oldest first.
   */
  recent: Array<string>;
  /**
   * The crash reports saved in the folder, newest first.
   */
  crashReports: Array<string>;
};

/**
 * Who committed where lately: people, the branches they work on, and how far those are from the main branch.
 */
export type TeamActivity = {
  /**
   * Since when (seconds since the Unix epoch), and over how many days.
   */
  since: number;
  days: number;
  /**
   * The branch the others are compared with, like "origin/main".
   */
  main: string;
  /**
   * Everyone who committed since then, the most recently active first.
   */
  people: Array<TeamPerson>;
  /**
   * Branches with commits since then (other than `main`), the most recent first.
   */
  branches: Array<BranchActivity>;
  /**
   * Commits on `main` itself since then.
   */
  mainCommits: number;
  /**
   * When each commit in the period before was made (on any branch), to compare with.
   */
  previous: Array<number>;
};

export type TeamPerson = {
  name: string;
  email: string;
  commits: number;
  /**
   * When they last committed.
   */
  latest: number;
  /**
   * The branches they committed to (`main` included).
   */
  branches: Array<string>;
  /**
   * When each of their commits was made, the newest first.
   */
  times: Array<number>;
};

/**
 * How many people committed, and how many commits, on any branch in the last `days` days.
 */
export type TeamPulse = { people: number; commits: number };

/**
 * What the team changed lately: kinds of file, hotspots, lines of code.
 */
export type TeamWork = {
  kinds: Array<KindCount>;
  /**
   * Who changed it (emails), the most first.
   */
  people: Array<PersonWork>;
  /**
   * Each commit's time, lines of code added and removed, and files changed.
   */
  commits: Array<WorkCommit>;
  hotspots: Array<Hotspot>;
};

/**
 * What `third_party_notices` gives back.
 */
export type ThirdPartyNotices = {
  /**
   * THIRD_PARTY_NOTICES.txt, as tools/notices.mjs writes it (see lib/notices.ts).
   */
  notices: string;
  /**
   * Tributary's own licence, when it's installed too.
   */
  license: string | null;
};

export type ToolChoice = {
  name: string;
  /**
   * Like "Meld" or "Beyond Compare".
   */
  label: string;
  /**
   * It can compare files, resolve conflicts, or both.
   */
  diff: boolean;
  merge: boolean;
};

/**
 * A repository's issue tracker, as set in its settings.
 */
export type Tracker = {
  kind: TrackerKind;
  /**
   * Jira's address (like `https://studio.atlassian.net`), or Linear's workspace (`studio`).
   */
  site: string;
  /**
   * Project (or team) keys, like FEAST; empty for any.
   */
  keys: Array<string>;
};

/**
 * Which tracker a repository's issues are in.
 */
export type TrackerKind =
  | "github"
  | "gitlab"
  | "jira"
  | "linear";

/**
 * Whether you're signed in to the tracker, and as whom.
 */
export type TrackerStatus = { signedIn: boolean; user: string | null };

/**
 * A repository's Unity project, and Smart Merge's setup for it.
 */
export type UnitySetup = {
  /**
   * There's a Unity project in it (at the top, or in a folder just below).
   */
  project: boolean;
  /**
   * The editor version it's made with, like "2022.3.10f1".
   */
  editorVersion: string | null;
  /**
   * The UnityYAMLMerge programs found on this computer, the project's version's first.
   */
  tools: Array<string>;
  /**
   * Scenes and prefabs are merged with Smart Merge (set up here, or by the team).
   */
  configured: boolean;
  /**
   * The program git runs to merge them, when set up.
   */
  configuredTool: string | null;
};

/**
 * A newer version that can be installed.
 */
export type UpdateInfo = {
  version: string;
  /**
   * The version running now.
   */
  current: string;
  /**
   * The release notes.
   */
  notes: string | null;
  /**
   * When it was released, like "2026-11-07T12:00:00Z".
   */
  date: string | null;
  /**
   * Downloaded (and its signature checked), ready to install.
   */
  ready: boolean;
};

export type Upstream = {
  /**
   * Like `origin/main`.
   */
  name: string;
  /**
   * Where it points, or `None` if it hasn't been fetched yet.
   */
  commit: string | null;
};

/**
 * What testing a commit showed.
 */
export type Verdict = "good" | "bad" | "skip";

/**
 * The kind of site a remote lives on, which decides how its pages are laid out.
 */
export type WebHost =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "gitea"
  | "other";

/**
 * A remote whose repository has a web page.
 */
export type WebRemote = {
  /**
   * The remote's name, like `origin`.
   */
  name: string;
  host: WebHost;
  /**
   * The repository's page, like `https://github.com/owner/repo`.
   */
  url: string;
};

export type WorkCommit = {
  time: number;
  /**
   * Lines of code it added and removed, and the files it changed.
   */
  added: number;
  removed: number;
  files: number;
};

/**
 * A working tree of the repository: the main one, or one linked with `git worktree add`.
 */
export type Worktree = {
  path: string;
  /**
   * The checked-out branch, like "feat/x", or None when HEAD is detached.
   */
  branch: string | null;
  /**
   * The checked-out commit.
   */
  head: string | null;
  /**
   * The repository's main working tree (the others are linked to it).
   */
  main: boolean;
  /**
   * The working tree that was asked about.
   */
  current: boolean;
  /**
   * Locked with `git worktree lock`, so it isn't pruned or removed.
   */
  locked: boolean;
  /**
   * Its folder is gone: pruning forgets it.
   */
  prunable: boolean;
};

export type WorktreeStatus = {
  /**
   * Changes in the index, compared to `HEAD`.
   */
  staged: Array<FileChange>;
  /**
   * Changes in the working tree, compared to the index, and untracked files.
   */
  unstaged: Array<FileChange>;
};
