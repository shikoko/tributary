//! Searching every branch's history for the commits that touched a file or folder, or that
//! added or removed some code (`git log -- <path>`, `git log -S`).

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::git::Git;

/// At most this many commits are found.
const LIMIT: usize = 2000;

/// What to search commits for, besides their messages: a file's path, or code they added or removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "CommitSearchMode")]
pub enum SearchMode {
    /// Commits that changed a file or folder whose path contains the words (or matches a
    /// pattern like `*.psd`).
    Files,
    /// Commits that added or removed the text (in any file).
    Code,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// Newest first.
    pub ids: Vec<String>,
    /// More commits matched than were listed.
    pub truncated: bool,
}

/// The pathspec for a file search: the text anywhere in a path, ignoring case, or (with
/// `*`, `?` or `[`) a pattern as typed.
fn path_pattern(query: &str) -> String {
    let query = query.trim().trim_start_matches(':');
    if query.contains(['*', '?', '[']) {
        format!(":(icase){query}")
    } else {
        format!(":(icase)*{query}*")
    }
}

/// The commits (in every branch, remote branch and tag) that match `query`.
pub fn search_commits(path: &Path, mode: SearchMode, query: &str) -> Result<SearchResult, Error> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(SearchResult {
            ids: Vec::new(),
            truncated: false,
        });
    }
    if query.contains(['\n', '\r', '\0']) {
        return Err("Search for one line at a time.".into());
    }
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .map(Path::to_owned)
        .unwrap_or_else(|| repo.git_dir().to_owned());
    let git = Git::find(workdir)?.in_background();
    let limit = format!("--max-count={}", LIMIT + 1);
    let mut args: Vec<String> = vec!["log".into(), "--format=%H".into(), limit];
    let pattern;
    match mode {
        // The text as one argument, so it can't be read as an option.
        SearchMode::Code => args.push(format!("-S{query}")),
        SearchMode::Files => {}
    }
    args.extend(["--branches", "--remotes", "--tags"].map(String::from));
    if repo.head_id().is_ok() {
        args.push("HEAD".into());
    }
    if mode == SearchMode::Files {
        pattern = path_pattern(query);
        args.push("--".into());
        args.push(pattern);
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = git.run(&args)?;
    let mut ids: Vec<String> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect();
    let truncated = ids.len() > LIMIT;
    ids.truncate(LIMIT);
    Ok(SearchResult { ids, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_path_patterns() {
        assert_eq!(path_pattern("store"), ":(icase)*store*");
        assert_eq!(path_pattern(" *.psd "), ":(icase)*.psd");
        // No pathspec magic of the user's own.
        assert_eq!(path_pattern(":(top)x"), ":(icase)*(top)x*");
    }
}
