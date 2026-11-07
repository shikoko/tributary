//! Cloning and creating repositories.

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::git::{Git, Progress};

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
/// Reports progress like a fetch, and can be cancelled with [`cancel`].
pub fn clone_repository(
    url: &str,
    parent: &Path,
    name: &str,
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
    let git = Git::find(parent.to_owned())?;
    if let Err(error) =
        git.run_progress(&["clone", "--progress", "--", url, target_arg], on_progress)
    {
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
