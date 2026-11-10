//! Tributary's setup for Windows: a small window in the app's own style, around the NSIS
//! installer Tauri builds for the app. It shows the terms and where Tributary will go, then
//! runs that installer silently (`/S`) into the chosen folder, so everything the installer
//! does stays the same: the uninstall entry, the Start menu shortcut, and the automatic
//! updates, which use that installer directly.
//!
//! Without WebView2 (which only very old Windows 10 lacks) there's no window to show, so
//! the installer runs with its own pages instead.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

/// The version being installed (the release build sets it).
const VERSION: &str = match option_env!("TRIBUTARY_VERSION") {
    Some(version) => version,
    None => "dev",
};

/// Tauri's installer for the app (see build.rs).
#[cfg(has_installer)]
const INSTALLER: &[u8] = include_bytes!(env!("TRIBUTARY_INSTALLER"));
#[cfg(not(has_installer))]
const INSTALLER: &[u8] = &[];

/// What the window starts from.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    version: &'static str,
    /// Where it installs unless another folder is chosen.
    folder: String,
    /// Tributary is installed already: it's updated where it is.
    installed: Option<Installed>,
    /// How big the installer is, to pace the progress bar.
    size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Installed {
    folder: String,
    version: Option<String>,
}

/// Whether Tributary can be installed in a folder.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderCheck {
    ok: bool,
    /// "admin" when only an administrator can write there, or what else is wrong.
    problem: Option<String>,
}

#[tauri::command]
fn info() -> Info {
    let installed = platform::installed();
    Info {
        version: VERSION,
        folder: installed
            .as_ref()
            .map(|installed| installed.folder.clone())
            .unwrap_or_else(platform::default_folder),
        installed,
        size: INSTALLER.len(),
    }
}

/// Tributary can go in `folder`: the nearest folder of it that exists takes a new file.
/// Nothing is left behind (no folder is made just to check).
#[tauri::command]
fn check_folder(folder: String) -> FolderCheck {
    let mut existing = std::path::PathBuf::from(&folder);
    while !existing.is_dir() {
        if !existing.pop() {
            return FolderCheck {
                ok: false,
                problem: Some("That folder isn't on a drive this PC can reach.".into()),
            };
        }
    }
    let probe = existing.join(format!(".tributary-setup-{}", std::process::id()));
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            FolderCheck {
                ok: true,
                problem: None,
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => FolderCheck {
            ok: false,
            problem: Some("admin".into()),
        },
        Err(e) => FolderCheck {
            ok: false,
            problem: Some(format!("Tributary can't be installed there ({e}).")),
        },
    }
}

/// Windows' folder picker. A folder that isn't called Tributary gets one inside it, as
/// installers do, so Tributary's files don't mix with others.
#[tauri::command]
async fn choose_folder(app: AppHandle, current: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let start = std::path::PathBuf::from(&current);
    let start = start.parent().unwrap_or(&start).to_path_buf();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose where to install Tributary")
            .set_directory(start)
            .blocking_pick_folder()
    })
    .await
    .ok()??;
    let folder = picked.into_path().ok()?;
    let named = folder
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("Tributary"));
    Some(
        if named {
            folder
        } else {
            folder.join("Tributary")
        }
        .display()
        .to_string(),
    )
}

/// Tributary is open (installing would have to close it).
#[tauri::command]
fn running() -> bool {
    platform::running()
}

/// Install into `folder`, with the installer's own pages left out.
#[tauri::command]
async fn install(folder: String) -> Result<(), String> {
    if INSTALLER.is_empty() {
        return Err("This setup was built without Tributary inside it.".into());
    }
    tauri::async_runtime::spawn_blocking(move || platform::install(&folder))
        .await
        .map_err(|e| e.to_string())?
}

/// Start Tributary from `folder`, adding a desktop shortcut first if asked.
#[tauri::command]
fn open(folder: String, shortcut: bool) -> Result<(), String> {
    if shortcut {
        // A shortcut that couldn't be made isn't worth stopping for.
        let _ = platform::desktop_shortcut(&folder);
    }
    platform::open(&folder)
}

/// Add a desktop shortcut without opening Tributary (closing the window instead).
#[tauri::command]
fn add_shortcut(folder: String) -> Result<(), String> {
    platform::desktop_shortcut(&folder)
}

