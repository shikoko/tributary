//! Running the computer's programs from inside a Flatpak.
//!
//! In its Flatpak, Tributary is sandboxed, but the programs it starts are the computer's,
//! outside it: git (a script in the Flatpak hands it to the computer's own, see
//! `flatpak/git`), and the editors, terminals and diff tools it opens. The computer's
//! programs are at /run/host inside the sandbox (with `--filesystem=host`), and they run
//! there through `flatpak-spawn --host`. Outside a Flatpak, nothing here changes anything.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Where the computer's own files are, seen from inside the sandbox.
const HOST: &str = "/run/host";

/// Whether Tributary is running in its Flatpak.
pub fn in_flatpak() -> bool {
    std::env::var_os("FLATPAK_ID").is_some()
}

/// Where to look for the computer's programs: its usual folders, as the sandbox sees them,
/// and the person's own (their home is the same path inside and out). Outside a Flatpak, the
/// `PATH`.
pub fn search_path() -> Option<OsString> {
    if !in_flatpak() {
        return std::env::var_os("PATH");
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
    let mut host = Command::new("flatpak-spawn");
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

    #[test]
    fn runs_the_computers_program_in_the_same_folder_with_its_environment() {
        let mut command = Command::new("/run/host/usr/bin/code");
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
