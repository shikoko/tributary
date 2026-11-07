//! Checks on values that end up on git's command line: commit ids must be full ids of
//! existing commits, names must exist or be valid, so nothing can be taken for an option.

use std::path::Path;

use gix::ObjectId;
use gix::bstr::ByteSlice;

use crate::error::{Error, Result};
use crate::git::Git;

pub(super) fn check_paths(paths: &[String]) -> Result<Vec<&str>, Error> {
    if paths.is_empty() {
        return Err("No files given.".into());
    }
    Ok(paths.iter().map(String::as_str).collect())
}

/// Paths of files in the working tree, relative to its root.
pub(super) fn check_file_paths(paths: &[String]) -> Result<Vec<&str>, Error> {
    let paths = check_paths(paths)?;
    if let Some(bad) = paths
        .iter()
        .find(|path| path.is_empty() || path.starts_with('-') || Path::new(path).is_absolute())
    {
        return Err(format!("{bad} isn't a file in this repository.").into());
    }
    Ok(paths)
}

/// `.gitignore` patterns: one line each.
pub(super) fn check_patterns(patterns: &[String]) -> Result<Vec<&str>, Error> {
    let patterns: Vec<&str> = patterns
        .iter()
        .map(|pattern| pattern.trim())
        .filter(|pattern| !pattern.is_empty())
        .collect();
    if patterns.is_empty() || patterns.iter().any(|pattern| pattern.contains('\n')) {
        return Err("Nothing to ignore.".into());
    }
    Ok(patterns)
}

/// The full id of an existing commit, from its full hex id.
pub(super) fn commit_id(repo: &gix::Repository, id: &str) -> Result<ObjectId, Error> {
    let oid = ObjectId::from_hex(id.as_bytes()).map_err(|_| format!("Invalid commit id {id}"))?;
    repo.find_commit(oid)
        .map_err(|e| format!("Could not find commit {id}: {e}"))?;
    Ok(oid)
}

/// Full ids of distinct existing commits.
pub(super) fn commit_ids(repo: &gix::Repository, ids: &[String]) -> Result<Vec<ObjectId>, Error> {
    if ids.is_empty() {
        return Err("No commits given.".into());
    }
    let mut seen = std::collections::HashSet::new();
    ids.iter()
        .map(|id| {
            let oid = commit_id(repo, id)?;
            if !seen.insert(oid) {
                return Err(format!("{id} is listed twice.").into());
            }
            Ok(oid)
        })
        .collect()
}

pub(super) fn require_ref(
    repo: &gix::Repository,
    full_name: &str,
    name: &str,
) -> Result<(), Error> {
    if name.starts_with('-') || repo.try_find_reference(full_name).ok().flatten().is_none() {
        return Err(format!("There is no branch called {name}.").into());
    }
    Ok(())
}

pub(super) fn require_tag(repo: &gix::Repository, name: &str) -> Result<(), Error> {
    if name.starts_with('-')
        || repo
            .try_find_reference(format!("refs/tags/{name}").as_str())
            .ok()
            .flatten()
            .is_none()
    {
        return Err(format!("There is no tag called {name}.").into());
    }
    Ok(())
}

pub(super) fn check_new_branch_name(
    repo: &gix::Repository,
    git: &Git,
    name: &str,
) -> Result<(), Error> {
    if name.is_empty() {
        return Err("Enter a name for the new branch.".into());
    }
    if name.starts_with('-') || git.run(&["check-ref-format", "--branch", name]).is_err() {
        return Err(format!(
            "\"{name}\" isn't a valid branch name. Avoid spaces and characters like ~ ^ : ? * [ \\."
        )
        .into());
    }
    if repo
        .try_find_reference(format!("refs/heads/{name}").as_str())
        .ok()
        .flatten()
        .is_some()
    {
        return Err(format!("A branch called {name} already exists.").into());
    }
    Ok(())
}

pub(super) fn check_new_tag_name(
    repo: &gix::Repository,
    git: &Git,
    name: &str,
) -> Result<(), Error> {
    if name.is_empty() {
        return Err("Enter a name for the tag.".into());
    }
    if name.starts_with('-')
        || git
            .run(&["check-ref-format", &format!("refs/tags/{name}")])
            .is_err()
    {
        return Err(format!(
            "\"{name}\" isn't a valid tag name. Avoid spaces and characters like ~ ^ : ? * [ \\."
        )
        .into());
    }
    if repo
        .try_find_reference(format!("refs/tags/{name}").as_str())
        .ok()
        .flatten()
        .is_some()
    {
        return Err(format!("A tag called {name} already exists.").into());
    }
    Ok(())
}

/// The name of a configured remote.
pub(super) fn known_remote(repo: &gix::Repository, name: &str) -> Result<String, Error> {
    let known = repo
        .remote_names()
        .iter()
        .any(|remote| remote.to_str_lossy() == name);
    if !known || name.starts_with('-') {
        return Err(format!("There's no remote called {name}.").into());
    }
    Ok(name.to_owned())
}

/// A full commit id, or the short name of an existing branch, remote branch or tag.
pub(super) fn revision_name(repo: &gix::Repository, target: &str) -> Result<String, Error> {
    if let Ok(id) = commit_id(repo, target) {
        return Ok(id.to_string());
    }
    let exists = ["refs/heads/", "refs/remotes/", "refs/tags/"]
        .iter()
        .any(|prefix| {
            repo.try_find_reference(format!("{prefix}{target}").as_str())
                .ok()
                .flatten()
                .is_some()
        });
    if target.starts_with('-') || !exists {
        return Err(format!("There's no branch or tag called {target}.").into());
    }
    Ok(target.to_owned())
}

/// The short name of the checked-out branch.
pub(super) fn current_branch(repo: &gix::Repository) -> Result<String, Error> {
    repo.head_name()
        .ok()
        .flatten()
        .and_then(|name| {
            name.as_bstr()
                .to_str()
                .ok()?
                .strip_prefix("refs/heads/")
                .map(str::to_owned)
        })
        .ok_or_else(|| "Check out a branch first: HEAD is detached.".into())
}

/// The git command for the merge, rebase, cherry-pick or revert in progress.
pub(super) fn in_progress(repo: &gix::Repository) -> Result<&'static str, Error> {
    use gix::state::InProgress;
    match repo.state() {
        Some(InProgress::Merge) => Ok("merge"),
        Some(InProgress::Rebase | InProgress::RebaseInteractive) => Ok("rebase"),
        Some(InProgress::CherryPick | InProgress::CherryPickSequence) => Ok("cherry-pick"),
        Some(InProgress::Revert | InProgress::RevertSequence) => Ok("revert"),
        Some(_) => Err("Another git operation is in progress. Finish it in a terminal.".into()),
        None => Err("There's no merge, rebase, cherry-pick or revert in progress.".into()),
    }
}
