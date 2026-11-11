//! Tributary: a git history graph viewer. The Rust side reads repositories with gix and
//! changes them with the user's own git; the frontend calls it through [`commands`].

pub mod accounts;
pub mod actions;
mod app_icon;
pub mod apps;
pub mod avatars;
pub mod ci;
pub mod codeowners;
mod commands;
mod conditional;
pub mod diagnostics;
pub mod error;
pub mod git;
pub mod github;
pub mod gitlab;
pub mod graph;
pub mod issues;
pub mod links;
pub mod locks;
pub mod problems;
pub mod repo;
pub mod requests;
pub mod reviews;
pub mod settings_repo;
pub mod textures;
pub mod unreal;
pub mod updates;
pub mod watch;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // On macOS, WebKit's web content process can stop (out of memory, or a crash in WebKit),
    // which empties the window. Like Tauri does by default, it's loaded again, and also noted
    // in the problems log, said once it's back, and left alone if it keeps happening.
    #[cfg(target_os = "macos")]
    let builder = builder.on_web_content_process_terminate(|webview| {
        if problems::web_content_stopped()
            && let Err(error) = webview.reload()
        {
            problems::note(&format!("couldn't load the window again: {error}"));
        }
    });
    let app = builder
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
            // What goes wrong in the window is kept in a small log in the app's log folder.
            if let Ok(folder) = tauri::Manager::path(app).app_log_dir() {
                problems::keep_in(folder);
                // Crash reports from before this start (the window going blank last time).
                std::thread::spawn(problems::save_crash_reports);
            }
            // Authors' pictures are kept between sessions, to show at once.
            if let Ok(folder) = tauri::Manager::path(app).app_cache_dir() {
                avatars::keep_in(folder.join("avatars"));
            }
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
            commands::commit_template,
            commands::project_setup,
            commands::shelves,
            commands::take_snapshot,
            commands::local_history,
            commands::signing_settings,
            commands::unity_setup,
            commands::sparse_settings,
            commands::speed_settings,
            commands::patch_info,
            commands::merge_check,
            commands::code_owners,
            commands::branch_versions,
            commands::branch_stacks,
            commands::release_notes,
            commands::repo_size,
            commands::ignore_reason,
            commands::installed_apps,
            commands::open_in_app,
            commands::commit_states,
            commands::change_request,
            commands::commit_checks,
            commands::rerun_failed_checks,
            commands::save_settings_file,
            commands::read_settings_file,
            commands::export_settings_to_repository,
            commands::import_settings_from_repository,
            commands::publish_release,
            commands::range_diff,
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
            commands::team_work,
            commands::team_pulse,
            commands::recent_requests,
            commands::watch_repository,
            commands::stop_watching,
            commands::lfs_storage,
            commands::lfs_health,
            commands::diagnostics,
            commands::report_problem,
            commands::take_recovery_note,
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
            commands::forget_avatars,
            commands::forget_missing_avatars,
            commands::git_install,
            commands::look_for_git,
            commands::install_command_line_tools,
            commands::github_status,
            commands::github_sign_in,
            commands::github_sign_in_with_browser,
            commands::github_sign_out,
            commands::github_repositories,
            commands::gitlab_status,
            commands::gitlab_sign_in,
            commands::gitlab_sign_in_with_browser,
            commands::gitlab_sign_out,
            commands::gitlab_repositories,
            commands::reflog,
            commands::worktrees,
            commands::remote_state,
            commands::commits_between,
            commands::check_for_update,
            commands::download_update,
            commands::restart_to_update,
            commands::stop_update_restart,
            commands::third_party_notices,
            commands::cancel_action,
            commands::activity_log
        ])
        .build(tauri::generate_context!());
    match app {
        Ok(app) => app.run(|app, event| {
            // A downloaded update that wasn't restarted for is installed as Tributary quits.
            if let tauri::RunEvent::Exit = event {
                updates::install_on_quit(app);
            }
        }),
        // Nothing to show a window with: say why on the console, as the process ends.
        Err(error) => eprintln!("Tributary couldn't start: {error}"),
    }
}
