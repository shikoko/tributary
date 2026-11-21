//! Finding and running the computer's programs: git, what git runs (git-lfs, hooks), and the
//! editors, terminals and diff tools Tributary opens.
//!
//! On a Mac, an app opened from the Finder or the Dock gets only /usr/bin, /bin, /usr/sbin
//! and /sbin as its `PATH`, not the one a terminal has. So programs from Homebrew,
//! MacPorts or Nix, like git-lfs, would only be found when Tributary was started from a
//! terminal. The login shell is asked for its `PATH` instead, once, as a terminal would set
//! it up, and the folders those put programs in are added in case it doesn't have them.
//!
//! In its Flatpak, Tributary is sandboxed, but the programs it starts are the computer's,
//! outside it: git (a script in the Flatpak hands it to the computer's own, see
//! `flatpak/git`), and the editors, terminals and diff tools it opens. The computer's
//! programs are at /run/host inside the sandbox (with `--filesystem=host`), and they run
//! there through `flatpak-spawn --host`.

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Where the computer's own files are, seen from inside the sandbox.
const HOST: &str = "/run/host";

/// Whether Tributary is running in its Flatpak.
pub fn in_flatpak() -> bool {
    std::env::var_os("FLATPAK_ID").is_some()
}

/// A command for one of the computer's programs (git, ssh, an editor, the login shell…), with
/// the computer's environment rather than the one an AppImage set up for Tributary itself
/// (see [`appimage_changes`]). Every program Tributary starts goes through here.
pub(crate) fn program(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    for (name, value) in outside_appimage() {
        match value {
            Some(value) => command.env(name, value),
            None => command.env_remove(name),
        };
    }
    command
}

/// What to change in the environment Tributary was started with, for the programs it starts:
/// nothing, except in an AppImage.
fn outside_appimage() -> &'static [(OsString, Option<OsString>)] {
    static CHANGES: OnceLock<Vec<(OsString, Option<OsString>)>> = OnceLock::new();
    CHANGES.get_or_init(
        || match (std::env::var_os("APPIMAGE"), std::env::var_os("APPDIR")) {
            (Some(_), Some(appdir)) if !appdir.is_empty() => {
                appimage_changes(std::env::vars_os(), &appdir.to_string_lossy())
            }
            _ => Vec::new(),
        },
    )
}

/// An environment variable as the computer has it: as Tributary was started with it, without
/// what an AppImage put in it for itself.
fn started_var(name: &str) -> Option<OsString> {
    match outside_appimage()
        .iter()
        .find(|(changed, _)| changed == name)
    {
        Some((_, value)) => value.clone(),
        None => std::env::var_os(name),
    }
}

/// Variables an AppImage's launcher sets for the app inside it, with no folder of its own to
/// tell them by: its own markers, a GTK theme it chooses, and a Python setting.
const SET_BY_APPIMAGE: [&str; 6] = [
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "GTK_THEME",
    "PYTHONDONTWRITEBYTECODE",
];

/// How to undo, for the programs Tributary starts, what an AppImage's launcher set up for
/// Tributary (in `vars`, from the AppImage mounted at `appdir`). It puts its own folders first
/// in `LD_LIBRARY_PATH`, `PATH`, `PYTHONPATH` and others, and points GTK, GLib and Python at
/// itself, so a program that inherited them would load the AppImage's libraries instead of
/// its own: the computer's git then fails to fetch over HTTPS ("symbol lookup error" in
/// libcurl), and a hook in Python fails to start. Each variable that names a folder in the
/// AppImage loses it, and goes when nothing else is left in it. Variables are kept as they
/// are otherwise.
pub(crate) fn appimage_changes(
    vars: impl IntoIterator<Item = (OsString, OsString)>,
    appdir: &str,
) -> Vec<(OsString, Option<OsString>)> {
    let appdir = appdir.trim_end_matches('/');
    let inside = |entry: &str| entry == appdir || entry.starts_with(&format!("{appdir}/"));
    let mut changes = Vec::new();
    for (name, value) in vars {
        if SET_BY_APPIMAGE.iter().any(|set| name == *set) {
            changes.push((name, None));
            continue;
        }
        let Some(value) = value.to_str() else {
            continue;
        };
        if !value.contains(appdir) {
            continue;
        }
        if !value.split(':').any(inside) {
            continue;
        }
        let kept: Vec<&str> = value
            .split(':')
            .filter(|entry| !entry.is_empty() && !inside(entry))
            .collect();
        let value = (!kept.is_empty()).then(|| OsString::from(kept.join(":")));
        changes.push((name, value));
    }
    changes
}

