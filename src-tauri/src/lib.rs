pub mod graph;
pub mod repo;

use std::path::PathBuf;

/// How many commits to load when the frontend doesn't ask for a specific amount.
const DEFAULT_LIMIT: usize = 10_000;

/// Load a repository's history and graph layout, and optionally its uncommitted changes.
#[tauri::command]
async fn open_repository(
    path: String,
    limit: Option<usize>,
    include_status: Option<bool>,
) -> Result<repo::RepoSnapshot, String> {
    let path = PathBuf::from(path);
    let limit = limit.unwrap_or(DEFAULT_LIMIT);
    let include_status = include_status.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || repo::load(&path, limit, include_status))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_repository, commit_details])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
