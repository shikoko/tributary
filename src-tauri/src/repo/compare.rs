//! Comparing two commits (or the branches at them): the files that differ, directly or
//! since they split, and how many commits each has that the other doesn't.

use std::path::Path;

use gix::ObjectId;
use serde::Serialize;

use super::details::file_change;
use super::open;
use super::status::FileChange;
use crate::error::{Error, Result};
use crate::git::Git;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    /// What the files are compared from: `from` itself, or (since they split) where the
    /// two histories meet. None when they don't share any history.
    pub base: Option<String>,
    /// Where the two split (their merge base), whichever way they're compared.
    pub split_at: Option<String>,
    /// Commits in `from`'s history that aren't in `to`'s, and the other way round.
    pub only_from: usize,
    pub only_to: usize,
    /// The files that differ, from `base` to `to`.
    pub files: Vec<FileChange>,
}

fn commit_of(repo: &gix::Repository, id: &str) -> Result<ObjectId> {
    let parsed =
        ObjectId::from_hex(id.as_bytes()).map_err(|e| format!("Invalid commit id {id}: {e}"))?;
    repo.find_commit(parsed)
        .map_err(|e| format!("Could not find commit {id}: {e}"))?;
    Ok(parsed)
}

/// Compare commit `to` with `from`: directly, or with `split`, since the two split (what
/// `to` changed that `from` doesn't have, like a pull request).
pub fn compare(path: &Path, from: &str, to: &str, split: bool) -> Result<Comparison, Error> {
    let repo = open(path)?;
    let from = commit_of(&repo, from)?;
    let to = commit_of(&repo, to)?;
    let workdir = repo
        .workdir()
        .map(Path::to_owned)
        .unwrap_or_else(|| repo.git_dir().to_owned());
    let git = Git::find(workdir)?.in_background();
    let (from_hex, to_hex) = (from.to_string(), to.to_string());

    let split_at = git
        .run(&["merge-base", &from_hex, &to_hex])
        .ok()
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty());
    let counts = git.run(&[
        "rev-list",
        "--left-right",
        "--count",
        &format!("{from_hex}...{to_hex}"),
    ])?;
    let mut numbers = counts
        .split_whitespace()
        .map(|n| n.parse::<usize>().unwrap_or(0));
    let only_from = numbers.next().unwrap_or(0);
    let only_to = numbers.next().unwrap_or(0);

    let base = if split {
        split_at.clone()
    } else {
        Some(from_hex)
    };
    let tree_of = |id: ObjectId| {
        repo.find_commit(id)
            .and_then(|commit| commit.tree())
            .map_err(|e| format!("Could not read commit {id}: {e}"))
    };
    let after = tree_of(to)?;
    let before = match &base {
        Some(base) => Some(tree_of(commit_of(&repo, base)?)?),
        None => None,
    };
    let changes = repo
        .diff_tree_to_tree(before.as_ref(), &after, None)
        .map_err(|e| format!("Could not compare the commits: {e}"))?;
    let mut files: Vec<FileChange> = changes
        .iter()
        .filter(|change| !change.entry_mode().is_tree())
        .map(file_change)
        .collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Comparison {
        base,
        split_at,
        only_from,
        only_to,
        files,
    })
}
