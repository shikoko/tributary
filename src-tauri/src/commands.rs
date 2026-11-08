//! The commands the frontend calls. Each one is a thin wrapper: it runs the work on a
//! blocking thread (reading a repository or running git can take a while), and reports
//! progress and activity as events.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter};

use crate::actions::{self, Action, Outcome};
use crate::error::{Error, Result};
use crate::{diagnostics, git, github, locks, repo, updates};

/// How many commits to load when the frontend doesn't ask for a specific amount.
const DEFAULT_LIMIT: usize = 10_000;

/// Run `work` on a thread that may block, without holding up the async runtime.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| Error::Message(format!("The work stopped unexpectedly ({e})")))?
}

/// Load a repository's history and graph layout, and optionally its uncommitted changes.
/// With `first_parent`, only the checked-out branch's own history is loaded. `hidden`
/// refs (full names) are left out; when `solo` isn't empty, only those refs are shown.
#[tauri::command]
pub async fn open_repository(
    path: String,
    limit: Option<usize>,
    include_status: Option<bool>,
    first_parent: Option<bool>,
    hidden: Option<Vec<String>>,
    solo: Option<Vec<String>>,
) -> Result<repo::RepoSnapshot> {
    let options = repo::LoadOptions {
        limit: limit.unwrap_or(DEFAULT_LIMIT),
        include_status: include_status.unwrap_or(true),
        first_parent: first_parent.unwrap_or(false),
        hidden: hidden.unwrap_or_default(),
        solo: solo.unwrap_or_default(),
    };
    blocking(move || repo::load_with(&PathBuf::from(path), options)).await
}

/// The full message and changed files of one commit.
#[tauri::command]
pub async fn commit_details(path: String, id: String) -> Result<repo::CommitDetails> {
    blocking(move || repo::details(&PathBuf::from(path), &id)).await
}

/// The files that differ between two commits (directly, or since they split), and how
/// many commits each has that the other doesn't.
#[tauri::command]
pub async fn compare_commits(
    path: String,
    from: String,
    to: String,
    split: bool,
) -> Result<repo::Comparison> {
    blocking(move || repo::compare(&PathBuf::from(path), &from, &to, split)).await
}

/// Change the repository: commit, stash, checkout, branch, merge, fetch, pull, push, …
/// Fetches, pulls and pushes report their progress as `action-progress` events.
#[tauri::command]
pub async fn run_action(app: AppHandle, path: String, action: Action) -> Result<Outcome> {
    blocking(move || {
        actions::run_with_progress(&PathBuf::from(path), action, &|progress| {
            let _ = app.emit("action-progress", progress);
        })
    })
    .await
}

/// Clone `url` into a new folder `name` inside `parent`, reporting progress as
/// `action-progress` events. Returns the new repository's folder. `options` can make the
/// clone smaller: without Git LFS files, only some folders, or only recent history.
#[tauri::command]
pub async fn clone_repository(
    app: AppHandle,
    url: String,
    parent: String,
    name: String,
    options: Option<actions::CloneOptions>,
) -> Result<String> {
    let options = options.unwrap_or_default();
    blocking(move || {
        actions::clone_repository(&url, &PathBuf::from(parent), &name, &options, &|progress| {
            let _ = app.emit("action-progress", progress);
        })
        .map(|path| path.display().to_string())
    })
    .await
}

/// Create a new repository in an existing folder.
#[tauri::command]
pub async fn init_repository(path: String) -> Result<String> {
    blocking(move || actions::init_repository(&PathBuf::from(path))).await
}

/// Local branches that could be pruned (gone from the remote, or merged).
#[tauri::command]
pub async fn prune_candidates(path: String) -> Result<actions::PruneInfo> {
    blocking(move || actions::prune_candidates(&PathBuf::from(path))).await
}

/// Where branches were before Tributary deleted, reset, rebased or force-pushed them.
#[tauri::command]
pub async fn branch_backups(path: String) -> Result<Vec<actions::Backup>> {
    blocking(move || actions::backups(&PathBuf::from(path))).await
}

/// Commits that deleting a branch would lose.
#[tauri::command]
pub async fn lost_commits(path: String, reference: String) -> Result<actions::LostCommits> {
    blocking(move || actions::lost_commits(&PathBuf::from(path), &reference)).await
}

