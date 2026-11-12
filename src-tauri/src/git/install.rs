//! Finding the user's git: once, remembered, and looked for again when asked (after
//! installing it, say). Apps started from the macOS Finder don't get the shell's `PATH`, so
//! common install locations are tried too.
//!
//! On a Mac without Apple's Command Line Tools, `/usr/bin/git` is only a placeholder: each
//! time it runs, macOS opens a window offering to install them. So it's only run once the
//! tools are there (`xcode-select -p` says where they are, without asking anything).

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use ts_rs::TS;

use super::command;
use crate::error::{Error, Result};

/// The oldest git everything works with: checking a merge before doing it needs 2.38.
pub const RECOMMENDED: (u32, u32) = (2, 38);

/// Where git is (if it's anywhere), which version, and what's in the way when it isn't.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GitInstall {
    /// The git that runs, when there is one.
    pub path: Option<String>,
    /// Like "2.39.3".
    pub version: Option<String>,
    /// Older than [`RECOMMENDED`]: it works, but not everything does.
    pub old: bool,
    /// On a Mac: Apple's Command Line Tools (which bring git) aren't installed.
    pub needs_command_line_tools: bool,
}

static FOUND: Mutex<Option<GitInstall>> = Mutex::new(None);

/// The git found before, or looked for now.
pub fn installed() -> GitInstall {
    let mut found = FOUND.lock().unwrap_or_else(|e| e.into_inner());
    found.get_or_insert_with(look).clone()
}

/// Look for git again (it may have been installed since).
pub fn look_again() -> GitInstall {
    let mut found = FOUND.lock().unwrap_or_else(|e| e.into_inner());
    *found = Some(look());
    found.clone().unwrap_or_else(look)
}

/// The git program to run, if there is one.
pub(crate) fn executable() -> Option<PathBuf> {
    installed().path.map(PathBuf::from)
}

/// Open Apple's installer for the Command Line Tools (macOS only).
pub fn install_command_line_tools() -> Result<()> {
    if !cfg!(target_os = "macos") {
        return Err(Error::Message(
            "The Command Line Tools are only for macOS.".into(),
        ));
    }
    command(&PathBuf::from("/usr/bin/xcode-select"))
        .arg("--install")
        .spawn()
        .map(|_| ())
        .map_err(|e| Error::Message(format!("Couldn't open Apple's installer ({e}).")))
}

fn look() -> GitInstall {
    let tools = command_line_tools();
    for candidate in candidates() {
        // Without the tools, this is Apple's placeholder: running it opens their installer.
        if cfg!(target_os = "macos") && !tools && may_be_placeholder(&candidate) {
            continue;
        }
        let Ok(output) = command(&candidate).arg("--version").output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let version = parse_version(&String::from_utf8_lossy(&output.stdout));
        return GitInstall {
            path: Some(candidate.display().to_string()),
            old: version.as_deref().is_some_and(is_old),
            version,
            needs_command_line_tools: false,
        };
    }
    GitInstall {
        path: None,
        version: None,
        old: false,
        needs_command_line_tools: cfg!(target_os = "macos") && !tools,
    }
}

/// Where to look, in order: the `PATH` first, then where installers put it.
fn candidates() -> Vec<PathBuf> {
    let mut found = vec![PathBuf::from("git")];
    if cfg!(target_os = "macos") {
        found.extend(
            [
                "/opt/homebrew/bin/git",
                "/usr/local/bin/git",
                "/opt/local/bin/git",
                "/usr/bin/git",
            ]
            .map(PathBuf::from),
        );
    } else if cfg!(windows) {
        for base in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(folder) = std::env::var_os(base) {
                let folder = PathBuf::from(folder);
                let folder = if base == "LOCALAPPDATA" {
                    folder.join("Programs")
                } else {
                    folder
                };
                found.push(folder.join("Git").join("cmd").join("git.exe"));
            }
        }
    } else {
        found.extend(["/usr/bin/git", "/usr/local/bin/git"].map(PathBuf::from));
    }
    found
}

/// `git` from the `PATH` (which, started from the Finder, is /usr/bin) or /usr/bin/git.
fn may_be_placeholder(candidate: &std::path::Path) -> bool {
    candidate == std::path::Path::new("git") || candidate == std::path::Path::new("/usr/bin/git")
}

/// Apple's Command Line Tools (or Xcode) are installed. Always so elsewhere.
fn command_line_tools() -> bool {
    if !cfg!(target_os = "macos") {
        return true;
    }
    command(&PathBuf::from("/usr/bin/xcode-select"))
        .arg("-p")
        .output()
        .is_ok_and(|output| output.status.success() && !output.stdout.trim_ascii().is_empty())
}

/// "git version 2.43.0.windows.1" → "2.43.0".
fn parse_version(text: &str) -> Option<String> {
    let rest = text.trim().strip_prefix("git version ")?;
    let numbers: Vec<&str> = rest
        .split(|c: char| c == '.' || c.is_whitespace())
        .take_while(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
        .take(3)
        .collect();
    (!numbers.is_empty()).then(|| numbers.join("."))
}

/// Older than [`RECOMMENDED`].
fn is_old(version: &str) -> bool {
    let mut parts = version
        .split('.')
        .map(|part| part.parse::<u32>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    (major, minor) < RECOMMENDED
}

#[cfg(test)]
mod tests {
    use super::{is_old, parse_version};

    #[test]
    fn reads_gits_version() {
        assert_eq!(
            parse_version("git version 2.39.3 (Apple Git-146)\n").as_deref(),
            Some("2.39.3")
        );
        assert_eq!(
            parse_version("git version 2.43.0.windows.1").as_deref(),
            Some("2.43.0")
        );
        assert_eq!(
            parse_version("git version 2.45.2").as_deref(),
            Some("2.45.2")
        );
        assert_eq!(parse_version("hello"), None);
    }

    #[test]
    fn knows_when_git_is_too_old_for_everything() {
        assert!(is_old("2.30.1"));
        assert!(is_old("1.9.5"));
        assert!(!is_old("2.38.0"));
        assert!(!is_old("2.45.2"));
        assert!(!is_old("3.0.0"));
    }
}
