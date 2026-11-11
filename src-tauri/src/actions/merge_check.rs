//! Whether a merge would go cleanly, before doing it: git merges the two in memory
//! (`git merge-tree --write-tree`, git 2.38 and later), touching neither the files nor
//! the branches, and says which files would conflict.
//!
//! A rebase replays your commits one at a time, so it can stop at a conflict in a commit
//! along the way that the end result doesn't have (or the other way round); merging the
//! two ends is a good guess for it, and that's how it's offered.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::validate::revision_name;
use crate::error::{Error, Result};
use crate::git::Git;

/// At most this many conflicting files are listed.
const MOST_FILES: usize = 200;

/// How a merge of `from` into `into` would go.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MergeCheck {
    /// "unknown": git is older than 2.38, or the two share no history.
    pub outcome: MergeOutcome,
    /// The files that would conflict.
    pub conflicts: Vec<String>,
    /// More conflicting files than [`MOST_FILES`]: how many in all.
    pub conflict_count: usize,
    /// The commits merging would bring in (on `from`, not on `into`).
    pub incoming: usize,
    /// The commits on `into` that aren't on `from` (those a rebase would replay).
    pub outgoing: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum MergeOutcome {
    /// Everything on `from` is already on `into`.
    UpToDate,
    /// `into` can simply move forward to `from`.
    FastForward,
    /// A real merge, without conflicts.
    Clean,
    /// A real merge, with conflicts in [`MergeCheck::conflicts`].
    Conflicts,
    /// Couldn't tell: git is older than 2.38, or the two have no history in common.
    Unknown,
}

/// The file names after the merged tree's id in `git merge-tree -z --name-only` output.
fn conflicted_files(output: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for name in output.split('\0').skip(1).filter(|name| !name.is_empty()) {
        // A file conflicting in several ways is listed once for each.
        if !names.iter().any(|known| known == name) {
            names.push(name.to_owned());
        }
    }
    names
}

/// How merging `from` into `into` (the checked-out commit, when None) would go.
pub fn merge_check(path: &Path, from: &str, into: Option<&str>) -> Result<MergeCheck> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    let from = revision_name(&repo, from)?;
    let into = match into {
        Some(into) => revision_name(&repo, into)?,
        None => "HEAD".to_owned(),
    };
    let counts = git.run(&[
        "rev-list",
        "--count",
        "--left-right",
        &format!("{into}...{from}"),
    ])?;
    let mut numbers = counts
        .split_whitespace()
        .map(|n| n.parse::<usize>().unwrap_or(0));
    let (outgoing, incoming) = (numbers.next().unwrap_or(0), numbers.next().unwrap_or(0));
    let check = |outcome, conflicts: Vec<String>| {
        let conflict_count = conflicts.len();
        MergeCheck {
            outcome,
            conflicts: conflicts.into_iter().take(MOST_FILES).collect(),
            conflict_count,
            incoming,
            outgoing,
        }
    };
    if incoming == 0 {
        return Ok(check(MergeOutcome::UpToDate, Vec::new()));
    }
    if outgoing == 0 {
        return Ok(check(MergeOutcome::FastForward, Vec::new()));
    }
    let (code, output) = git.run_status(&[
        "merge-tree",
        "--write-tree",
        "--name-only",
        "--no-messages",
        "-z",
        &into,
        &from,
    ])?;
    Ok(match code {
        Some(0) => check(MergeOutcome::Clean, Vec::new()),
        Some(1) => check(MergeOutcome::Conflicts, conflicted_files(&output)),
        // Older git doesn't know --write-tree; unrelated histories can't be merged as is.
        _ => check(MergeOutcome::Unknown, Vec::new()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_conflicted_files() {
        assert_eq!(
            conflicted_files("f4dd23d7\0f.txt\0sp ace.txt\0f.txt\0"),
            vec!["f.txt".to_owned(), "sp ace.txt".to_owned()]
        );
        assert!(conflicted_files("f4dd23d7\0").is_empty());
    }
}
