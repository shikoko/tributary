//! Tributary's setup for Windows: a small window in the app's own style, around the NSIS
//! installers Tauri builds for the app. It shows the terms, then installs Tributary just for
//! you (no administrator needed) or, from Custom install, for everyone on the PC (Windows asks
//! for an administrator), in the folder chosen. The installers run silently (`/S`), so what
//! they do stays theirs: the uninstall entry, the Start menu shortcut, the folder remembered.
//!
//! It's also what the automatic updates download and run (Tauri's updater starts it with
//! `/UPDATE`). It updates the Tributary that started it, showing its own window when Tributary
//! is restarted for the update, and nothing when the update is installed as Tributary quits.
//!
//! Started with `/S`, it installs without a window (`/ALLUSERS` for everyone, from an
//! administrator's prompt), for IT departments' tools. Without WebView2 (which only very old
//! Windows 10 lacks), it runs the installer with its own pages.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// The version being installed (the release build sets it).
const VERSION: &str = match option_env!("TRIBUTARY_VERSION") {
    Some(version) => version,
    None => "dev",
};

/// Tauri's installer for the app, installing just for you (see build.rs).
#[cfg(has_installer)]
const JUST_ME: &[u8] = include_bytes!(env!("TRIBUTARY_INSTALLER"));
#[cfg(not(has_installer))]
const JUST_ME: &[u8] = &[];

/// The same, installing for everyone on the PC.
#[cfg(has_installer_all)]
const EVERYONE: &[u8] = include_bytes!(env!("TRIBUTARY_INSTALLER_ALL"));
#[cfg(not(has_installer_all))]
const EVERYONE: &[u8] = &[];

/// How the setup was started: its command line, sorted out.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Launch {
    /// The updater started it (`/UPDATE`).
    update: bool,
    /// Tributary opens again afterwards (`/R`: the person restarted for the update).
    restart: bool,
    /// No window (`/S`).
    silent: bool,
    /// For everyone on the PC (`/ALLUSERS`).
    everyone: bool,
    /// The folder of the Tributary being updated (`/INSTALLED=…`, which Tributary adds).
    installed: Option<String>,
    /// What goes on to the installer as it came: `/UPDATE`, `/R`, `/ARGS …`, `/NS`, `/D=…`.
    pass_on: Vec<String>,
}

fn parse(args: impl IntoIterator<Item = String>) -> Launch {
    let mut launch = Launch::default();
    for arg in args {
        let upper = arg.to_ascii_uppercase();
        match upper.as_str() {
            // Passive or silent, the installer runs silently: the setup shows its own window.
            "/P" => continue,
            "/S" => {
                launch.silent = true;
                continue;
            }
            "/ALLUSERS" => {
                launch.everyone = true;
                continue;
            }
            "/UPDATE" => launch.update = true,
            "/R" => launch.restart = true,
            _ => {}
        }
        if upper.starts_with("/INSTALLED=") {
            launch.installed = Some(arg["/INSTALLED=".len()..].trim_matches('"').to_string());
            continue;
        }
        launch.pass_on.push(arg);
    }
    launch
}

/// The installer's arguments: silently, then what came for it, with `/D=` last (NSIS reads
/// it only there).
fn installer_args(pass_on: &[String]) -> Vec<String> {
    let (folder, others): (Vec<&String>, Vec<&String>) = pass_on
        .iter()
        .partition(|arg| arg.to_ascii_uppercase().starts_with("/D="));
    std::iter::once("/S".to_string())
        .chain(others.into_iter().cloned())
        .chain(folder.into_iter().last().cloned())
        .collect()
}

/// A Tributary that's installed, and for whom.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Installed {
    folder: String,
    version: Option<String>,
    everyone: bool,
}

/// Same folder, written either way.
fn same_folder(a: &str, b: &str) -> bool {
    let clean = |path: &str| path.trim().trim_end_matches(['\\', '/']).to_lowercase();
    clean(a) == clean(b)
}

