//! The working trees of a repository: the main one, and the ones linked to it with
//! `git worktree add`, each with its own branch checked out.

use std::path::{Path, PathBuf};

use gix::bstr::ByteSlice;
use serde::Serialize;

use super::open;
use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    /// The checked-out branch, like "feat/x", or None when HEAD is detached.
    pub branch: Option<String>,
    /// The checked-out commit.
    pub head: Option<String>,
    /// The repository's main working tree (the others are linked to it).
    pub main: bool,
    /// The working tree that was asked about.
    pub current: bool,
    /// Locked with `git worktree lock`, so it isn't pruned or removed.
    pub locked: bool,
    /// Its folder is gone: pruning forgets it.
    pub prunable: bool,
}

/// Every working tree of the repository at `path`, the main one first.
pub fn worktrees(path: &Path) -> Result<Vec<Worktree>, Error> {
    let repo = open(path)?;
    let here = repo.workdir().map(same_path);
    let main = repo
        .main_repo()
        .map_err(|e| Error::Message(format!("Couldn't read the main working tree ({e})")))?;
    let mut list = Vec::new();
    if let Some(workdir) = main.workdir() {
        let (branch, head) = checked_out(&main);
        list.push(Worktree {
            path: workdir.display().to_string(),
            current: here.as_ref() == Some(&same_path(workdir)),
            branch,
            head,
            main: true,
            locked: false,
            prunable: false,
        });
    }
    let linked = main
        .worktrees()
        .map_err(|e| Error::Message(format!("Couldn't list the worktrees ({e})")))?;
    for proxy in linked {
        let Ok(base) = proxy.base() else { continue };
        let locked = proxy.is_locked();
        let prunable = !base.exists();
        let (branch, head) = if prunable {
            (None, None)
        } else {
            proxy
                .into_repo_with_possibly_inaccessible_worktree()
                .map(|linked| checked_out(&linked))
                .unwrap_or((None, None))
        };
        list.push(Worktree {
            path: base.display().to_string(),
            current: here.as_ref() == Some(&same_path(&base)),
            branch,
            head,
            main: false,
            locked,
            prunable,
        });
    }
    Ok(list)
}

/// The checked-out branch (short name) and commit of a working tree.
fn checked_out(repo: &gix::Repository) -> (Option<String>, Option<String>) {
    let branch = repo
        .head_name()
        .ok()
        .flatten()
        .map(|name| name.shorten().to_str_lossy().into_owned());
    let head = repo.head_id().ok().map(|id| id.to_string());
    (branch, head)
}

/// A path to compare with others: resolved, when it exists.
fn same_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_owned())
}
