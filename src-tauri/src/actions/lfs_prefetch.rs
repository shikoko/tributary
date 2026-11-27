//! Downloading a commit's Git LFS files all at once, before they're looked at: opening a file
//! stored with Git LFS downloads its two versions then, one at a time, which is slow when
//! looking through a commit's pictures one after another.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use super::lfs_count::{lfs_downloads, remote_for};
use super::support::in_batches;
use crate::error::Result;
use crate::git::Git;

/// Git's empty tree: what a commit without a parent is compared with.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// The commits whose Git LFS files were fetched, or are being fetched, by repository: each
/// is fetched once (again only after a fetch that failed).
static FETCHED: LazyLock<Mutex<HashSet<(PathBuf, String)>>> = LazyLock::new(Mutex::default);

/// Download the Git LFS files `commit` changed that aren't here yet, as they are in it and as
/// they were before it, in one `git lfs fetch` from the remote they come from. It runs as
/// background work: it never asks for a password, and nothing is said when it fails (opening
/// a file downloads it then, as before). Does nothing without Git LFS, a remote, or files
/// to download; a commit already fetched isn't fetched again.
pub fn prefetch_lfs(path: &Path, commit: &str) -> Result<()> {
    let key = (path.to_path_buf(), commit.to_owned());
    if !FETCHED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(key.clone())
    {
        return Ok(());
    }
    let fetched = fetch(path, commit);
    if fetched.is_err() {
        FETCHED
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&key);
    }
    fetched
}

fn fetch(path: &Path, commit: &str) -> Result<()> {
    let git = Git::find(path.to_path_buf())?.in_background();
    if git.run(&["lfs", "version"]).is_err() {
        return Ok(());
    }
    let id = git
        .run(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{commit}^{{commit}}"),
        ])?
        .trim()
        .to_owned();
    let parent = git
        .run(&["rev-parse", "--verify", "--quiet", &format!("{id}^")])
        .ok()
        .map(|parent| parent.trim().to_owned());
    let common = PathBuf::from(git.run(&["rev-parse", "--git-common-dir"])?.trim());
    let common = if common.is_absolute() {
        common
    } else {
        path.join(common)
    };
    // What it changed, and of that, what Git LFS stores and isn't here: in it, and before it.
    let range = format!("{}..{id}", parent.as_deref().unwrap_or(EMPTY_TREE));
    let mut files = Vec::new();
    for side in std::iter::once(id.as_str()).chain(parent.as_deref()) {
        if let Some(missing) = lfs_downloads(&git, &common, &range, side, &HashSet::new()) {
            files.extend(missing.into_iter().map(|(file, _)| file));
        }
    }
    // Asked for by name, as Git LFS's own patterns: a name that would be read as more than
    // itself (with a comma, or a wildcard) is left to be downloaded when it's opened.
    files.retain(|file| !file.contains([',', '*', '?', '[', '\\']) && !file.starts_with('!'));
    files.sort();
    files.dedup();
    if files.is_empty() {
        return Ok(());
    }
    let Some(remote) = remote_for(&git, "HEAD") else {
        return Ok(());
    };
    let names: Vec<&str> = files.iter().map(String::as_str).collect();
    for batch in in_batches(&names) {
        let include = format!("--include={}", batch.join(","));
        let mut args = vec![
            "lfs",
            "fetch",
            include.as_str(),
            remote.as_str(),
            id.as_str(),
        ];
        args.extend(parent.as_deref());
        git.run(&args)?;
    }
    Ok(())
}