/// Where to look for the computer's programs. Outside a Flatpak: the login shell's `PATH` on
/// a Mac, then the one Tributary was started with, then where Homebrew, MacPorts and Nix
/// put programs. In a Flatpak: the computer's usual folders, as the sandbox sees them, and
/// the person's own (their home is the same path inside and out).
pub fn search_path() -> Option<OsString> {
    if !in_flatpak() {
        static FULL: OnceLock<Option<OsString>> = OnceLock::new();
        return FULL.get_or_init(full_path).clone();
    }
    let mut folders: Vec<PathBuf> = ["/usr/local/bin", "/usr/bin", "/bin"]
        .iter()
        .map(|folder| Path::new(HOST).join(folder.trim_start_matches('/')))
        .collect();
    if let Some(home) = std::env::var_os("HOME") {
        folders.insert(0, PathBuf::from(home).join(".local/bin"));
    }
    std::env::join_paths(folders).ok()
}

/// The `PATH` for git and the programs Tributary starts, outside a Flatpak (see the top).
fn full_path() -> Option<OsString> {
    let started = started_var("PATH");
    if cfg!(windows) {
        return started;
    }
    let shell = if cfg!(target_os = "macos") {
        std::env::var_os("SHELL")
            .map(|shell| shell_path(Path::new(&shell)))
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let user = std::env::var("USER").ok();
    let usual = usual_folders(home.as_deref(), user.as_deref())
        .into_iter()
        .filter(|folder| folder.is_dir());
    let folders = merge(
        shell
            .into_iter()
            .chain(started.iter().flat_map(std::env::split_paths))
            .chain(usual),
    );
    std::env::join_paths(folders).ok().or(started)
}

/// Each folder once, in the order first seen.
fn merge(folders: impl Iterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut merged: Vec<PathBuf> = Vec::new();
    for folder in folders {
        if !folder.as_os_str().is_empty() && !merged.contains(&folder) {
            merged.push(folder);
        }
    }
    merged
}

/// Where Nix (a person's profile, nix-darwin's and NixOS's system ones), Homebrew (Apple
/// silicon, then Intel) and MacPorts put programs.
fn usual_folders(home: Option<&Path>, user: Option<&str>) -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if let Some(home) = home {
        folders.push(home.join(".nix-profile/bin"));
        folders.push(home.join(".local/state/nix/profile/bin"));
    }
    if let Some(user) = user {
        folders.push(Path::new("/etc/profiles/per-user").join(user).join("bin"));
    }
    folders.extend(
        [
            "/run/current-system/sw/bin",
            "/nix/var/nix/profiles/default/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/local/bin",
        ]
        .map(PathBuf::from),
    );
    folders
}

/// Said before and after the `PATH` the shell prints, to find it among whatever its startup
/// files print.
const MARK: &str = "__TRIBUTARY_PATH__";

/// The `PATH` the login shell at `shell` sets up, as in a new terminal (login and
/// interactive, so its profile and rc files run), or nothing when it fails or takes over
/// five seconds.
fn shell_path(shell: &Path) -> Vec<PathBuf> {
    // printenv prints it joined with colons whatever the shell keeps it as (fish keeps a list).
    let script = format!("echo {MARK}; /usr/bin/printenv PATH; echo {MARK}");
    let Ok(mut child) = program(shell)
        .args(["-l", "-i", "-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return Vec::new();
    };
    // Read as it comes, so a shell that prints a lot isn't held up by a full pipe.
    let reader = child.stdout.take().map(|mut stdout| {
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stdout.read_to_string(&mut text);
            text
        })
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Vec::new();
            }
        }
    }
    let text = reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    path_in(&text)
}