fn main() {
    if !platform::can_show_window() {
        platform::run_installer_with_its_pages();
        return;
    }
    let built = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            info,
            check_folder,
            choose_folder,
            running,
            install,
            open,
            add_shortcut
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
                .title("Install Tributary")
                .inner_size(720.0, 450.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .shadow(true)
                .center()
                .theme(Some(tauri::Theme::Dark))
                .background_color(tauri::window::Color(20, 22, 27, 255))
                // The window's browser data goes to a temporary folder, not next to the app's.
                .data_directory(std::env::temp_dir().join("tributary-setup"))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(error) = built {
        eprintln!("Tributary's setup couldn't start: {error}");
    }
}

#[cfg(windows)]
mod platform {
    use std::os::windows::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use super::{INSTALLER, Installed, VERSION};

    /// Don't flash a console window.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    /// Tributary keeps running after the setup closes.
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    /// Where the installer records the installed app (its `UNINSTKEY`).
    const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Tributary";

    pub fn can_show_window() -> bool {
        tauri::webview_version().is_ok()
    }

    pub fn default_folder() -> String {
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        local.join("Tributary").display().to_string()
    }

    pub fn installed() -> Option<Installed> {
        let key = windows_registry::CURRENT_USER.open(UNINSTALL_KEY).ok()?;
        let folder = key.get_string("InstallLocation").ok()?;
        let folder = folder.trim().trim_matches('"').to_string();
        if folder.is_empty() {
            return None;
        }
        Some(Installed {
            folder,
            version: key.get_string("DisplayVersion").ok(),
        })
    }

    pub fn running() -> bool {
        Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq tributary.exe", "/FO", "CSV", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok_and(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .to_ascii_lowercase()
                    .contains("\"tributary.exe\"")
            })
    }

    /// The installer, written where it can run from.
    fn installer_file() -> Result<PathBuf, String> {
        let path = std::env::temp_dir().join(format!("Tributary-{VERSION}-installer.exe"));
        std::fs::write(&path, INSTALLER)
            .map_err(|e| format!("Couldn't unpack the installer ({e})."))?;
        Ok(path)
    }

    pub fn install(folder: &str) -> Result<(), String> {
        let installer = installer_file()?;
        // `/S` silently; `/NS` without a desktop shortcut (the last page offers one);
        // `/D=` last and without quotes, as NSIS wants it, even with spaces.
        let status = Command::new(&installer)
            .args(["/S", "/NS"])
            .raw_arg(format!("/D={folder}"))
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        let _ = std::fs::remove_file(&installer);
        match status {
            Ok(status) if status.success() => Ok(()),
            Ok(status) => Err(match status.code() {
                Some(1) => {
                    "The installer stopped before finishing. Is Tributary still open?".into()
                }
                Some(code) => format!("The installer stopped with an error (code {code})."),
                None => "The installer stopped with an error.".into(),
            }),
            Err(e) => Err(format!("Couldn't start the installer ({e}).")),
        }
    }

    fn app(folder: &str) -> PathBuf {
        Path::new(folder).join("tributary.exe")
    }

    pub fn open(folder: &str) -> Result<(), String> {
        Command::new(app(folder))
            .current_dir(folder)
            .creation_flags(DETACHED_PROCESS)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Couldn't open Tributary ({e})."))
    }

    /// A shortcut on the desktop, made by Windows' own shell object (through PowerShell),
    /// on whichever folder the desktop really is (OneDrive moves it, for example).
    pub fn desktop_shortcut(folder: &str) -> Result<(), String> {
        let quote = |text: &str| format!("'{}'", text.replace('\'', "''"));
        let target = app(folder).display().to_string();
        let script = format!(
            "$desktop = [Environment]::GetFolderPath('Desktop'); \
             $link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Tributary.lnk')); \
             $link.TargetPath = {}; $link.WorkingDirectory = {}; $link.Save()",
            quote(&target),
            quote(folder)
        );
        let status = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("Couldn't add the shortcut ({e})."))?;
        if status.success() {
            Ok(())
        } else {
            Err("Couldn't add the shortcut.".into())
        }
    }

    pub fn run_installer_with_its_pages() {
        if let Ok(installer) = installer_file() {
            let _ = Command::new(installer).spawn();
        }
    }
}

/// Elsewhere there's nothing to install: enough to work on the window.
#[cfg(not(windows))]
mod platform {
    use super::Installed;

    pub fn can_show_window() -> bool {
        true
    }

    pub fn default_folder() -> String {
        std::env::temp_dir().join("Tributary").display().to_string()
    }

    pub fn installed() -> Option<Installed> {
        None
    }

    pub fn running() -> bool {
        false
    }

    pub fn install(_folder: &str) -> Result<(), String> {
        Err("Tributary's setup only installs on Windows.".into())
    }

    pub fn open(_folder: &str) -> Result<(), String> {
        Err("Tributary's setup only installs on Windows.".into())
    }

    pub fn desktop_shortcut(_folder: &str) -> Result<(), String> {
        Err("Tributary's setup only installs on Windows.".into())
    }

    pub fn run_installer_with_its_pages() {}
}
