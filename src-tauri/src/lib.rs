pub mod actions;
pub mod graph;
pub mod repo;

use std::path::PathBuf;

use tauri::{AppHandle, Emitter};

/// How many commits to load when the frontend doesn't ask for a specific amount.
const DEFAULT_LIMIT: usize = 10_000;

/// Load a repository's history and graph layout, and optionally its uncommitted changes.
/// With `first_parent`, only the checked-out branch's own history is loaded.
#[tauri::command]
async fn open_repository(
    path: String,
    limit: Option<usize>,
    include_status: Option<bool>,
    first_parent: Option<bool>,
) -> Result<repo::RepoSnapshot, String> {
    let path = PathBuf::from(path);
    let options = repo::LoadOptions {
        limit: limit.unwrap_or(DEFAULT_LIMIT),
        include_status: include_status.unwrap_or(true),
        first_parent: first_parent.unwrap_or(false),
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
) -> Result<String, String> {
    let path = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || {
        actions::run_with_progress(&path, action, &|progress| {
            let _ = app.emit("action-progress", progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop the fetch, pull or push that is running.
#[tauri::command]
fn cancel_action() -> bool {
    actions::cancel()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_repository,
            commit_details,
            run_action,
            cancel_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
