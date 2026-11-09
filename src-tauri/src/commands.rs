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

/// Watch the open repository for changes made outside the app, emitting `repo-changed`
/// (with its path) after each burst of them. Replaces the repository watched before.
#[tauri::command]
pub async fn watch_repository(
    app: AppHandle,
    state: tauri::State<'_, crate::watch::Watching>,
    path: String,
) -> Result<()> {
    let workdir = PathBuf::from(&path);
    let emitter = app.clone();
    crate::watch::watch(&state, &workdir, move || {
        let _ = emitter.emit("repo-changed", path.clone());
    })
    .map_err(Into::into)
}

/// Stop watching (no repository is open).
#[tauri::command]
pub fn stop_watching(state: tauri::State<'_, crate::watch::Watching>) {
    crate::watch::stop(&state);
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

/// What the Unreal actors among `files` are (their names in the editor, classes and
/// levels), at commit `at`, or in the working tree. Files not there are read at
/// `fallback` (by default, the first parent or the checked-out commit).
#[tauri::command]
pub async fn actor_names(
    path: String,
    at: Option<String>,
    fallback: Option<String>,
    files: Vec<String>,
) -> Result<std::collections::HashMap<String, crate::unreal::ActorName>> {
    blocking(move || {
        crate::unreal::actor_names(
            &PathBuf::from(path),
            at.as_deref(),
            fallback.as_deref(),
            &files,
        )
    })
    .await
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
    deleted: Option<Vec<String>>,
    threshold: u64,
) -> Result<actions::FileChecks> {
    let deleted = deleted.unwrap_or_default();
    blocking(move || actions::file_checks(&PathBuf::from(path), &files, &deleted, threshold)).await
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

/// Where a recent repository stands: its branch, ahead and behind, uncommitted changes.
#[tauri::command]
pub async fn repo_summary(path: String) -> Result<repo::RepoSummary> {
    blocking(move || Ok(repo::summary(&PathBuf::from(path)))).await
}

/// Show the app's icon for its theme: dark or light.
#[tauri::command]
pub fn set_app_icon(app: tauri::AppHandle, dark: bool) -> Result<()> {
    crate::app_icon::set(&app, dark)
}

/// The repository's remotes and their addresses (without passwords or tokens).
#[tauri::command]
pub async fn remotes(path: String) -> Result<Vec<actions::RemoteInfo>> {
    blocking(move || actions::remotes(&PathBuf::from(path))).await
}

/// What a patch file holds, and whether it applies to the files as they are.
#[tauri::command]
pub async fn patch_info(path: String, file: String) -> Result<actions::PatchInfo> {
    blocking(move || actions::patch_info(&PathBuf::from(path), &PathBuf::from(file))).await
}

/// How merging `from` into `into` (the checked-out commit, when None) would go, without
/// merging: whether it conflicts, and where.
#[tauri::command]
pub async fn merge_check(
    path: String,
    from: String,
    into: Option<String>,
) -> Result<actions::MergeCheck> {
    blocking(move || actions::merge_check(&PathBuf::from(path), &from, into.as_deref())).await
}

/// Settings files are small: anything bigger isn't one.
const MOST_SETTINGS_BYTES: u64 = 5 * 1024 * 1024;

fn settings_file(file: &str) -> Result<PathBuf> {
    let path = PathBuf::from(file);
    if !path.is_absolute()
        || path
            .extension()
            .is_none_or(|ext| !ext.eq_ignore_ascii_case("json"))
    {
        return Err("Settings are saved as a .json file.".into());
    }
    Ok(path)
}

/// Save exported settings (JSON) to `file`, chosen by the user.
#[tauri::command]
pub async fn save_settings_file(file: String, text: String) -> Result<()> {
    blocking(move || {
        let path = settings_file(&file)?;
        if text.len() as u64 > MOST_SETTINGS_BYTES {
            return Err("Those settings are too big to save.".into());
        }
        std::fs::write(&path, text).map_err(|e| format!("Couldn't save {file}: {e}").into())
    })
    .await
}

/// Read settings exported from Tributary (JSON) from `file`, chosen by the user.
#[tauri::command]
pub async fn read_settings_file(file: String) -> Result<String> {
    blocking(move || {
        let path = settings_file(&file)?;
        let size = std::fs::metadata(&path)
            .map_err(|e| format!("Couldn't read {file}: {e}"))?
            .len();
        if size > MOST_SETTINGS_BYTES {
            return Err("That file is too big to be Tributary's settings.".into());
        }
        std::fs::read_to_string(&path).map_err(|e| format!("Couldn't read {file}: {e}").into())
    })
    .await
}

/// Change an open pull (or merge) request: ready or a draft, more reviewers, auto-merge.
#[tauri::command]
pub async fn change_request(
    path: String,
    number: u64,
    change: crate::requests::RequestChange,
) -> Result<String> {
    crate::requests::change_request(&PathBuf::from(path), number, change).await
}

/// The CI state of each of `ids` (on GitHub or GitLab) that has one.
#[tauri::command]
pub async fn commit_states(
    path: String,
    ids: Vec<String>,
) -> Result<std::collections::HashMap<String, crate::github::CheckState>> {
    crate::ci::commit_states(&PathBuf::from(path), ids).await
}

/// A commit's checks (GitHub) or latest pipeline's jobs (GitLab).
#[tauri::command]
pub async fn commit_checks(path: String, id: String) -> Result<crate::ci::CommitChecks> {
    crate::ci::commit_checks(&PathBuf::from(path), id).await
}

/// Run a commit's failed checks again.
#[tauri::command]
pub async fn rerun_failed_checks(path: String, id: String) -> Result<String> {
    crate::ci::rerun_failed(&PathBuf::from(path), id).await
}

/// The editors and terminals installed here.
#[tauri::command]
pub async fn installed_apps() -> Result<Vec<crate::apps::App>> {
    blocking(|| Ok(crate::apps::installed_apps())).await
}

/// Open the repository at `path` (and `file` in it, relative to its top, for an editor) in
/// an editor or terminal.
#[tauri::command]
pub async fn open_in_app(app: String, path: String, file: Option<String>) -> Result<()> {
    blocking(move || {
        let folder = PathBuf::from(&path);
        let file = match file {
            Some(file) => {
                let relative = std::path::Path::new(&file);
                if relative.is_absolute()
                    || relative
                        .components()
                        .any(|part| matches!(part, std::path::Component::ParentDir))
                {
                    return Err(format!("{file} isn't in this repository.").into());
                }
                Some(folder.join(relative))
            }
            None => None,
        };
        crate::apps::open_in(&app, &folder, file.as_deref())
    })
    .await
}

/// Why a file is ignored: the rule that leaves it out, if one does.
#[tauri::command]
pub async fn ignore_reason(path: String, file: String) -> Result<actions::IgnoreReason> {
    blocking(move || actions::ignore_reason(&PathBuf::from(path), &file)).await
}

/// What makes the repository big: the biggest files in its history, by folder and kind.
#[tauri::command]
pub async fn repo_size(path: String) -> Result<actions::RepoSize> {
    blocking(move || actions::repo_size(&PathBuf::from(path))).await
}

/// What went into `to` since `from` (the tag before it when None).
#[tauri::command]
pub async fn release_notes(
    path: String,
    to: String,
    from: Option<String>,
) -> Result<actions::ReleaseNotes> {
    blocking(move || actions::release_notes(&PathBuf::from(path), &to, from.as_deref())).await
}

/// Publish a release for a tag on the repository's site; returns its page.
#[tauri::command]
pub async fn publish_release(
    path: String,
    tag: String,
    title: String,
    notes: String,
) -> Result<String> {
    crate::requests::publish_release(&PathBuf::from(path), tag, title, notes).await
}

/// Local branches built on other unmerged branches, and those whose base was rewritten.
#[tauri::command]
pub async fn branch_stacks(path: String) -> Result<Vec<actions::Stacked>> {
    blocking(move || actions::branch_stacks(&PathBuf::from(path))).await
}

/// Where a branch pointed before, newest first (from its reflog).
#[tauri::command]
pub async fn branch_versions(path: String, name: String) -> Result<Vec<actions::BranchVersion>> {
    blocking(move || actions::branch_versions(&PathBuf::from(path), &name)).await
}

/// How version `new` of a branch differs from version `old`, commit by commit.
#[tauri::command]
pub async fn range_diff(
    path: String,
    old: String,
    new: String,
    base: Option<String>,
    branch: Option<String>,
) -> Result<actions::RangeDiff> {
    blocking(move || {
        actions::range_diff(
            &PathBuf::from(path),
            &old,
            &new,
            base.as_deref(),
            branch.as_deref(),
        )
    })
    .await
}

/// Who owns each of `files`, by the repository's CODEOWNERS (empty without one).
#[tauri::command]
pub async fn code_owners(
    path: String,
    files: Vec<String>,
) -> Result<Vec<crate::codeowners::FileOwners>> {
    blocking(move || {
        let path = PathBuf::from(path);
        let top = gix::discover(&path)
            .ok()
            .and_then(|repo| repo.workdir().map(PathBuf::from))
            .unwrap_or(path);
        Ok(crate::codeowners::owners_of(&top, &files))
    })
    .await
}

/// Commits as one patch, oldest first, to copy.
#[tauri::command]
pub async fn patch_text(path: String, ids: Vec<String>) -> Result<String> {
    blocking(move || actions::patch_text(&PathBuf::from(path), &ids)).await
}

/// How big the repository is, and which of git's speed-ups are on.
#[tauri::command]
pub async fn speed_settings(path: String) -> Result<actions::SpeedSettings> {
    blocking(move || actions::speed_settings(&PathBuf::from(path))).await
}

/// Which folders the repository has checked out, and which it could.
#[tauri::command]
pub async fn sparse_settings(path: String) -> Result<actions::SparseSettings> {
    blocking(move || actions::sparse_settings(&PathBuf::from(path))).await
}

/// The repository's Unity project, if it has one, and how Smart Merge is set up for it.
#[tauri::command]
pub async fn unity_setup(path: String) -> Result<actions::UnitySetup> {
    blocking(move || actions::unity_setup(&PathBuf::from(path))).await
}

/// How commits in a repository are signed, and the keys there are to sign with.
#[tauri::command]
pub async fn signing_settings(path: String) -> Result<actions::SigningSettings> {
    blocking(move || actions::signing_settings(&PathBuf::from(path))).await
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

/// Forget the authors' pictures kept on this computer (profile pictures were turned off).
#[tauri::command]
pub fn forget_avatars() {
    crate::avatars::forget();
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

/// What opening a pull request needs: the branches to merge into, and whether git has a token.
#[tauri::command]
pub async fn new_request_info(
    path: String,
    branch: String,
    local: Option<String>,
) -> Result<crate::requests::NewRequestInfo> {
    crate::requests::new_request_info(&PathBuf::from(path), branch, local).await
}

/// Open a pull request (GitHub) or merge request (GitLab).
#[tauri::command]
pub async fn create_pull_request(
    path: String,
    request: crate::requests::NewRequest,
) -> Result<github::PullRequest> {
    crate::requests::create_request(&PathBuf::from(path), request).await
}

/// A pull (or merge) request's description, reviews and checks.
#[tauri::command]
pub async fn pull_request_details(
    path: String,
    number: u64,
) -> Result<crate::requests::RequestDetails> {
    crate::requests::request_details(&PathBuf::from(path), number).await
}

/// A pull (or merge) request's conversation, and how it can be merged.
#[tauri::command]
pub async fn request_conversation(
    path: String,
    number: u64,
) -> Result<crate::reviews::Conversation> {
    crate::reviews::conversation(&PathBuf::from(path), number).await
}

/// Comment on a request, or reply in one of its threads.
#[tauri::command]
pub async fn comment_on_request(
    path: String,
    number: u64,
    body: String,
    thread: Option<String>,
) -> Result<String> {
    crate::reviews::comment(&PathBuf::from(path), number, body, thread).await
}

/// Approve a request, ask for changes, or comment on it as a review.
#[tauri::command]
pub async fn review_request(
    path: String,
    number: u64,
    verdict: crate::reviews::ReviewVerdict,
    body: String,
) -> Result<String> {
    crate::reviews::review(&PathBuf::from(path), number, verdict, body).await
}

/// The issues `keys` mentions (like "FEAST-12", or "#12") in the repository's tracker.
#[tauri::command]
pub async fn issues(
    path: String,
    tracker: crate::issues::Tracker,
    keys: Vec<String>,
) -> Result<Vec<crate::issues::Issue>> {
    crate::issues::issues(&PathBuf::from(path), &tracker, &keys).await
}

/// The open issues assigned to you in the repository's tracker.
#[tauri::command]
pub async fn my_issues(
    path: String,
    tracker: crate::issues::Tracker,
) -> Result<Vec<crate::issues::Issue>> {
    crate::issues::my_issues(&PathBuf::from(path), &tracker).await
}

/// Whether you're signed in to the tracker.
#[tauri::command]
pub async fn tracker_status(
    path: String,
    tracker: crate::issues::Tracker,
) -> Result<crate::issues::TrackerStatus> {
    crate::issues::tracker_status(&PathBuf::from(path), &tracker).await
}

/// Sign in to Jira or Linear: the key is checked, then kept by git's credential helper.
#[tauri::command]
pub async fn tracker_sign_in(
    tracker: crate::issues::Tracker,
    user: String,
    token: String,
) -> Result<crate::issues::TrackerStatus> {
    crate::issues::tracker_sign_in(&tracker, &user, &token).await
}

/// Forget Jira's or Linear's key.
#[tauri::command]
pub async fn tracker_sign_out(tracker: crate::issues::Tracker) -> Result<()> {
    blocking(move || crate::issues::tracker_sign_out(&tracker)).await
}

/// Merge a request on its site.
#[tauri::command]
pub async fn merge_request(
    path: String,
    number: u64,
    options: crate::reviews::MergeRequestOptions,
) -> Result<String> {
    crate::reviews::merge(&PathBuf::from(path), number, options).await
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
