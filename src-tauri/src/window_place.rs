//! Where the window was: its display, its place on it, its size and whether it was
//! maximised, kept between starts (tauri-plugin-window-state). Without it, every start
//! opened a new window where the system puts one, on the main display, restarting for an
//! update included.

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

/// What's kept. Not whether it was shown (a window saved hidden would never be shown
/// again), nor its title bar (Windows has Tributary's own).
const KEPT: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED);

/// The window's label (the one in tauri.conf.json, which has none of its own).
const MAIN: &str = "main";

/// The plugin: it follows the window as it's moved and resized, and saves where it is as
/// Tributary quits, in the app's settings folder.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_window_state::Builder::default()
        .with_state_flags(KEPT)
        // Put back by `restore`, before the window is first shown.
        .skip_initial_state(MAIN)
        .build()
}

/// Put the window back where it was, then show it: it starts hidden (tauri.conf.json), so
/// it isn't seen on the main display first. If the display it was on isn't connected now,
/// the plugin leaves the place to the system, so it's never off screen.
pub fn restore<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    if let Err(error) = window.restore_state(KEPT) {
        crate::problems::note(&format!(
            "couldn't put the window back where it was: {error}"
        ));
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// Save where the window is now. Installing an update closes Tributary without the saving
/// it does as it quits (on Windows, the installer ends it straight away), so this comes first.
pub fn save<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = app.save_window_state(KEPT) {
        crate::problems::note(&format!("couldn't save where the window is: {error}"));
    }
}
