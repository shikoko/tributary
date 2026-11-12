// Reading a repository: its history and graph, refs, uncommitted changes and commit details.
import { invoke } from "@tauri-apps/api/core";
import type { Bisect, BranchActivity, BranchVersion, CommitDetails, CommitPair, CommitRow, CommitSearchMode, CommitSignature, Comparison, FileChange, FileHistory, FileKind, FileStatus, FolderChoice, GraphLine, GraphRow, HiddenRef, Identity, IgnoreReason, InstalledApp, KindCount, MergeCheck, Operation, OperationKind, OtherChange, Overlap, PatchInfo, Person, RangeDiff, RecentRequest, RefKind, RefLabel, ReflogEntry, ReleaseNotes, RemoteState, RepoSize, RepoSnapshot, RepoSummary, RowKind, SparseSettings, SpeedSettings, SpeedUp, Stacked, TeamActivity, TeamPerson, TeamWork, Upstream, WebHost, WebRemote, Worktree, WorktreeStatus } from "./generated";
export type { Bisect, BranchActivity, BranchVersion, CommitDetails, CommitPair, CommitRow, CommitSearchMode, CommitSignature, Comparison, FileChange, FileHistory, FileKind, FileStatus, FolderChoice, GraphLine, GraphRow, HiddenRef, Identity, IgnoreReason, InstalledApp, KindCount, MergeCheck, Operation, OperationKind, OtherChange, Overlap, PatchInfo, Person, RangeDiff, RecentRequest, RefKind, RefLabel, ReflogEntry, ReleaseNotes, RemoteState, RepoSize, RepoSnapshot, RepoSummary, RowKind, SparseSettings, SpeedSettings, SpeedUp, Stacked, TeamActivity, TeamPerson, TeamWork, Upstream, WebHost, WebRemote, Worktree, WorktreeStatus };

/** The id of the row for uncommitted changes. */
export const WORKTREE_ID = "worktree";

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

