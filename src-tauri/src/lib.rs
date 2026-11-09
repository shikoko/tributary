//! Tributary: a git history graph viewer. The Rust side reads repositories with gix and
//! changes them with the user's own git; the frontend calls it through [`commands`].

pub mod actions;
mod app_icon;
pub mod avatars;
mod commands;
pub mod diagnostics;
pub mod error;
pub mod git;
pub mod github;
pub mod gitlab;
pub mod graph;
pub mod issues;
pub mod links;
pub mod locks;
pub mod repo;
pub mod requests;
pub mod reviews;
pub mod textures;
pub mod unreal;
pub mod updates;
pub mod watch;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Pending::default())
        .manage(watch::Watching::default())
        .setup(|app| {
            let handle = app.handle().clone();
            git::on_activity(move |entry| {
                let _ = handle.emit("activity", entry);
            });
            app_icon::restore(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_repository,
            commands::commit_details,
            commands::run_action,
            commands::clone_repository,
            commands::init_repository,
            commands::prune_candidates,
            commands::branch_backups,
            commands::lost_commits,
            commands::lfs_locks,
            commands::file_history,
            commands::file_checks,
            commands::changed_elsewhere,
            commands::submodules,
            commands::repo_identity,
            commands::signing_settings,
            commands::unity_setup,
            commands::sparse_settings,
            commands::speed_settings,
            commands::patch_info,
            commands::patch_text,
            commands::remotes,
            commands::repo_summary,
            commands::set_app_icon,
            commands::lfs_settings,
            commands::diff_tool_settings,
            commands::set_diff_tool,
            commands::file_diff,
            commands::conflict_text,
            commands::compare_commits,
            commands::actor_names,
            commands::blame_file,
            commands::search_commits,
            commands::team_activity,
            commands::watch_repository,
            commands::stop_watching,
            commands::lfs_storage,
            commands::lfs_health,
            commands::diagnostics,
            commands::pull_requests,
            commands::new_request_info,
            commands::create_pull_request,
            commands::pull_request_details,
            commands::request_conversation,
            commands::comment_on_request,
            commands::review_request,
            commands::merge_request,
            commands::issues,
            commands::my_issues,
            commands::tracker_status,
            commands::tracker_sign_in,
            commands::tracker_sign_out,
            commands::avatars,
            commands::github_status,
            commands::github_sign_in,
            commands::github_sign_in_with_browser,
            commands::github_sign_out,
            commands::reflog,
            commands::worktrees,
            commands::remote_state,
            commands::commits_between,
            commands::check_for_update,
            commands::install_update,
            commands::cancel_action,
            commands::activity_log
        ])
        .build(tauri::generate_context!());
    match app {
        Ok(app) => app.run(|_, _| {}),
        // Nothing to show a window with: say why on the console, as the process ends.
        Err(error) => eprintln!("Tributary couldn't start: {error}"),
    }
}
