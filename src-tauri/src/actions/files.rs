//! The history of a file or folder.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::support::LITERAL;
use crate::error::{Error, Result};
use crate::git::Git;

/// The commits that changed a file or folder.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileHistory {
    /// Relative to the repository's root, with forward slashes, without a trailing slash.
    pub path: String,
    pub folder: bool,
    /// Newest first, from every branch, remote branch and tag.
    pub ids: Vec<String>,
    /// For a file: every path it had, following renames, newest first.
    pub names: Vec<String>,
    /// More commits changed it than were listed.
    pub truncated: bool,
}

/// At most this many commits are listed for a file's history.
pub(super) const HISTORY_LIMIT: usize = 5000;

/// The commits that changed `file` (a path in the repository, or an absolute path inside
/// it), following renames for a file. For a folder, those that changed anything in it.
pub fn file_history(path: &Path, file: &str) -> Result<FileHistory, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree.")?
        .to_owned();
    let relative = repo_relative(&workdir, file)?;
    let folder = file.ends_with('/') || file.ends_with('\\') || workdir.join(&relative).is_dir();
    let git = Git::find(workdir)?;

    let limit = format!("--max-count={}", HISTORY_LIMIT + 1);
    let mut args = vec!["log", "--format=%x1e%H", &limit];
    if !folder {
        args.extend(["--follow", "--name-only"]);
    }
    // The same commits the graph shows: everything reachable from branches, remote
    // branches and tags (and HEAD, which may be detached), but not stashes or backups.
    args.extend(["--branches", "--remotes", "--tags"]);
    if repo.head_id().is_ok() {
        args.push("HEAD");
    }
    args.extend(["--", &relative]);
    let output = git.run_with_env(&args, &LITERAL)?;

    let mut ids = Vec::new();
    let mut names: Vec<String> = Vec::new();
    for record in output
        .split('\u{1e}')
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        let mut lines = record
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty());
        let Some(id) = lines.next() else { continue };
        ids.push(id.to_owned());
        for name in lines {
            if !names.iter().any(|known| known == name) {
                names.push(name.to_owned());
            }
        }
    }
    let truncated = ids.len() > HISTORY_LIMIT;
    ids.truncate(HISTORY_LIMIT);
    if !folder && names.is_empty() {
        names.push(relative.clone());
    }
    Ok(FileHistory {
        path: relative,
        folder,
        ids,
        names,
        truncated,
    })
}

/// `file` relative to the working tree's root, with forward slashes: as given, or cut
/// from an absolute path inside the working tree.
pub(super) fn repo_relative(workdir: &Path, file: &str) -> Result<String, Error> {
    let trimmed = file.trim().trim_end_matches(['/', '\\']);
    let given = Path::new(trimmed);
    let relative = if given.is_absolute() {
        let canonical =
            |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_owned());
        let root = canonical(workdir);
        let inside = canonical(given);
        inside
            .strip_prefix(&root)
            .or_else(|_| given.strip_prefix(workdir))
            .map(Path::to_owned)
            .map_err(|_| format!("{file} isn't in this repository."))?
    } else {
        given.to_owned()
    };
    let parts: Vec<String> = relative
        .components()
        .map(|part| match part {
            std::path::Component::Normal(name) => Ok(name.to_string_lossy().into_owned()),
            std::path::Component::CurDir => Ok(String::new()),
            _ => Err(format!("{file} isn't in this repository.").into()),
        })
        .collect::<Result<_, Error>>()?;
    let joined = parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    if joined.is_empty() {
        return Err("Choose a file or a folder inside the repository.".into());
    }
    Ok(joined)
}
