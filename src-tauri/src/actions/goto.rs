//! Finding the commit Go to Commit (Ctrl+G) asks for: a commit's id or the start of one, a
//! branch, a tag, anything else git reads as a commit (`HEAD~3`), or a day, for the newest
//! commit made by its end.

use std::path::Path;

use crate::error::{Error, Result};
use crate::git::Git;

/// The commit `query` names, or `None` when there's none.
pub fn find_commit(path: &Path, query: &str) -> Result<Option<String>> {
    let query = query.trim();
    // Never read as one of git's options.
    if query.is_empty() || query.starts_with('-') {
        return Ok(None);
    }
    if query.contains(['\n', '\r', '\0']) {
        return Err("Look for one line at a time.".into());
    }
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .map(Path::to_owned)
        .unwrap_or_else(|| repo.git_dir().to_owned());
    let git = Git::find(workdir)?.in_background();
    // As git reads it. Quietly: not finding it isn't a failure.
    let commit = format!("{query}^{{commit}}");
    if let Ok(id) = git.run(&["rev-parse", "--verify", "--quiet", &commit]) {
        let id = id.trim();
        if !id.is_empty() {
            return Ok(Some(id.to_owned()));
        }
    }
    // A day: the newest commit in any branch, remote branch or tag made by its end.
    if let Some(day) = day(query) {
        let before = format!("--before={day} 23:59:59");
        let mut args = vec![
            "rev-list",
            "-1",
            &before,
            "--branches",
            "--remotes",
            "--tags",
        ];
        if repo.head_id().is_ok() {
            args.push("HEAD");
        }
        let found = git.run(&args)?;
        let id = found.trim();
        return Ok((!id.is_empty()).then(|| id.to_owned()));
    }
    Ok(None)
}

/// `query` as a day, written as git and ISO 8601 write it: 2026-10-01.
fn day(query: &str) -> Option<&str> {
    let bytes = query.as_bytes();
    let shaped = bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| {
            if index == 4 || index == 7 {
                *byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        });
    shaped.then_some(query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_days() {
        assert_eq!(day("2026-10-01"), Some("2026-10-01"));
        assert_eq!(day("2026-1-01"), None);
        assert_eq!(day("main"), None);
        assert_eq!(day("2026/10/01"), None);
    }
}
