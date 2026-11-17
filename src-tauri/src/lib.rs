//! Tributary: a git history graph viewer. The Rust side reads repositories with gix and
//! changes them with the user's own git; the frontend calls it through [`commands`].

pub mod accounts;
pub mod actions;
mod app_icon;
pub mod apps;
pub mod avatars;
#[cfg(test)]
mod bindings;
pub mod ci;
pub mod ci_log;
pub mod codeowners;
pub mod commands;
mod conditional;
pub mod diagnostics;
pub mod error;
pub mod git;
pub mod github;
pub mod gitlab;
pub mod graph;
pub mod host;
pub mod issues;
pub mod links;
pub mod locks;
pub mod problems;
pub mod repo;
pub mod requests;
pub mod reviews;
pub mod settings_repo;
pub mod since;
mod spelling;
pub mod textures;
pub mod unreal;
pub mod updates;
pub mod watch;
mod window_place;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The PATH for git and what it runs is worked out while the window opens: on a Mac it
    // asks the login shell, which can take a moment (see `host`).
    std::thread::spawn(|| {
        let _ = host::search_path();
    });
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
        .plugin(window_place::plugin())
        .manage(updates::Pending::default())
        .manage(watch::Watching::default())
        .setup(|app| {
            // The window goes back where it was (its display, place and size), and shows.
            window_place::restore(app.handle());
            let handle = app.handle().clone();
            git::on_activity(move |entry| {
                let _ = handle.emit("activity", entry);
            });
            app_icon::restore(app.handle());
            spelling::turn_on(app.handle());
            // The version it was built as (a release's, not Cargo.toml's), for the log and
            // Diagnostics.
            diagnostics::set_app_version(app.package_info().version.to_string());
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
        .invoke_handler(commands::handler())
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
