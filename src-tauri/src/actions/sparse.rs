//! Which folders are checked out (a sparse checkout, in git's cone mode): all of them, or
//! only some, changed after cloning. In a partial clone (one that downloads files as
//! they're needed), adding a folder downloads its files.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::support::{LITERAL, count};
use crate::error::{Error, Result};
use crate::git::{Git, Progress};

/// A folder that could be checked out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FolderChoice {
    /// Like "Content/Characters".
    pub path: String,
    /// It's inside another folder offered.
    pub nested: bool,
}

/// What's checked out, and what could be.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SparseSettings {
    /// Only some folders are checked out.
    pub sparse: bool,
    /// The sparse checkout is git's usual kind (by folders), which this app can change.
    pub cone: bool,
    /// The folders checked out, when only some are.
    pub folders: Vec<String>,
    /// The folders at the top of the checked-out commit, and those just inside them.
    pub available: Vec<FolderChoice>,
    /// A partial clone: files outside the checked-out folders aren't downloaded.
    pub partial: bool,
}

fn config_is_true(git: &Git, key: &str) -> bool {
    git.run(&["config", "--bool", "--get", key])
        .is_ok_and(|value| value.trim() == "true")
}

/// The folders (trees) directly inside `tree` (like "HEAD:" or "HEAD:Content").
fn folders_in(git: &Git, tree: &str) -> Vec<String> {
    git.run_with_env(&["ls-tree", "-d", "-z", "--name-only", tree], &LITERAL)
        .map(|output| {
            output
                .split('\0')
                .filter(|name| !name.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// How the repository's working tree is checked out, and the folders it could have.
pub fn sparse_settings(path: &Path) -> Result<SparseSettings> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree.")?
        .to_owned();
    let git = Git::find(workdir)?.in_background();
    let sparse = config_is_true(&git, "core.sparseCheckout");
    let cone = !sparse || config_is_true(&git, "core.sparseCheckoutCone");
    let folders = if sparse {
        git.run(&["sparse-checkout", "list"])
            .map(|list| {
                list.lines()
                    .map(|line| line.trim().trim_matches('/').to_owned())
                    .filter(|line| !line.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let partial = git
        .run(&[
            "config",
            "--get-regexp",
            r"^remote\..*\.partialclonefilter$",
        ])
        .is_ok_and(|found| !found.trim().is_empty());
    let mut available = Vec::new();
    for top in folders_in(&git, "HEAD:") {
        let inside = folders_in(&git, &format!("HEAD:{top}"));
        available.push(FolderChoice {
            path: top.clone(),
            nested: false,
        });
        available.extend(inside.into_iter().map(|name| FolderChoice {
            path: format!("{top}/{name}"),
            nested: true,
        }));
    }
    Ok(SparseSettings {
        sparse,
        cone,
        folders,
        available,
        partial,
    })
}

/// Whether `file` is checked out with only `folders` (files at the top always are).
fn kept(file: &str, folders: &[String]) -> bool {
    !file.contains('/')
        || folders
            .iter()
            .any(|folder| file.starts_with(&format!("{folder}/")))
}

/// Check out only `folders` (with the files at the top), or every folder when it's empty.
pub(super) fn set_sparse_folders(
    git: &Git,
    folders: Vec<String>,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    let mut folders: Vec<String> = folders
        .iter()
        .map(|folder| folder.trim().trim_matches('/').to_owned())
        .filter(|folder| !folder.is_empty())
        .collect();
    folders.sort();
    folders.dedup();
    if folders.iter().any(|folder| {
        folder.starts_with('-') || folder.split('/').any(|part| part == ".." || part == ".")
    }) {
        return Err("That isn't a folder in the repository.".into());
    }
    if folders.is_empty() {
        git.run_progress_with_env(&["sparse-checkout", "disable"], &[], on_progress)?;
        return Ok("Every folder is checked out".to_owned());
    }
    // Changes in folders that would go away: git would leave them behind, half there.
    let status = git.run(&["status", "--porcelain", "-z", "--untracked-files=all"])?;
    let changed: Vec<&str> = status
        .split('\0')
        .filter_map(|record| record.get(3..))
        .filter(|file| !file.is_empty() && !kept(file, &folders))
        .collect();
    if let Some(first) = changed.first() {
        let more = if changed.len() > 1 {
            format!(" (and {} more)", count(changed.len() - 1, "file"))
        } else {
            String::new()
        };
        return Err(format!(
            "{first}{more} has changes in a folder that wouldn't be checked out any more: commit or stash them first."
        )
        .into());
    }
    let mut args = vec!["sparse-checkout", "set", "--cone", "--"];
    args.extend(folders.iter().map(String::as_str));
    git.run_progress_with_env(&args, &[], on_progress)?;
    Ok(format!(
        "Checked out {}",
        if folders.len() == 1 {
            folders[0].clone()
        } else {
            count(folders.len(), "folder")
        }
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_files_at_the_top_and_in_the_folders() {
        let folders = vec!["Content/Characters".to_owned(), "Source".to_owned()];
        assert!(kept("README.md", &folders));
        assert!(kept("Source/Feast/Game.cpp", &folders));
        assert!(kept("Content/Characters/Barber.uasset", &folders));
        assert!(!kept("Content/Maps/Tavern.umap", &folders));
        assert!(!kept("Content/CharactersOld/x.uasset", &folders));
    }
}
