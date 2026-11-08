//! Who changed each line of a file last, and in which commit (`git blame`).

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

use super::support::LITERAL;
use super::validate::{check_file_paths, commit_id};
use crate::error::{Error, Result};
use crate::git::Git;

/// Files with more lines than this aren't blamed (it would take long and show little).
const MAX_LINES: usize = 20_000;
/// The commit git gives lines that aren't committed yet.
const NOT_COMMITTED: &str = "0000000000000000000000000000000000000000";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    /// The commits the lines come from, in the order they first appear.
    pub commits: Vec<BlameCommit>,
    /// Each line, in order: its text and which of `commits` it comes from.
    pub lines: Vec<BlameLine>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    /// The full id, or None for lines that aren't committed yet.
    pub id: Option<String>,
    pub author: String,
    pub email: String,
    /// Seconds since the Unix epoch.
    pub time: i64,
    pub summary: String,
    /// The file's path in that commit (it may have been renamed since).
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub text: String,
    /// Index into [`Blame::commits`].
    pub commit: usize,
    /// The line's number in that commit's version of the file.
    pub original: u32,
}

/// Who changed each line of `file` last: as it is in the working tree, or at commit `at`.
pub fn blame(path: &Path, file: &str, at: Option<&str>) -> Result<Blame, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree.")?
        .to_owned();
    let owned = [file.to_owned()];
    let checked = check_file_paths(&owned)?;
    let git = Git::find(workdir)?.in_background();
    let commit = at
        .map(|id| commit_id(&repo, id))
        .transpose()?
        .map(|id| id.to_string());
    let mut args = vec!["blame", "--porcelain", "-w"];
    if let Some(commit) = &commit {
        args.push(commit);
    }
    args.extend(["--", checked[0]]);
    let output = git.run_with_env(&args, &LITERAL)?;
    parse_porcelain(&output)
}

/// `git blame --porcelain`: for each line, a header (`<id> <original> <final> [<count>]`),
/// the commit's details the first time it appears, then the line itself after a tab.
fn parse_porcelain(output: &str) -> Result<Blame> {
    let mut commits: Vec<BlameCommit> = Vec::new();
    let mut by_id: HashMap<String, usize> = HashMap::new();
    let mut lines = Vec::new();
    let mut current: Option<(usize, u32)> = None;
    for line in output.lines() {
        if let Some(text) = line.strip_prefix('\t') {
            let (commit, original) = current.take().ok_or("Couldn't read git blame's output.")?;
            lines.push(BlameLine {
                text: text.to_owned(),
                commit,
                original,
            });
            if lines.len() > MAX_LINES {
                return Err(format!(
                    "This file has more than {MAX_LINES} lines: too many to show who changed each."
                )
                .into());
            }
            continue;
        }
        let mut words = line.split(' ');
        let first = words.next().unwrap_or_default();
        if first.len() == 40 && first.bytes().all(|b| b.is_ascii_hexdigit()) {
            let original = words.next().and_then(|n| n.parse().ok()).unwrap_or(0);
            let index = *by_id.entry(first.to_owned()).or_insert_with(|| {
                commits.push(BlameCommit {
                    id: (first != NOT_COMMITTED).then(|| first.to_owned()),
                    ..BlameCommit::default()
                });
                commits.len() - 1
            });
            current = Some((index, original));
            continue;
        }
        let Some((index, _)) = current else {
            continue;
        };
        let commit = &mut commits[index];
        let value = line.split_once(' ').map(|(_, value)| value).unwrap_or("");
        match first {
            "author" => commit.author = value.to_owned(),
            "author-mail" => {
                commit.email = value
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .to_owned();
            }
            "author-time" => commit.time = value.parse().unwrap_or(0),
            "summary" => commit.summary = value.to_owned(),
            "filename" => commit.name = value.to_owned(),
            _ => {}
        }
    }
    Ok(Blame { commits, lines })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_who_changed_each_line() {
        let output = "1111111111111111111111111111111111111111 1 1 2
author Maya Chen
author-mail <maya@example.com>
author-time 1700000000
summary First version
filename notes.txt
\tone
1111111111111111111111111111111111111111 2 2
\ttwo
0000000000000000000000000000000000000000 3 3 1
author Not Committed Yet
author-mail <not.committed.yet>
author-time 1700000500
summary Version of notes.txt from notes.txt
filename notes.txt
\tthree
";
        let blame = parse_porcelain(output).unwrap();
        assert_eq!(blame.commits.len(), 2);
        assert_eq!(blame.commits[0].author, "Maya Chen");
        assert_eq!(blame.commits[0].email, "maya@example.com");
        assert_eq!(blame.commits[0].summary, "First version");
        assert_eq!(blame.commits[0].name, "notes.txt");
        assert_eq!(blame.commits[1].id, None);
        let lines: Vec<(&str, usize, u32)> = blame
            .lines
            .iter()
            .map(|line| (line.text.as_str(), line.commit, line.original))
            .collect();
        assert_eq!(lines, [("one", 0, 1), ("two", 0, 2), ("three", 1, 3)]);
    }
}