/** Which branches the graph shows: hidden ones are left out; if any are soloed, only those. */
export interface Visibility {
  hidden: string[];
  solo: string[];
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

/** The commits (newest first, in every branch) that changed a matching file, or added or removed the code. */
export function searchCommits(path: string, mode: CommitSearchMode, query: string): Promise<{ ids: string[]; truncated: boolean }> {
  return invoke<{ ids: string[]; truncated: boolean }>("search_commits", { path, mode, query });
}

/** Compare commit `to` with `from`: directly, or with `split`, since they split (like a pull request). */
export function compareCommits(path: string, from: string, to: string, split: boolean): Promise<Comparison> {
  return invoke<Comparison>("compare_commits", { path, from, to, split });
}

/** `file` is relative to the repository's root, or an absolute path inside it. */
export function fileHistory(path: string, file: string): Promise<FileHistory> {
  return invoke<FileHistory>("file_history", { path, file });
}

export function worktrees(path: string): Promise<Worktree[]> {
  return invoke<Worktree[]>("worktrees", { path });
}

export function reflog(path: string, limit?: number): Promise<ReflogEntry[]> {
  return invoke<ReflogEntry[]>("reflog", { path, limit });
}

export function remoteState(path: string): Promise<RemoteState> {
  return invoke<RemoteState>("remote_state", { path });
}

export function commitsBetween(path: string, from: string, to: string): Promise<{ count: number; authors: string[] }> {
  return invoke("commits_between", { path, from, to });
}

/** Of `changed` (your uncommitted changes) and your branch's own changes: the files recently changed branches also changed. */
export function changedElsewhere(path: string, changed: string[]): Promise<Overlap[]> {
  return invoke<Overlap[]>("changed_elsewhere", { path, changed });
}

export function teamActivity(path: string, days: number): Promise<TeamActivity> {
  return invoke<TeamActivity>("team_activity", { path, days });
}

export function teamWork(path: string, days: number): Promise<TeamWork> {
  return invoke<TeamWork>("team_work", { path, days });
}

/** How many people committed, and how many commits, on any branch in the last `days` days. */
export function teamPulse(path: string, days: number): Promise<{ people: number; commits: number }> {
  return invoke("team_pulse", { path, days });
}

export function recentRequests(path: string): Promise<RecentRequest[]> {
  return invoke<RecentRequest[]>("recent_requests", { path });
}

export function repoSummary(path: string): Promise<RepoSummary> {
  return invoke<RepoSummary>("repo_summary", { path });
}

export function sparseSettings(path: string): Promise<SparseSettings> {
  return invoke<SparseSettings>("sparse_settings", { path });
}

export function speedSettings(path: string): Promise<SpeedSettings> {
  return invoke<SpeedSettings>("speed_settings", { path });
}

export function patchInfo(path: string, file: string): Promise<PatchInfo> {
  return invoke<PatchInfo>("patch_info", { path, file });
}

/** Commits as one patch, oldest first. */
export function patchText(path: string, ids: string[]): Promise<string> {
  return invoke<string>("patch_text", { path, ids });
}

/** How merging `from` into `into` (the checked-out commit, when left out) would go. */
export function mergeCheck(path: string, from: string, into?: string): Promise<MergeCheck> {
  return invoke<MergeCheck>("merge_check", { path, from, into: into ?? null });
}

/** Who owns each of `files`, by the repository's CODEOWNERS (empty when it has none). */
export function codeOwners(path: string, files: string[]): Promise<{ path: string; owners: string[] }[]> {
  return invoke<{ path: string; owners: string[] }[]>("code_owners", { path, files });
}

/** Where branch `name` (like "fix/door" or "origin/fix/door") pointed, newest first. */
export function branchVersions(path: string, name: string): Promise<BranchVersion[]> {
  return invoke<BranchVersion[]>("branch_versions", { path, name });
}

/**
 * How version `next` of a branch differs from version `old`, commit by commit; `base`: the
 * branch both are on top of (found from `branch`'s remote when left out).
 */
export function rangeDiff(path: string, old: string, next: string, base?: string | null, branch?: string): Promise<RangeDiff> {
  return invoke<RangeDiff>("range_diff", { path, old, new: next, base: base ?? null, branch: branch ?? null });
}

/** The local branches built on other unmerged branches, and those whose base was rewritten. */
export function branchStacks(path: string): Promise<Stacked[]> {
  return invoke<Stacked[]>("branch_stacks", { path });
}

/** What went into `to` since `from` (the tag before it when left out). */
export function releaseNotes(path: string, to: string, from?: string | null): Promise<ReleaseNotes> {
  return invoke<ReleaseNotes>("release_notes", { path, to, from: from ?? null });
}

/** Publish a release for `tag` (pushed already) on GitHub or GitLab; resolves to its page. */
export function publishRelease(path: string, tag: string, title: string, notes: string): Promise<string> {
  return invoke<string>("publish_release", { path, tag, title, notes });
}

export function repoSize(path: string): Promise<RepoSize> {
  return invoke<RepoSize>("repo_size", { path });
}

/** Why `file` (absolute, or relative to the repository's top) is ignored. */
export function ignoreReason(path: string, file: string): Promise<IgnoreReason> {
  return invoke<IgnoreReason>("ignore_reason", { path, file });
}

export function installedApps(): Promise<InstalledApp[]> {
  return invoke<InstalledApp[]>("installed_apps");
}

/** Open the repository at `path` (and `file` in it, for an editor) in app `app`. */
export function openInApp(app: string, path: string, file?: string): Promise<void> {
  return invoke<void>("open_in_app", { app, path, file: file ?? null });
}

/** Save exported settings (JSON text) to a .json file the user chose. */
export function saveSettingsFile(file: string, text: string): Promise<void> {
  return invoke<void>("save_settings_file", { file, text });
}

/** Read a file of settings exported from Tributary. */
export function readSettingsFile(file: string): Promise<string> {
  return invoke<string>("read_settings_file", { file });
}

/** Export settings (JSON text) to a git repository of your own: committed and pushed with your git. */
export function exportSettingsToRepository(url: string, contents: string): Promise<string> {
  return invoke<string>("export_settings_to_repository", { url, contents });
}

/** The settings exported to a git repository, as JSON text. */
export function importSettingsFromRepository(url: string): Promise<string> {
  return invoke<string>("import_settings_from_repository", { url });
}
