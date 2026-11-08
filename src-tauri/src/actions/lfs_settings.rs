//! A repository's Git LFS settings: which files it stores with Git LFS (its `.gitattributes`
//! patterns), and which kinds of big files it has that it could.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::git::Git;

/// Files at least this big are suggested for Git LFS.
const BIG_FILE: u64 = 1024 * 1024;
/// At most this many kinds of files are suggested.
const MAX_SUGGESTIONS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsSettings {
    /// Git LFS is installed on this computer.
    pub installed: bool,
    /// The patterns stored with Git LFS, as `.gitattributes` lists them (like `*.psd`).
    pub patterns: Vec<String>,
    /// Kinds of big files here that aren't stored with it, biggest first.
    pub suggestions: Vec<LfsSuggestion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsSuggestion {
    /// Like `*.psd`.
    pub pattern: String,
    /// How many files of that kind are big, and how big they are together.
    pub files: usize,
    pub bytes: u64,
}

/// The repository's Git LFS settings.
pub fn lfs_settings(path: &Path) -> Result<LfsSettings, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree.")?
        .to_owned();
    let git = Git::find(workdir.clone())?.in_background();
    let installed = git.run(&["lfs", "version"]).is_ok();
    let patterns = std::fs::read_to_string(workdir.join(".gitattributes"))
        .map(|text| lfs_patterns(&text))
        .unwrap_or_default();
    Ok(LfsSettings {
        installed,
        suggestions: suggestions(&git, &workdir, &patterns),
        patterns,
    })
}

/// The patterns a `.gitattributes` file stores with Git LFS (`filter=lfs`).
fn lfs_patterns(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(pattern) = parts.next() else {
            continue;
        };
        if parts.any(|attribute| attribute == "filter=lfs") && !found.iter().any(|p| p == pattern) {
            found.push(pattern.to_owned());
        }
    }
    found
}

/// The kinds of big files (by extension) among the files here, tracked or new, that no
/// Git LFS pattern covers yet.
fn suggestions(git: &Git, workdir: &Path, patterns: &[String]) -> Vec<LfsSuggestion> {
    let covered: HashSet<String> = patterns
        .iter()
        .map(|pattern| pattern.to_lowercase())
        .collect();
    let Ok(listing) = git.run(&[
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
    ]) else {
        return Vec::new();
    };
    let mut by_kind: HashMap<String, (usize, u64)> = HashMap::new();
    for file in listing.split('\0').filter(|file| !file.is_empty()) {
        let name = file.rsplit('/').next().unwrap_or(file);
        let Some((stem, extension)) = name.rsplit_once('.') else {
            continue;
        };
        if stem.is_empty() || extension.is_empty() || extension.len() > 12 {
            continue;
        }
        let pattern = format!("*.{}", extension.to_lowercase());
        if covered.contains(&pattern) {
            continue;
        }
        let Ok(size) = std::fs::metadata(workdir.join(file)).map(|meta| meta.len()) else {
            continue;
        };
        if size >= BIG_FILE {
            let entry = by_kind.entry(pattern).or_default();
            entry.0 += 1;
            entry.1 += size;
        }
    }
    let mut found: Vec<LfsSuggestion> = by_kind
        .into_iter()
        .map(|(pattern, (files, bytes))| LfsSuggestion {
            pattern,
            files,
            bytes,
        })
        .collect();
    found.sort_by(|a, b| {
        b.bytes
            .cmp(&a.bytes)
            .then_with(|| a.pattern.cmp(&b.pattern))
    });
    found.truncate(MAX_SUGGESTIONS);
    found
}

/// Stop storing files matching `patterns` with Git LFS (files already stored with it stay so).
pub(super) fn untrack_with_lfs(git: &Git, patterns: Vec<String>) -> Result<String> {
    let patterns: Vec<&str> = patterns
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    if patterns.is_empty()
        || patterns
            .iter()
            .any(|p| p.starts_with('-') || p.contains('\n'))
    {
        return Err("Choose which patterns to stop storing with Git LFS.".into());
    }
    let mut args = vec!["lfs", "untrack", "--"];
    args.extend(&patterns);
    git.run(&args)?;
    git.run(&["add", "--", ".gitattributes"])?;
    Ok(format!(
        "No longer storing {} with Git LFS",
        patterns.join(", ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_patterns_stored_with_lfs() {
        let text = "# Art\n*.psd filter=lfs diff=lfs merge=lfs -text\n*.uasset lockable\n\
                    Content/** filter=lfs diff=lfs merge=lfs -text\n*.psd filter=lfs\n*.txt text\n";
        assert_eq!(lfs_patterns(text), vec!["*.psd", "Content/**"]);
    }
}
