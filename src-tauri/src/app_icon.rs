//! The app's icon follows its theme: the light icon with a light theme, the dark one with a
//! dark theme. The installed app carries the light icon; while it runs, it shows the one for
//! its theme: in the Dock on macOS, on the taskbar elsewhere (the window's own icon). The
//! last theme is remembered, so the right icon shows from the start next time.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::Result;

#[cfg(target_os = "macos")]
const DOCK: [&[u8]; 2] = [
    include_bytes!("../icons/theme/light-dock.png"),
    include_bytes!("../icons/theme/dark-dock.png"),
];
#[cfg(not(target_os = "macos"))]
const WINDOW: [&[u8]; 2] = [
    include_bytes!("../icons/theme/light-window.png"),
    include_bytes!("../icons/theme/dark-window.png"),
];

/// Where the last theme is kept: "dark" or "light".
fn remembered(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|folder| folder.join("icon-theme"))
}

/// Show the icon for a `dark` (or light) theme, and remember it for next time.
pub fn set(app: &AppHandle, dark: bool) -> Result<()> {
    if let Some(file) = remembered(app) {
        let _ = file
            .parent()
            .map(std::fs::create_dir_all)
            .transpose()
            .and_then(|_| std::fs::write(&file, if dark { "dark" } else { "light" }));
    }
    show(app, dark)
}

/// At start-up: the icon for the theme the app had last time (the installed light icon if none).
pub fn restore(app: &AppHandle) {
    let dark = remembered(app)
        .and_then(|file| std::fs::read_to_string(file).ok())
        .is_some_and(|theme| theme.trim() == "dark");
    if dark {
        let _ = show(app, true);
    }
}

#[cfg(target_os = "macos")]
fn show(app: &AppHandle, dark: bool) -> Result<()> {
    let png = DOCK[usize::from(dark)];
    app.run_on_main_thread(move || macos::set_dock_icon(png))
        .map_err(|e| e.to_string().into())
}

#[cfg(not(target_os = "macos"))]
fn show(app: &AppHandle, dark: bool) -> Result<()> {
    let image =
        tauri::image::Image::from_bytes(WINDOW[usize::from(dark)]).map_err(|e| e.to_string())?;
    for window in app.webview_windows().values() {
        window.set_icon(image.clone()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    /// The Dock's icon for the app while it runs (`png` is a whole icon, tile and all).
    #[allow(unsafe_code)]
    pub(super) fn set_dock_icon(png: &'static [u8]) {
        let Some(main_thread) = MainThreadMarker::new() else {
            return;
        };
        let data = NSData::with_bytes(png);
        let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
            return;
        };
        let app = NSApplication::sharedApplication(main_thread);
        // SAFETY: AppKit's own setter, called on the main thread (checked above) with a valid,
        // retained image, the same call Tauri makes to show the icon in development.
        unsafe { app.setApplicationIconImage(Some(&image)) };
    }
}