/// The `PATH` between two marks in what the shell printed: the last line that is all there
/// is between two (the script itself can turn up in what's printed too, from a shell that
/// shows its commands, say).
fn path_in(printed: &str) -> Vec<PathBuf> {
    let parts: Vec<&str> = printed.split(MARK).collect();
    if parts.len() < 3 {
        return Vec::new();
    }
    parts[1..parts.len() - 1]
        .iter()
        .map(|part| part.trim())
        .rfind(|part| !part.is_empty() && !part.contains('\n') && part.contains('/'))
        // A shell's PATH, joined with colons (split_paths would look for semicolons on Windows).
        .map(|path| {
            path.split(':')
                .filter(|folder| !folder.is_empty())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default()
}

/// A program's path as the computer knows it: /run/host/usr/bin/code is /usr/bin/code there.
fn outside(program: &Path) -> PathBuf {
    match program.strip_prefix(HOST) {
        Ok(rest) => Path::new("/").join(rest),
        Err(_) => program.to_path_buf(),
    }
}

/// `command` as it should run: unchanged outside a Flatpak; inside one, on the computer
/// through `flatpak-spawn --host`, in the same folder and with the environment it was given.
/// Call it once its program, arguments, environment and folder are set, and before its input
/// and output are (they're the new command's to set).
pub fn on_host(command: Command) -> Command {
    if !in_flatpak() {
        return command;
    }
    wrap(&command)
}

fn wrap(command: &Command) -> Command {
    let mut host = program("flatpak-spawn");
    // --watch-bus: what it started ends when Tributary does.
    host.arg("--host").arg("--watch-bus");
    if let Some(folder) = command.get_current_dir() {
        let mut flag = OsString::from("--directory=");
        flag.push(folder.as_os_str());
        host.arg(flag);
    }
    for (name, value) in command.get_envs() {
        let mut flag = OsString::from(if value.is_some() {
            "--env="
        } else {
            "--unset-env="
        });
        flag.push(name);
        if let Some(value) = value {
            flag.push("=");
            flag.push(value);
        }
        host.arg(flag);
    }
    host.arg(outside(Path::new(command.get_program())));
    host.args(command.get_args());
    host
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What the 0.15.0 AppImage's launcher and its GTK hook set, mounted at `/tmp/.mount_tribu`.
    fn appimage_environment() -> Vec<(OsString, OsString)> {
        let d = "/tmp/.mount_tribu";
        [
            ("APPDIR", d.to_owned()),
            ("APPIMAGE", "/home/rosa/Tributary.AppImage".to_owned()),
            ("ARGV0", "./Tributary.AppImage".to_owned()),
            ("OWD", "/home/rosa".to_owned()),
            (
                "PATH",
                format!("{d}/usr/bin/:{d}/usr/sbin/:{d}/bin/:/usr/local/bin:/usr/bin"),
            ),
            (
                "LD_LIBRARY_PATH",
                format!("{d}/usr/lib/:{d}/usr/lib/x86_64-linux-gnu/:{d}/lib/:"),
            ),
            ("PYTHONHOME", format!("{d}/usr/")),
            (
                "PYTHONPATH",
                format!("{d}/usr/share/pyshared/:/home/rosa/lib"),
            ),
            ("PYTHONDONTWRITEBYTECODE", "1".to_owned()),
            (
                "XDG_DATA_DIRS",
                format!("{d}/usr/share:/usr/share:/usr/local/share"),
            ),
            (
                "GDK_PIXBUF_MODULE_FILE",
                format!("{d}//usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache"),
            ),
            ("GTK_THEME", "Adwaita:dark".to_owned()),
            ("HOME", "/home/rosa".to_owned()),
            ("SSH_AUTH_SOCK", "/run/user/1000/ssh-agent".to_owned()),
            // Another AppImage's folder that only starts the same.
            (
                "EDITOR_HOME",
                "/tmp/.mount_tributary-other/share".to_owned(),
            ),
        ]
        .into_iter()
        .map(|(name, value)| (OsString::from(name), OsString::from(value)))
        .collect()
    }

    #[test]
    fn gives_programs_the_computer_s_environment_not_the_appimage_s() {
        let changes = appimage_changes(appimage_environment(), "/tmp/.mount_tribu");
        let change = |name: &str| {
            changes
                .iter()
                .find(|(changed, _)| changed == name)
                .map(|(_, value)| value.clone())
        };
        let kept = |value: &str| Some(Some(OsString::from(value)));
        // The AppImage's folders go; the computer's stay, in their order.
        assert_eq!(change("PATH"), kept("/usr/local/bin:/usr/bin"));
        assert_eq!(change("XDG_DATA_DIRS"), kept("/usr/share:/usr/local/share"));
        assert_eq!(change("PYTHONPATH"), kept("/home/rosa/lib"));
        // Nothing of the computer's in them: gone.
        for name in ["LD_LIBRARY_PATH", "PYTHONHOME", "GDK_PIXBUF_MODULE_FILE"] {
            assert_eq!(change(name), Some(None), "{name}");
        }
        // Set by the launcher for Tributary alone.
        for name in [
            "APPDIR",
            "APPIMAGE",
            "ARGV0",
            "OWD",
            "GTK_THEME",
            "PYTHONDONTWRITEBYTECODE",
        ] {
            assert_eq!(change(name), Some(None), "{name}");
        }
        // The rest as they are.
        for name in ["HOME", "SSH_AUTH_SOCK", "EDITOR_HOME"] {
            assert_eq!(change(name), None, "{name}");
        }
    }

    #[test]
    fn changes_nothing_but_the_markers_without_appimage_folders() {
        let vars = [("PATH", "/usr/bin"), ("HOME", "/home/rosa")]
            .into_iter()
            .map(|(name, value)| (OsString::from(name), OsString::from(value)));
        assert!(appimage_changes(vars, "/tmp/.mount_tribu").is_empty());
    }

    #[test]
    fn reads_the_path_a_shell_printed_among_other_things() {
        let printed = format!(
            "Last login: Mon\n+ echo {MARK}; /usr/bin/printenv PATH; echo {MARK}\n{MARK}\n/opt/homebrew/bin:/etc/profiles/per-user/maya/bin:/usr/bin\n{MARK}\nbye\n"
        );
        assert_eq!(
            path_in(&printed),
            [
                "/opt/homebrew/bin",
                "/etc/profiles/per-user/maya/bin",
                "/usr/bin"
            ]
            .map(PathBuf::from)
        );
        assert!(path_in("/usr/bin").is_empty(), "a PATH outside the marks");
        assert!(path_in(&format!("{MARK}\n/usr/bin")).is_empty(), "cut off");
    }

    #[test]
    fn asks_a_shell_for_its_path() {
        // sh is everywhere tests run but Windows; its PATH has at least /bin or /usr/bin.
        if cfg!(windows) {
            return;
        }
        let path = shell_path(Path::new("/bin/sh"));
        assert!(
            path.iter()
                .any(|folder| folder == Path::new("/usr/bin") || folder == Path::new("/bin")),
            "{path:?}"
        );
        assert!(shell_path(Path::new("/no/such/shell")).is_empty());
    }

    #[test]
    fn looks_where_nix_homebrew_and_macports_put_programs() {
        let folders = usual_folders(Some(Path::new("/Users/maya")), Some("maya"));
        for folder in [
            "/Users/maya/.nix-profile/bin",
            "/etc/profiles/per-user/maya/bin",
            "/run/current-system/sw/bin",
            "/nix/var/nix/profiles/default/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/local/bin",
        ] {
            assert!(
                folders.contains(&PathBuf::from(folder)),
                "{folder} isn't looked in"
            );
        }
    }

    #[test]
    fn keeps_each_folder_once_in_the_order_first_seen() {
        let merged = merge(
            [
                "/opt/homebrew/bin",
                "/usr/bin",
                "",
                "/opt/homebrew/bin",
                "/bin",
                "/usr/bin",
            ]
            .map(PathBuf::from)
            .into_iter(),
        );
        assert_eq!(
            merged,
            ["/opt/homebrew/bin", "/usr/bin", "/bin"].map(PathBuf::from)
        );
    }

    #[test]
    fn runs_the_computers_program_in_the_same_folder_with_its_environment() {
        let mut command = program("/run/host/usr/bin/code");
        command
            .arg("/home/maya/notebook")
            .current_dir("/home/maya/notebook")
            .env("GIT_DIR", "/home/maya/notebook/.git")
            .env_remove("GIT_INDEX_FILE");
        let host = wrap(&command);
        assert_eq!(host.get_program(), "flatpak-spawn");
        let args: Vec<_> = host
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "--host",
                "--watch-bus",
                "--directory=/home/maya/notebook",
                "--env=GIT_DIR=/home/maya/notebook/.git",
                "--unset-env=GIT_INDEX_FILE",
                "/usr/bin/code",
                "/home/maya/notebook",
            ]
        );
    }

    #[test]
    fn leaves_programs_elsewhere_as_they_are() {
        assert_eq!(
            outside(Path::new("/home/maya/.local/bin/zed")),
            PathBuf::from("/home/maya/.local/bin/zed")
        );
        assert_eq!(
            outside(Path::new("/run/host/bin/kitty")),
            PathBuf::from("/bin/kitty")
        );
    }
}
