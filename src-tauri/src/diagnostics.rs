//! What to include when reporting a problem: versions, the platform, and how the open
//! repository is set up. Nothing secret goes in: credentials in remote addresses are left
//! out, and the user sees all of it before copying it.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use gix::bstr::ByteSlice;
use serde::Serialize;
use ts_rs::TS;

use crate::actions::{LfsHealth, lfs_health};
use crate::git::{Git, command};

/// For reporting a problem: versions, the platform, and how the repository is set up.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    /// Tributary's version.
    pub version: String,
    /// Like "macOS 15.1 (aarch64)".
    pub platform: String,
    /// `git --version`, or why git couldn't be run.
    pub git: String,
    /// Where that git is.
    pub git_path: Option<String>,
    /// `git lfs version`, if Git LFS is installed.
    pub git_lfs: Option<String>,
    pub repository: Option<RepositoryInfo>,
    /// What went wrong in the window lately, and the crash reports saved for sending.
    pub problems: crate::problems::Summary,
}

/// How a repository is set up.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    pub path: String,
    /// The checked-out branch, or the commit when HEAD is detached.
    pub head: String,
    /// "origin https://github.com/owner/name.git", without credentials.
    pub remotes: Vec<String>,
    /// Only some history was cloned (`--depth`).
    pub shallow: bool,
    /// Only some folders are checked out.
    pub sparse: bool,
    /// File contents are downloaded when needed (`--filter`).
    pub partial: bool,
    /// A merge, rebase, cherry-pick or revert waiting to be finished.
    pub operation: Option<String>,
    pub lfs: Option<LfsHealth>,
    /// Why the repository couldn't be read, if it couldn't.
    pub error: Option<String>,
}

/// The app's version, as the app knows it (set when it starts).
static APP_VERSION: OnceLock<String> = OnceLock::new();

/// The version the app was built as: a release gives it to Tauri when it's built (like
/// 0.2.1), while `Cargo.toml` keeps the version builds on your own computer use.
pub fn set_app_version(version: String) {
    let _ = APP_VERSION.set(version);
}

/// Tributary's version: as the app was built, or `Cargo.toml`'s before the app has started.
pub fn app_version() -> String {
    APP_VERSION
        .get()
        .cloned()
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_owned())
}

/// Gather the diagnostics, for the repository at `path` if one is open. Never fails:
/// what can't be found out says so.
pub fn diagnostics(path: Option<&Path>) -> Diagnostics {
    let git = Git::find(std::env::temp_dir());
    let (git_version, git_path, git_lfs) = match &git {
        Ok(git) => {
            let git = git.in_background();
            (
                git.run(&["--version"])
                    .map(|version| version.trim().to_owned())
                    .unwrap_or_else(|error| error.to_string()),
                Some(full_path(git.executable()).display().to_string()),
                git.run(&["lfs", "version"])
                    .ok()
                    .map(|version| version.trim().to_owned()),
            )
        }
        Err(error) => (error.to_string(), None, None),
    };
    Diagnostics {
        version: app_version(),
        platform: platform(),
        git: git_version,
        git_path,
        git_lfs,
        repository: path.map(repository_info),
        problems: crate::problems::summary(),
    }
}

fn repository_info(path: &Path) -> RepositoryInfo {
    let mut info = RepositoryInfo {
        path: path.display().to_string(),
        head: String::new(),
        remotes: Vec::new(),
        shallow: false,
        sparse: false,
        partial: false,
        operation: None,
        lfs: None,
        error: None,
    };
    let repo = match gix::discover(path) {
        Ok(repo) => repo,
        Err(error) => {
            info.error = Some(error.to_string());
            return info;
        }
    };
    info.head = match repo.head_name() {
        Ok(Some(name)) => name.shorten().to_str_lossy().into_owned(),
        _ => repo
            .head_id()
            .map(|id| format!("detached at {}", id.shorten_or_id()))
            .unwrap_or_else(|_| "no commits yet".to_owned()),
    };
    let config = repo.config_snapshot();
    for name in repo.remote_names() {
        let name = name.to_str_lossy();
        let url = config
            .string(format!("remote.{name}.url").as_str())
            .map(|url| without_credentials(&url.to_str_lossy()))
            .unwrap_or_default();
        info.remotes.push(format!("{name} {url}"));
        if config
            .boolean(format!("remote.{name}.promisor").as_str())
            .unwrap_or(false)
        {
            info.partial = true;
        }
    }
    info.shallow = repo.is_shallow().unwrap_or(false);
    info.sparse = config.boolean("core.sparseCheckout").unwrap_or(false);
    info.operation = repo.state().map(|state| format!("{state:?}"));
    info.lfs = lfs_health(path).ok().flatten();
    info
}

/// A remote's address without a user name and password or token in it:
/// `https://user:token@host/path` → `https://host/path`. SSH addresses like
/// `git@host:path` keep their user, which isn't secret.
pub fn without_credentials(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_owned();
    };
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let (authority, path) = rest.split_at(authority_end);
    match authority.rsplit_once('@') {
        Some((_, host)) if scheme != "ssh" => format!("{scheme}://{host}{path}"),
        _ => url.to_owned(),
    }
}

/// Where a program run by name (like `git`) is, found the way the system finds it: in
/// the folders on the `PATH`.
fn full_path(program: &Path) -> PathBuf {
    if program.components().count() > 1 {
        return program.to_owned();
    }
    let names = if cfg!(windows) {
        vec![program.with_extension("exe"), program.to_owned()]
    } else {
        vec![program.to_owned()]
    };
    std::env::var_os("PATH")
        .iter()
        .flat_map(std::env::split_paths)
        .flat_map(|folder| names.iter().map(move |name| folder.join(name)))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| program.to_owned())
}

/// The operating system, its version where it's easy to find, and the processor.
fn platform() -> String {
    let arch = std::env::consts::ARCH;
    match os_version() {
        Some(version) => format!("{version} ({arch})"),
        None => format!("{} ({arch})", std::env::consts::OS),
    }
}

fn os_version() -> Option<String> {
    let output = |program: &str, args: &[&str]| {
        command(Path::new(program))
            .args(args)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
            .filter(|text| !text.is_empty())
    };
    match std::env::consts::OS {
        "macos" => {
            output("sw_vers", &["-productVersion"]).map(|version| format!("macOS {version}"))
        }
        "windows" => output("cmd", &["/C", "ver"]),
        "linux" => std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|text| {
                text.lines().find_map(|line| {
                    let name = line.strip_prefix("PRETTY_NAME=")?;
                    Some(name.trim_matches('"').to_owned())
                })
            }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::without_credentials;

    #[test]
    fn leaves_credentials_out_of_remote_addresses() {
        assert_eq!(
            without_credentials("https://maya:ghp_secret@github.com/example/notebook.git"),
            "https://github.com/example/notebook.git"
        );
        assert_eq!(
            without_credentials("https://token@example.com"),
            "https://example.com"
        );
        assert_eq!(
            without_credentials("git@github.com:example/notebook.git"),
            "git@github.com:example/notebook.git"
        );
        assert_eq!(
            without_credentials("ssh://git@example.com/notebook.git"),
            "ssh://git@example.com/notebook.git"
        );
        assert_eq!(
            without_credentials("/srv/repos/a@b.git"),
            "/srv/repos/a@b.git"
        );
    }
}