/// Which installed Tributary an update is for: the one in the folder Tributary gave, or the
/// one installed just for you, or the one for everyone.
fn target(installs: &[Installed], folder: Option<&str>) -> Option<Installed> {
    folder
        .and_then(|folder| {
            installs
                .iter()
                .find(|install| same_folder(&install.folder, folder))
        })
        .or_else(|| installs.first())
        .cloned()
}

/// What the window starts from.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    version: &'static str,
    /// Where it installs just for you, and for everyone, unless another folder is chosen.
    just_me_folder: String,
    everyone_folder: String,
    /// The setup can install for everyone too.
    can_install_for_everyone: bool,
    /// Tributary is installed already: it's updated where it is.
    installed: Option<Installed>,
    /// Started by the updater, with a window (Tributary is restarted for the update).
    update: bool,
    /// How big the installer is, to pace the progress bar.
    size: usize,
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
fn info(launch: State<Launch>) -> Info {
    let installs = platform::installs();
    let installed = if launch.update {
        target(&installs, launch.installed.as_deref())
    } else {
        installs.first().cloned()
    };
    Info {
        version: VERSION,
        just_me_folder: platform::default_folder(false),
        everyone_folder: platform::default_folder(true),
        can_install_for_everyone: !EVERYONE.is_empty(),
        size: if installed.as_ref().is_some_and(|i| i.everyone) {
            EVERYONE.len()
        } else {
            JUST_ME.len()
        },
        installed,
        update: launch.update,
    }
}