/// The files locked with Git LFS, and who locked them.
#[tauri::command]
pub async fn lfs_locks(path: String) -> Result<locks::Locks> {
    blocking(move || locks::locks(&PathBuf::from(path))).await
}

/// The commits that changed a file or folder.
#[tauri::command]
pub async fn file_history(path: String, file: String) -> Result<actions::FileHistory> {
    blocking(move || actions::file_history(&PathBuf::from(path), &file)).await
}

/// Which changed files are big and not in Git LFS, and which are lockable.
#[tauri::command]
pub async fn file_checks(
    path: String,
    files: Vec<String>,
    threshold: u64,
) -> Result<actions::FileChecks> {
    blocking(move || actions::file_checks(&PathBuf::from(path), &files, threshold)).await
}

/// Whether Git LFS works in the repository: installed, set up, files downloaded.
#[tauri::command]
pub async fn lfs_health(path: String) -> Result<Option<actions::LfsHealth>> {
    blocking(move || actions::lfs_health(&PathBuf::from(path))).await
}

/// Files you're working on (`changed`: your uncommitted changes, plus your branch's
/// commits) that other recently changed branches also changed since yours split off.
#[tauri::command]
pub async fn changed_elsewhere(
    path: String,
    changed: Vec<String>,
) -> Result<Vec<actions::Overlap>> {
    blocking(move || actions::changed_elsewhere(&PathBuf::from(path), &changed)).await
}

/// The diff and merge tools set up in git, and with `list`, the ones it finds here.
#[tauri::command]
pub async fn diff_tool_settings(
    path: Option<String>,
    list: bool,
) -> Result<actions::DiffToolSettings> {
    blocking(move || actions::diff_tool_settings(path.as_deref().map(std::path::Path::new), list))
        .await
}

/// Open diffs (or conflicts) in this tool from now on, in every repository (git's own
/// `diff.tool` or `merge.tool`).
#[tauri::command]
pub async fn set_diff_tool(
    path: Option<String>,
    merge: bool,
    tool: Option<String>,
    command: Option<String>,
) -> Result<String> {
    blocking(move || {
        actions::set_diff_tool(
            path.as_deref().map(std::path::Path::new),
            merge,
            tool,
            command,
            actions::Scope::Global,
        )
    })
    .await
}

/// Which files the repository stores with Git LFS, and which big ones it could.
#[tauri::command]
pub async fn lfs_settings(path: String) -> Result<actions::LfsSettings> {
    blocking(move || actions::lfs_settings(&PathBuf::from(path))).await
}

/// Who commits are made as in the repository, here and usually.
#[tauri::command]
pub async fn repo_identity(path: String) -> Result<actions::RepoIdentity> {
    blocking(move || actions::repo_identity(&PathBuf::from(path))).await
}

/// The repository's submodules, and whether each is at the commit it records.
#[tauri::command]
pub async fn submodules(path: String) -> Result<Vec<actions::Submodule>> {
    blocking(move || actions::submodules(&PathBuf::from(path))).await
}

/// What changed in a file: in a commit, staged, or not staged yet.
#[tauri::command]
pub async fn file_diff(
    path: String,
    source: actions::DiffSource,
    file: String,
    old_path: Option<String>,
    ignore_whitespace: Option<bool>,
) -> Result<actions::FileDiff> {
    blocking(move || {
        actions::file_diff(
            &PathBuf::from(path),
            source,
            &file,
            old_path.as_deref(),
            ignore_whitespace.unwrap_or(false),
        )
    })
    .await
}

/// The commits in every branch that changed a file whose path matches `query`, or that
/// added or removed `query` in their code.
#[tauri::command]
pub async fn search_commits(
    path: String,
    mode: actions::SearchMode,
    query: String,
) -> Result<actions::SearchResult> {
    blocking(move || actions::search_commits(&PathBuf::from(path), mode, &query)).await
}

/// Who committed where in the last `days` days, on which branches.
#[tauri::command]
pub async fn team_activity(path: String, days: u32) -> Result<actions::TeamActivity> {
    blocking(move || actions::team_activity(&PathBuf::from(path), days)).await
}

