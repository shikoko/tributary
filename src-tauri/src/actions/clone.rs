//! Cloning and creating repositories.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::git::{Git, Progress};

/// Ways to make a clone of a big repository smaller and quicker.
#[derive(Debug, Default, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct CloneOptions {
    /// Leave files stored with Git LFS as small pointer files, to download later (all at
    /// once, or as other branches are checked out).
    #[ts(as = "Option<_>", optional)]
    pub skip_lfs: bool,
    /// Only check out these folders (a sparse checkout). The contents of files outside
    /// them aren't downloaded at all.
    #[ts(as = "Option<_>", optional)]
    pub folders: Vec<String>,
    /// Only download this many of the latest commits (a shallow clone).
    #[ts(optional = nullable)]
    pub depth: Option<u32>,
    /// Also clone its submodules (and theirs), each at the commit it records.
    #[ts(as = "Option<_>", optional)]
    pub submodules: bool,
}

impl CloneOptions {
    /// The folders as git takes them: `Content/Maps`, without leading or trailing slashes.
    fn checked_folders(&self) -> Result<Vec<String>> {
        let mut folders = Vec::new();
        for folder in &self.folders {
            let folder = folder.trim().replace('\\', "/");
            let folder = folder.trim_matches('/');
            if folder.is_empty() {
                continue;
            }
            if folder.starts_with('-')
                || folder.contains(char::is_control)
                || folder.split('/').any(|part| part == ".." || part == ".")
            {
                return Err(format!("\"{folder}\" isn't a folder in the repository.").into());
            }
            if !folders.iter().any(|known| known == folder) {
                folders.push(folder.to_owned());
            }
        }
        Ok(folders)
    }
}

pub fn init_repository(path: &Path) -> Result<String, Error> {
    if !path.is_dir() {
        return Err(format!("{} isn't a folder.", path.display()).into());
    }
    if path.join(".git").exists() {
        return Err(format!("{} is already a git repository.", path.display()).into());
    }
    let git = Git::find(path.to_owned())?;
    git.run(&["init", "--quiet"])?;
    Ok(format!("Created a repository in {}", path.display()))
}

/// Clone `url` into a new folder called `name` inside `parent`, returning that folder.
/// Reports progress like a fetch, and can be cancelled with [`crate::git::cancel`].
pub fn clone_repository(
    url: &str,
    parent: &Path,
    name: &str,
    options: &CloneOptions,
    on_progress: &dyn Fn(Progress),
) -> Result<PathBuf, Error> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Enter the address of the repository to clone.".into());
    }
    if url.starts_with('-') || url.contains(char::is_control) || url.contains(' ') {
        return Err(format!("\"{url}\" doesn't look like a repository address.").into());
    }
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err("Choose a folder name, without slashes.".into());
    }
    if !parent.is_dir() {
        return Err(format!("{} isn't a folder.", parent.display()).into());
    }
    let target = parent.join(name);
    let existed = target.exists();
    let empty = || {
        std::fs::read_dir(&target)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false)
    };
    if existed && !(target.is_dir() && empty()) {
        return Err(format!(
            "{} already exists. Choose another name or folder.",
            target.display()
        )
        .into());
    }
    let target_arg = target
        .to_str()
        .ok_or("The folder's path has characters git can't be given here.")?;
    let folders = options.checked_folders()?;
    let depth = match options.depth {
        Some(0) => return Err("Download at least one commit.".into()),
        Some(depth) => Some(depth.to_string()),
        None => None,
    };
    let mut args = vec!["clone", "--progress"];
    if let Some(depth) = &depth {
        args.extend(["--depth", depth.as_str()]);
    }
    if !folders.is_empty() {
        // Only what's checked out is downloaded, so file contents come when they're needed.
        args.extend(["--filter=blob:none", "--sparse"]);
    }
    if options.submodules {
        args.push("--recurse-submodules");
        if depth.is_some() {
            args.push("--shallow-submodules");
        }
    }
    args.extend(["--", url, target_arg]);
    let env: &[(&str, &str)] = if options.skip_lfs {
        &[("GIT_LFS_SKIP_SMUDGE", "1")]
    } else {
        &[]
    };
    let git = Git::find(parent.to_owned())?;
    let cloned = git
        .run_progress_with_env(&args, env, on_progress)
        .and_then(|_| {
            if folders.is_empty() {
                return Ok(());
            }
            // Check out the chosen folders, downloading their files.
            let inside = Git::find(target.clone())?;
            let mut args = vec!["sparse-checkout", "set", "--cone"];
            args.extend(folders.iter().map(String::as_str));
            inside
                .run_progress_with_env(&args, env, on_progress)
                .map(|_| ())
        });
    if let Err(error) = cloned {
        // Don't leave a half-finished clone behind.
        if existed {
            if let Ok(entries) = std::fs::read_dir(&target) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let _ = if path.is_dir() {
                        std::fs::remove_dir_all(path)
                    } else {
                        std::fs::remove_file(path)
                    };
                }
            }
        } else {
            let _ = std::fs::remove_dir_all(&target);
        }
        return Err(error);
    }
    Ok(target)
}
