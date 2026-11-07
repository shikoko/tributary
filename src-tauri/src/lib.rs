pub mod actions;
pub mod graph;
pub mod lfs;
pub mod links;
pub mod locks;
pub mod repo;
pub mod updates;

use std::path::PathBuf;

use tauri::{AppHandle, Emitter};

/// How many commits to load when the frontend doesn't ask for a specific amount.
const DEFAULT_LIMIT: usize = 10_000;

/// Load a repository's history and graph layout, and optionally its uncommitted changes.
/// With `first_parent`, only the checked-out branch's own history is loaded. `hidden`
/// refs (full names) are left out; when `solo` isn't empty, only those refs are shown.
#[tauri::command]
async fn open_repository(
    path: String,
    limit: Option<usize>,
    include_status: Option<bool>,
    first_parent: Option<bool>,
    hidden: Option<Vec<String>>,
    solo: Option<Vec<String>>,
) -> Result<repo::RepoSnapshot, String> {
    let path = PathBuf::from(path);
    let options = repo::LoadOptions {
        limit: limit.unwrap_or(DEFAULT_LIMIT),
        include_status: include_status.unwrap_or(true),
        first_parent: first_parent.unwrap_or(false),
        hidden: hidden.unwrap_or_default(),
        solo: solo.unwrap_or_default(),
    };
    tauri::async_runtime::spawn_blocking(move || repo::load_with(&path, options))
        .await
        .map_err(|e| e.to_string())?
}

/// Load the full message and changed files of one commit.
#[tauri::command]
async fn commit_details(path: String, id: String) -> Result<repo::CommitDetails, String> {
    let path = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || repo::details(&path, &id))
        .await
        .map_err(|e| e.to_string())?
}

/// Change the repository: commit, stash, checkout, branch, merge, fetch, pull, push, …
/// Returns a short message saying what happened. Fetches, pulls and pushes report
/// their progress as `action-progress` events.
#[tauri::command]
async fn run_action(
    app: AppHandle,
    path: String,
    action: actions::Action,
) -> Result<actions::Outcome, String> {
    let path = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || {
        actions::run_with_progress(&path, action, &|progress| {
            let _ = app.emit("action-progress", progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Clone `url` into a new folder `name` inside `parent`, reporting progress as
/// `action-progress` events. Returns the new repository's folder.
#[tauri::command]
async fn clone_repository(
    app: AppHandle,
    url: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        actions::clone_repository(&url, &PathBuf::from(parent), &name, &|progress| {
            let _ = app.emit("action-progress", progress);
        })
        .map(|path| path.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a new repository in an existing folder.
#[tauri::command]
async fn init_repository(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || actions::init_repository(&PathBuf::from(path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Local branches that could be pruned (gone from the remote, or merged).
#[tauri::command]
async fn prune_candidates(path: String) -> Result<actions::PruneInfo, String> {
    tauri::async_runtime::spawn_blocking(move || actions::prune_candidates(&PathBuf::from(path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Where branches were before Tributary deleted, reset, rebased or force-pushed them.
#[tauri::command]
async fn branch_backups(path: String) -> Result<Vec<actions::Backup>, String> {
    tauri::async_runtime::spawn_blocking(move || actions::backups(&PathBuf::from(path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Commits that deleting a branch would lose.
#[tauri::command]
async fn lost_commits(path: String, reference: String) -> Result<actions::LostCommits, String> {
    tauri::async_runtime::spawn_blocking(move || {
        actions::lost_commits(&PathBuf::from(path), &reference)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The files locked with Git LFS, and who locked them.
#[tauri::command]
async fn lfs_locks(path: String) -> Result<locks::Locks, String> {
    tauri::async_runtime::spawn_blocking(move || locks::locks(&PathBuf::from(path)))
        .await
        .map_err(|e| e.to_string())?
}

/// The commits that changed a file or folder.
#[tauri::command]
async fn file_history(path: String, file: String) -> Result<actions::FileHistory, String> {
    tauri::async_runtime::spawn_blocking(move || actions::file_history(&PathBuf::from(path), &file))
        .await
        .map_err(|e| e.to_string())?
}

/// A newer version of Tributary, if there is one.
#[tauri::command]
async fn check_for_update(app: AppHandle) -> Result<Option<updates::UpdateInfo>, String> {
    updates::check(&app).await
}

/// Install the update found by `check_for_update` and restart. Reports the download as
/// `update-progress` events.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    updates::install(&app).await
}

/// Stop the fetch, pull, push or clone that is running.
#[tauri::command]
fn cancel_action() -> bool {
    actions::cancel()
}

/// The git commands Tributary ran recently, oldest first. New ones arrive as
/// `activity` events.
#[tauri::command]
fn activity_log() -> Vec<actions::LogEntry> {
    actions::activity()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Pending::default())
        .setup(|app| {
            let handle = app.handle().clone();
            actions::on_activity(move |entry| {
                let _ = handle.emit("activity", entry);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_repository,
            commit_details,
            run_action,
            clone_repository,
            init_repository,
            prune_candidates,
            branch_backups,
            lost_commits,
            lfs_locks,
            file_history,
            check_for_update,
            install_update,
            cancel_action,
            activity_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