/// Tributary can go in `folder`: for everyone, the folder is on a drive that's there (an
/// administrator writes it); just for you, the nearest folder of it that exists takes a new
/// file. Nothing is left behind (no folder is made just to check).
#[tauri::command]
fn check_folder(folder: String, everyone: bool) -> FolderCheck {
    let mut existing = std::path::PathBuf::from(&folder);
    while !existing.is_dir() {
        if !existing.pop() {
            return FolderCheck {
                ok: false,
                problem: Some("That folder isn't on a drive this PC can reach.".into()),
            };
        }
    }
    if everyone {
        return FolderCheck {
            ok: true,
            problem: None,
        };
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

/// Install into `folder`, just for you or for everyone.
#[tauri::command]
async fn install(folder: String, everyone: bool) -> Result<(), String> {
    if (if everyone { EVERYONE } else { JUST_ME }).is_empty() {
        return Err("This setup was built without Tributary inside it.".into());
    }
    let args = installer_args(&["/NS".to_string(), format!("/D={folder}")]);
    tauri::async_runtime::spawn_blocking(move || platform::run_installer(everyone, &args, true))
        .await
        .map_err(|e| e.to_string())?
}

/// Started by the updater: update the Tributary it's for, and close (the installer opens
/// Tributary again).
#[tauri::command]
async fn update(app: AppHandle, launch: State<'_, Launch>) -> Result<(), String> {
    let launch = launch.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let everyone = target(&platform::installs(), launch.installed.as_deref())
            .is_some_and(|install| install.everyone);
        platform::run_installer(everyone, &installer_args(&launch.pass_on), true)
    })
    .await
    .map_err(|e| e.to_string())??;
    app.exit(0);
    Ok(())
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

/// Install or update without a window; the installer's exit code.
fn without_window(launch: &Launch) -> i32 {
    let everyone = if launch.update {
        let everyone = target(&platform::installs(), launch.installed.as_deref())
            .is_some_and(|install| install.everyone);
        // An update installed as Tributary quits doesn't ask for an administrator: it waits
        // for Restart to update instead.
        if everyone && !launch.restart {
            return 0;
        }
        everyone
    } else {
        launch.everyone
    };
    // Updates for everyone ask for an administrator; IT tools (`/S /ALLUSERS`) run as one.
    let elevate = launch.update && everyone;
    match platform::run_installer(everyone, &installer_args(&launch.pass_on), elevate) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

fn main() {
    let launch = parse(std::env::args().skip(1));
    let windowless = launch.silent || (launch.update && !launch.restart);
    if windowless || !platform::can_show_window() {
        if windowless || launch.update {
            std::process::exit(without_window(&launch));
        }
        platform::run_installer_with_its_pages();
        return;
    }
    let built = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(launch)
        .invoke_handler(tauri::generate_handler![
            info,
            check_folder,
            choose_folder,
            running,
            install,
            update,
            open,
            add_shortcut
        ])
        .setup(|app| {
            let title = if app.state::<Launch>().update {
                "Updating Tributary"
            } else {
                "Install Tributary"
            };
            WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
                .title(title)
                .inner_size(720.0, 480.0)
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

    use super::{EVERYONE, Installed, JUST_ME, VERSION};

    /// Don't flash a console window.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    /// Tributary keeps running after the setup closes.
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    /// Where the installers record the installed app (their `UNINSTKEY`), in the current
    /// user's registry or the PC's.
    const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Tributary";
    /// What the elevated installer's exit code is when the person said no to Windows.
    const CANCELLED: i32 = 1223;

    pub fn can_show_window() -> bool {
        tauri::webview_version().is_ok()
    }

    pub fn default_folder(everyone: bool) -> String {
        let base = if everyone {
            std::env::var_os("ProgramW6432").or_else(|| std::env::var_os("ProgramFiles"))
        } else {
            std::env::var_os("LOCALAPPDATA")
        };
        base.map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("Tributary")
            .display()
            .to_string()
    }

    /// Tributary as installed just for you, then for everyone.
    pub fn installs() -> Vec<Installed> {
        [
            (windows_registry::CURRENT_USER, false),
            (windows_registry::LOCAL_MACHINE, true),
        ]
        .into_iter()
        .filter_map(|(root, everyone)| {
            let key = root.open(UNINSTALL_KEY).ok()?;
            let folder = key.get_string("InstallLocation").ok()?;
            let folder = folder.trim().trim_matches('"').to_string();
            (!folder.is_empty()).then(|| Installed {
                folder,
                version: key.get_string("DisplayVersion").ok(),
                everyone,
            })
        })
        .collect()
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
    fn installer_file(everyone: bool) -> Result<PathBuf, String> {
        let (bytes, kind) = if everyone {
            (EVERYONE, "everyone")
        } else {
            (JUST_ME, "user")
        };
        if bytes.is_empty() {
            return Err("This setup was built without Tributary inside it.".into());
        }
        let path = std::env::temp_dir().join(format!("Tributary-{VERSION}-{kind}-installer.exe"));
        std::fs::write(&path, bytes)
            .map_err(|e| format!("Couldn't unpack the installer ({e})."))?;
        Ok(path)
    }

    /// Run an installer with `args` and wait for it. For everyone, with `elevate`, Windows
    /// asks for an administrator first.
    pub fn run_installer(everyone: bool, args: &[String], elevate: bool) -> Result<(), String> {
        let installer = installer_file(everyone)?;
        let code = if everyone && elevate {
            elevated(&installer, args)
        } else {
            let mut command = Command::new(&installer);
            for arg in args {
                // NSIS reads `/D=` without quotes, even with spaces.
                if arg.to_ascii_uppercase().starts_with("/D=") {
                    command.raw_arg(arg);
                } else {
                    command.arg(arg);
                }
            }
            command
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .map_err(|e| format!("Couldn't start the installer ({e})."))
                .map(|status| status.code().unwrap_or(-1))
        };
        let _ = std::fs::remove_file(&installer);
        match code? {
            0 => Ok(()),
            CANCELLED => Err(
                "Windows didn't get an administrator's permission, so nothing was changed.".into(),
            ),
            1 => Err("The installer stopped before finishing. Is Tributary still open?".into()),
            code => Err(format!(
                "The installer stopped with an error (code {code})."
            )),
        }
    }

    /// The installer started through Windows' "Run as administrator" (PowerShell's
    /// Start-Process -Verb RunAs), which shows the permission prompt; its exit code.
    fn elevated(installer: &Path, args: &[String]) -> Result<i32, String> {
        let quote = |text: &str| format!("'{}'", text.replace('\'', "''"));
        let list = args
            .iter()
            .map(|arg| quote(arg))
            .collect::<Vec<_>>()
            .join(",");
        let script = format!(
            "try {{ $p = Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -PassThru -ErrorAction Stop; $p.WaitForExit(); exit $p.ExitCode }} catch {{ exit {} }}",
            quote(&installer.display().to_string()),
            list,
            CANCELLED
        );
        Command::new("powershell")
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
            .map_err(|e| format!("Couldn't ask Windows for an administrator ({e})."))
            .map(|status| status.code().unwrap_or(-1))
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
        if let Ok(installer) = installer_file(false) {
            let _ = Command::new(installer).spawn();
        }
    }
}

/// Elsewhere there's nothing to install: enough to work on the window.
#[cfg(not(windows))]
mod platform {
    use super::Installed;

    const ONLY_WINDOWS: &str = "Tributary's setup only installs on Windows.";

    pub fn can_show_window() -> bool {
        true
    }

    pub fn default_folder(everyone: bool) -> String {
        std::env::temp_dir()
            .join(if everyone { "everyone" } else { "you" })
            .join("Tributary")
            .display()
            .to_string()
    }

    pub fn installs() -> Vec<Installed> {
        Vec::new()
    }

    pub fn running() -> bool {
        false
    }

    pub fn run_installer(_everyone: bool, _args: &[String], _elevate: bool) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }

    pub fn open(_folder: &str) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }

    pub fn desktop_shortcut(_folder: &str) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }

    pub fn run_installer_with_its_pages() {}
}

#[cfg(test)]
mod tests {
    use super::{Installed, Launch, installer_args, parse, target};

    fn args(line: &str) -> Vec<String> {
        line.split(' ').map(String::from).collect()
    }

    #[test]
    fn reads_what_the_updater_starts_it_with() {
        // Tauri's updater: passive, update, restart, the app's own arguments, then ours.
        let launch = parse(args("/P /UPDATE /R /ARGS /INSTALLED=C:\\Apps\\Tributary"));
        assert!(launch.update && launch.restart && !launch.silent && !launch.everyone);
        assert_eq!(launch.installed.as_deref(), Some("C:\\Apps\\Tributary"));
        assert_eq!(launch.pass_on, args("/UPDATE /R /ARGS"));
        assert_eq!(installer_args(&launch.pass_on), args("/S /UPDATE /R /ARGS"));
    }

    #[test]
    fn reads_an_update_at_quitting() {
        let launch = parse(args("/P /UPDATE"));
        assert!(launch.update && !launch.restart);
        assert_eq!(installer_args(&launch.pass_on), args("/S /UPDATE"));
    }

    #[test]
    fn reads_a_silent_install_for_everyone() {
        let launch = parse(args("/S /D=D:\\Tools\\Tributary /ALLUSERS /NS"));
        assert!(launch.silent && launch.everyone && !launch.update);
        // The folder goes last, as NSIS wants it.
        assert_eq!(
            installer_args(&launch.pass_on),
            args("/S /NS /D=D:\\Tools\\Tributary")
        );
    }

    #[test]
    fn updates_the_tributary_that_asked() {
        let installs = [
            Installed {
                folder: "C:\\Users\\maya\\AppData\\Local\\Tributary".into(),
                version: None,
                everyone: false,
            },
            Installed {
                folder: "C:\\Program Files\\Tributary".into(),
                version: None,
                everyone: true,
            },
        ];
        let everyone = |folder: Option<&str>| {
            target(&installs, folder).is_some_and(|install| install.everyone)
        };
        assert!(everyone(Some("c:\\program files\\tributary\\")));
        assert!(!everyone(Some(
            "C:\\Users\\maya\\AppData\\Local\\Tributary"
        )));
        // Unknown, or not said (an older Tributary): the one just for you first.
        assert!(!everyone(Some("D:\\Elsewhere")));
        assert!(!everyone(None));
        assert!(target(&installs[1..], None).is_some_and(|install| install.everyone));
        assert_eq!(Launch::default().installed, None);
    }
}