/// Who changed each line of a file last: in the working tree, or at commit `at`.
#[tauri::command]
pub async fn blame_file(path: String, file: String, at: Option<String>) -> Result<actions::Blame> {
    blocking(move || actions::blame(&PathBuf::from(path), &file, at.as_deref())).await
}

/// A conflicted file as it is now, with its conflict markers, to resolve in the app.
#[tauri::command]
pub async fn conflict_text(path: String, file: String) -> Result<actions::ConflictText> {
    blocking(move || actions::conflict_text(&PathBuf::from(path), &file)).await
}

/// How much space the local copies of Git LFS files take.
#[tauri::command]
pub async fn lfs_storage(path: String) -> Result<Option<actions::LfsStorage>> {
    blocking(move || actions::lfs_storage_of(&PathBuf::from(path))).await
}

/// Profile pictures of these authors, as `data:` URLs (null for those without one).
#[tauri::command]
pub async fn avatars(
    path: String,
    emails: Vec<String>,
) -> Result<std::collections::HashMap<String, Option<String>>> {
    crate::avatars::avatars(&PathBuf::from(path), emails).await
}

/// The open pull requests on the repository's GitHub remote, or merge requests on its
/// GitLab one.
#[tauri::command]
pub async fn pull_requests(path: String) -> Result<Vec<github::PullRequest>> {
    github::open_requests(&PathBuf::from(path)).await
}

/// Who's signed in to GitHub (going by the token git keeps), and how one can sign in.
#[tauri::command]
pub async fn github_status() -> Result<github::account::GitHubStatus> {
    github::account::status().await
}

/// Sign in to GitHub with a personal access token, kept by git's credential helper.
#[tauri::command]
pub async fn github_sign_in(token: String) -> Result<github::account::Account> {
    github::account::sign_in_with_token(&token).await
}

/// Sign in to GitHub in the browser, with Git Credential Manager.
#[tauri::command]
pub async fn github_sign_in_with_browser() -> Result<github::account::Account> {
    github::account::sign_in_with_browser().await
}

/// Forget the GitHub token git keeps.
#[tauri::command]
pub async fn github_sign_out() -> Result<()> {
    blocking(github::account::sign_out).await
}

/// The repository's working trees: the main one and the linked ones.
#[tauri::command]
pub async fn worktrees(path: String) -> Result<Vec<repo::Worktree>> {
    blocking(move || repo::worktrees(&PathBuf::from(path))).await
}

/// HEAD's reflog, newest first.
#[tauri::command]
pub async fn reflog(path: String, limit: Option<usize>) -> Result<Vec<repo::ReflogEntry>> {
    blocking(move || repo::reflog(&PathBuf::from(path), limit.unwrap_or(300))).await
}

/// Where the remote branches point, and which one the checked-out branch tracks.
#[tauri::command]
pub async fn remote_state(path: String) -> Result<repo::RemoteState> {
    blocking(move || repo::remote_state(&PathBuf::from(path))).await
}

/// The commits reachable from `to` but not from `from`.
#[tauri::command]
pub async fn commits_between(path: String, from: String, to: String) -> Result<repo::NewCommits> {
    blocking(move || repo::commits_between(&PathBuf::from(path), &from, &to)).await
}

/// A newer version of Tributary, if there is one.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<updates::UpdateInfo>> {
    updates::check(&app).await
}

/// Install the update found by `check_for_update` and restart. Reports the download as
/// `update-progress` events.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<()> {
    updates::install(&app).await
}

/// Versions, the platform, and how the repository at `path` (if any) is set up, for
/// reporting a problem.
#[tauri::command]
pub async fn diagnostics(path: Option<String>) -> Result<diagnostics::Diagnostics> {
    blocking(move || {
        Ok(diagnostics::diagnostics(
            path.as_deref().map(std::path::Path::new),
        ))
    })
    .await
}

/// Stop the fetch, pull, push or clone that is running.
#[tauri::command]
pub fn cancel_action() -> bool {
    git::cancel()
}

/// The git commands Tributary ran recently, oldest first. New ones arrive as `activity`
/// events.
#[tauri::command]
pub fn activity_log() -> Vec<git::LogEntry> {
    git::activity()
}
