//! Searching every branch's history: for commits whose message, author or id matches, that
//! touched a file or folder, or that added or removed some code (`git log --grep`,
//! `--author`, `-- <path>`, `-S`), and for every kind at once.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::git::Git;

/// At most this many commits are found.
const LIMIT: usize = 2000;

/// At most this many authors and files are listed in an overview.
const OVERVIEW_LIMIT: usize = 50;

/// What to search commits for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "CommitSearchMode")]
pub enum SearchMode {
    /// Commits whose message (any line of it) contains the words, ignoring case.
    Messages,
    /// Commits whose author's name or email contains the words, ignoring case.
    Authors,
    /// Commits whose id starts with the text (four letters or more).
    Hashes,
    /// Commits that changed a file or folder whose path contains the words (or matches a
    /// pattern like `*.psd`).
    Files,
    /// Commits that added or removed the text (in any file).
    Code,
}

/// A commit found, with enough to list it before it's loaded in the history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FoundCommit {
    pub id: String,
    pub summary: String,
    pub author: String,
    /// When it was made, in seconds since the Unix epoch.
    pub time: i64,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// Newest first.
    pub ids: Vec<String>,
    /// The same commits, with their summaries.
    pub commits: Vec<FoundCommit>,
    /// More commits matched than were listed.
    pub truncated: bool,
}

/// Someone whose commits matched, by name or email.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AuthorMatch {
    pub name: String,
    pub email: String,
    /// How many of their commits there are (up to the search's limit).
    pub commits: usize,
}

/// A file or folder whose path matched, and how many commits changed it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileMatch {
    pub path: String,
    pub commits: usize,
}

/// Every kind of match for a search at once, but code (which takes longer, and is asked for
/// on its own).
#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SearchOverview {
    pub messages: SearchResult,
    /// Most commits first.
    pub authors: Vec<AuthorMatch>,
    /// Most commits first.
    pub files: Vec<FileMatch>,
    /// The commits that changed those files.
    pub file_commits: SearchResult,
    pub hashes: SearchResult,
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

/// A commit's line in `git log` output: its id, summary, author and time, split by NULs.
const FORMAT: &str = "--format=%x01%H%x00%s%x00%an%x00%at";

/// The commits in `git log` output written with [`FORMAT`] (other lines are left out).
fn found_commits(output: &str) -> Vec<FoundCommit> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.strip_prefix('\u{1}')?.split('\0');
            Some(FoundCommit {
                id: parts.next()?.to_owned(),
                summary: parts.next()?.to_owned(),
                author: parts.next()?.to_owned(),
                time: parts.next()?.trim().parse().unwrap_or(0),
            })
        })
        .collect()
}

/// [`SearchResult`] from the commits found, at most [`LIMIT`] of them.
fn result(mut commits: Vec<FoundCommit>) -> SearchResult {
    let truncated = commits.len() > LIMIT;
    commits.truncate(LIMIT);
    SearchResult {
        ids: commits.iter().map(|commit| commit.id.clone()).collect(),
        commits,
        truncated,
    }
}

/// The repository's git, and whether it has a commit checked out.
fn open(path: &Path) -> Result<(Git, bool)> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .map(Path::to_owned)
        .unwrap_or_else(|| repo.git_dir().to_owned());
    Ok((Git::find(workdir)?.in_background(), repo.head_id().is_ok()))
}

/// `git log` over every branch, remote branch and tag (and HEAD), with `options` before them
/// and `paths` after.
fn log(git: &Git, head: bool, options: &[String], paths: &[String]) -> Result<String> {
    let mut args: Vec<&str> = vec!["log"];
    args.extend(options.iter().map(String::as_str));
    args.extend(["--branches", "--remotes", "--tags"]);
    if head {
        args.push("HEAD");
    }
    if !paths.is_empty() {
        args.push("--");
        args.extend(paths.iter().map(String::as_str));
    }
    git.run(&args)
}

/// The query, checked: one line, and None when there's nothing to search for.
fn checked(query: &str) -> Result<Option<&str>> {
    let query = query.trim();
    if query.contains(['\n', '\r', '\0']) {
        return Err("Search for one line at a time.".into());
    }
    Ok((!query.is_empty()).then_some(query))
}

