//! Linked working trees (`git worktree`): another folder with another branch checked
//! out, sharing this repository's history, so two branches can be worked on at once.

use std::path::Path;

use super::support::ref_id;
use super::validate::{check_new_branch_name, commit_id};
use crate::error::{Error, Result};
use crate::git::Git;
use crate::repo::{Worktree, worktrees};

/// Check out `branch` in a new working tree at `path`: an existing local branch, or with
/// `create`, a new branch starting at commit `start`.
pub(super) fn add_worktree(
    repo: &gix::Repository,
    git: &Git,
    path: String,
    branch: String,
    create: bool,
    start: Option<String>,
) -> Result<String> {
    let folder = Path::new(&path);
    if !folder.is_absolute() {
        return Err("Choose where to put the new worktree.".into());
    }
    if folder
        .read_dir()
        .is_ok_and(|mut entries| entries.next().is_some())
        || folder.is_file()
    {
        return Err(format!("{path} isn't empty. Choose a new folder.").into());
    }
    if !folder.parent().is_some_and(Path::is_dir) {
        return Err(format!("The folder {path} would go in doesn't exist.").into());
    }
    if create {
        check_new_branch_name(repo, git, &branch)?;
        let start = commit_id(repo, start.as_deref().unwrap_or_default())?.to_string();
        git.run(&["worktree", "add", "-b", &branch, "--", &path, &start])?;
        Ok(format!("Made the branch {branch} in a new worktree"))
    } else {
        if branch.starts_with('-') || ref_id(repo, &format!("refs/heads/{branch}")).is_none() {
            return Err(format!("There's no local branch called {branch}.").into());
        }
        if let Some(other) = checked_out_in(repo, &branch) {
            return Err(format!("{branch} is already checked out in {}.", other.path).into());
        }
        git.run(&["worktree", "add", "--", &path, &branch])?;
        Ok(format!("Checked out {branch} in a new worktree"))
    }
}

/// Delete a linked working tree's folder, and forget it. Without `force`, git refuses
/// when it has uncommitted changes. The branch it had checked out stays.
pub(super) fn remove_worktree(
    repo: &gix::Repository,
    git: &Git,
    path: String,
    force: bool,
) -> Result<String> {
    let worktree = find(repo, &path)?;
    if worktree.main {
        return Err("The main working tree can't be removed.".into());
    }
    if worktree.current {
        return Err("Open another working tree to remove this one.".into());
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.extend(["--", &worktree.path]);
    git.run(&args).map_err(|error| {
        let message = error.to_string();
        if message.contains("--force") {
            Error::Message(format!(
                "{} has uncommitted changes. Remove it anyway to throw them away.",
                worktree.path
            ))
        } else {
            error
        }
    })?;
    let name = worktree.branch.unwrap_or_else(|| "its commit".into());
    Ok(format!("Removed the worktree of {name}"))
}

/// Forget working trees whose folders are gone.
pub(super) fn prune_worktrees(git: &Git) -> Result<String> {
    git.run(&["worktree", "prune"])?;
    Ok("Forgot the worktrees whose folders are gone".into())
}

/// The working tree at `path`, if it's one of the repository's.
fn find(repo: &gix::Repository, path: &str) -> Result<Worktree> {
    let wanted = Path::new(path)
        .canonicalize()
        .unwrap_or_else(|_| path.into());
    worktrees(repo.workdir().unwrap_or(repo.git_dir()))?
        .into_iter()
        .find(|worktree| {
            let known = Path::new(&worktree.path);
            known.canonicalize().unwrap_or_else(|_| known.to_owned()) == wanted
        })
        .ok_or_else(|| Error::Message(format!("{path} isn't a worktree of this repository.")))
}

/// Another working tree that has `branch` checked out.
fn checked_out_in(repo: &gix::Repository, branch: &str) -> Option<Worktree> {
    worktrees(repo.workdir()?)
        .ok()?
        .into_iter()
        .find(|worktree| worktree.branch.as_deref() == Some(branch))
}
