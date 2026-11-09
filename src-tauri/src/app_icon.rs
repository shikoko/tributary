//! The app's icon follows its theme: the light icon with a light theme, the dark one with a
//! dark theme. The installed app carries the light icon; while it runs, it shows the one for
//! its theme: in the Dock on macOS, on the taskbar on Windows (the window's big icon, which
//! Tauri doesn't set) and the window's icon on Linux. The last theme is remembered, so the
//! right icon shows from the start next time.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::Result;

#[cfg(target_os = "macos")]
const DOCK: [&[u8]; 2] = [
    include_bytes!("../icons/theme/light-dock.png"),
    include_bytes!("../icons/theme/dark-dock.png"),
];
/// Every size in one file, so Windows can pick the one for the screen's scaling.
#[cfg(windows)]
const ICO: [&[u8]; 2] = [
    include_bytes!("../icons/theme/light.ico"),
    include_bytes!("../icons/theme/dark.ico"),
];
#[cfg(all(not(target_os = "macos"), not(windows)))]
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

#[cfg(windows)]
fn show(app: &AppHandle, dark: bool) -> Result<()> {
    // Windows loads icons of the right size from files: keep the theme's beside the settings.
    let folder = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let file = folder.join(if dark {
        "icon-dark.ico"
    } else {
        "icon-light.ico"
    });
    let bytes = ICO[usize::from(dark)];
    if std::fs::read(&file).ok().as_deref() != Some(bytes) {
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
    }
    for window in app.webview_windows().values() {
        if let Ok(hwnd) = window.hwnd() {
            taskbar::set(hwnd, &file, dark);
        }
    }
    Ok(())
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
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

#[cfg(windows)]
mod taskbar {
    use std::collections::HashMap;
    use std::path::Path;
    use std::sync::Mutex;

    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows::Win32::UI::WindowsAndMessaging::{
        ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_LOADFROMFILE, LoadImageW, SM_CXICON, SM_CXSMICON,
        SendMessageW, WM_SETICON,
    };
    use windows::core::HSTRING;

    /// The icons loaded so far, by theme and size (as numbers: handles can't cross threads).
    /// Kept for the app's lifetime, so a window never shows a freed icon; there are only a few.
    static LOADED: Mutex<Option<HashMap<(bool, i32), isize>>> = Mutex::new(None);

    /// Give the window the icons in `ico`: the big one, which the taskbar and Alt+Tab show, and
    /// the small one, each at the size Windows wants for the window's screen.
    #[allow(unsafe_code)]
    pub(super) fn set(hwnd: HWND, ico: &Path, dark: bool) {
        let path = HSTRING::from(ico.as_os_str());
        let Ok(mut loaded) = LOADED.lock() else {
            return;
        };
        let loaded = loaded.get_or_insert_with(HashMap::new);
        // SAFETY: plain Win32 calls on the app's own window, whose handle comes from Tauri, with
        // icons loaded here from a file the app wrote; the icons are never freed (see LOADED).
        unsafe {
            let dpi = GetDpiForWindow(hwnd).max(96);
            for (kind, metric) in [(ICON_BIG, SM_CXICON), (ICON_SMALL, SM_CXSMICON)] {
                let size = GetSystemMetricsForDpi(metric, dpi);
                let icon = match loaded.get(&(dark, size)) {
                    Some(&icon) => icon,
                    None => {
                        match LoadImageW(None, &path, IMAGE_ICON, size, size, LR_LOADFROMFILE) {
                            Ok(handle) => {
                                let icon = handle.0 as isize;
                                loaded.insert((dark, size), icon);
                                icon
                            }
                            Err(_) => continue,
                        }
                    }
                };
                SendMessageW(
                    hwnd,
                    WM_SETICON,
                    Some(WPARAM(kind as usize)),
                    Some(LPARAM(icon)),
                );
            }
        }
    }
}