/// Whether `query` could be the start of a commit's id.
fn looks_like_id(query: &str) -> bool {
    (4..=40).contains(&query.len()) && query.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The commits (in every branch, remote branch and tag) that match `query`.
pub fn search_commits(path: &Path, mode: SearchMode, query: &str) -> Result<SearchResult> {
    let Some(query) = checked(query)? else {
        return Ok(SearchResult::default());
    };
    let (git, head) = open(path)?;
    Ok(result(commits_matching(&git, head, mode, query)?))
}

fn commits_matching(
    git: &Git,
    head: bool,
    mode: SearchMode,
    query: &str,
) -> Result<Vec<FoundCommit>> {
    let mut options = vec![FORMAT.to_owned(), format!("--max-count={}", LIMIT + 1)];
    let mut paths = Vec::new();
    // The text as one argument, so it can't be read as an option; as it is, not as a
    // pattern (-F); ignoring case (-i).
    match mode {
        SearchMode::Messages => {
            options.extend(["-i".into(), "-F".into(), format!("--grep={query}")]);
        }
        SearchMode::Authors => {
            options.extend(["-i".into(), "-F".into(), format!("--author={query}")]);
        }
        SearchMode::Code => options.push(format!("-S{query}")),
        SearchMode::Files => paths.push(path_pattern(query)),
        SearchMode::Hashes => return commits_by_id(git, query),
    }
    Ok(found_commits(&log(git, head, &options, &paths)?))
}

/// The commits whose ids start with `prefix` (none unless it could be the start of one).
fn commits_by_id(git: &Git, prefix: &str) -> Result<Vec<FoundCommit>> {
    if !looks_like_id(prefix) {
        return Ok(Vec::new());
    }
    let prefix = prefix.to_ascii_lowercase();
    // Every object whose id starts with it (blobs and trees too), then the commits among them.
    let objects = git
        .run(&["rev-parse", &format!("--disambiguate={prefix}")])
        .unwrap_or_default();
    let mut found = Vec::new();
    for id in objects
        .lines()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .take(20)
    {
        let Ok(kind) = git.run(&["cat-file", "-t", id]) else {
            continue;
        };
        if kind.trim() == "commit" {
            found.extend(found_commits(&git.run(&["show", "-s", FORMAT, id])?));
        }
    }
    Ok(found)
}

/// Every kind of match for `query` at once (but code): commits by message and by id, the
/// authors whose names or emails match, and the files whose paths do, with the commits that
/// changed them.
pub fn search_overview(path: &Path, query: &str) -> Result<SearchOverview> {
    let Some(query) = checked(query)? else {
        return Ok(SearchOverview::default());
    };
    let (git, head) = open(path)?;
    let messages = result(commits_matching(&git, head, SearchMode::Messages, query)?);
    let hashes = result(commits_by_id(&git, query)?);

    // Authors: each name and email once, with how many of their commits there are.
    let output = log(
        &git,
        head,
        &[
            "--format=%an%x00%ae".into(),
            format!("--max-count={}", LIMIT * 10),
            "-i".into(),
            "-F".into(),
            format!("--author={query}"),
        ],
        &[],
    )?;
    let mut counts: HashMap<(String, String), usize> = HashMap::new();
    for line in output.lines() {
        if let Some((name, email)) = line.split_once('\0') {
            *counts
                .entry((name.to_owned(), email.to_owned()))
                .or_default() += 1;
        }
    }
    let mut authors: Vec<AuthorMatch> = counts
        .into_iter()
        .map(|((name, email), commits)| AuthorMatch {
            name,
            email,
            commits,
        })
        .collect();
    authors.sort_by(|a, b| b.commits.cmp(&a.commits).then_with(|| a.name.cmp(&b.name)));
    authors.truncate(OVERVIEW_LIMIT);

    // Files: the paths that match, from the commits that changed them.
    let output = log(
        &git,
        head,
        &[
            FORMAT.into(),
            format!("--max-count={}", LIMIT + 1),
            "--name-only".into(),
        ],
        &[path_pattern(query)],
    )?;
    let file_commits = result(found_commits(&output));
    let mut changed: HashMap<&str, usize> = HashMap::new();
    for line in output.lines().map(str::trim) {
        if !line.is_empty() && !line.starts_with('\u{1}') {
            *changed.entry(line).or_default() += 1;
        }
    }
    let mut files: Vec<FileMatch> = changed
        .into_iter()
        .map(|(path, commits)| FileMatch {
            path: path.to_owned(),
            commits,
        })
        .collect();
    files.sort_by(|a, b| b.commits.cmp(&a.commits).then_with(|| a.path.cmp(&b.path)));
    files.truncate(OVERVIEW_LIMIT);

    Ok(SearchOverview {
        messages,
        authors,
        files,
        file_commits,
        hashes,
    })
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

    #[test]
    fn reads_found_commits() {
        let output =
            "\u{1}abc\0Fix it\0Maya Chen\x001700000000\nsrc/a.ts\n\n\u{1}def\0Add it\0Sam\0oops\n";
        let commits = found_commits(output);
        assert_eq!(commits.len(), 2);
        assert_eq!(
            commits[0],
            FoundCommit {
                id: "abc".into(),
                summary: "Fix it".into(),
                author: "Maya Chen".into(),
                time: 1_700_000_000,
            }
        );
        assert_eq!(commits[1].time, 0);
    }

    #[test]
    fn tells_what_could_be_an_id() {
        assert!(looks_like_id("35e1a92"));
        assert!(!looks_like_id("35e"));
        assert!(!looks_like_id("export"));
    }
}
