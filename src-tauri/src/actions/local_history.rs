//! Local history: snapshots of uncommitted work every few minutes, so a crash or an
//! overwrite doesn't lose an afternoon. Each is a commit of the changed files on top of HEAD
//! (made without touching anything, see `snapshot`), kept as a hidden ref for a few days.
//! Files over a size limit are left out: a snapshot of each version would fill the disk.

use std::path::Path;

use gix::bstr::ByteSlice;
use serde::Serialize;

use super::Extra;
use super::snapshot::{identity_or_tributary, snapshot_commit};
use super::support::{LITERAL, describe_files, now_millis};
use super::validate::check_file_paths;
use crate::error::{Error, Result};
use crate::git::Git;

/// Where snapshots are kept: `refs/tributary/snapshots/<milliseconds>`.
pub(super) const SNAPSHOTS: &str = "refs/tributary/snapshots/";

/// A snapshot of uncommitted work.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub reference: String,
    pub id: String,
    /// When it was taken (milliseconds since the epoch).
    pub time: i64,
    /// The files that were changed then, compared with the commit checked out then.
    pub files: Vec<SnapshotFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFile {
    pub path: String,
    /// "added", "modified" or "deleted".
    pub change: &'static str,
}

/// Take a snapshot of the uncommitted changes (files up to `max_bytes`), unless nothing
/// changed since the last one, and forget those older than `keep_days`. Returns it, if one
/// was taken.
pub fn take_snapshot(
    path: &Path,
    max_bytes: u64,
    keep_days: u32,
) -> Result<Option<Snapshot>, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let Some(workdir) = repo.workdir() else {
        return Ok(None);
    };
    let git = Git::find(workdir.to_owned())?.in_background();
    forget_old(&repo, &git, keep_days);
    let paths: Vec<String> = changed_paths(&git)?
        .into_iter()
        .filter(|path| {
            // Gone, or small enough.
            git.workdir()
                .join(path)
                .metadata()
                .map_or(true, |meta| meta.is_file() && meta.len() <= max_bytes)
        })
        .collect();
    if paths.is_empty() {
        return Ok(None);
    }
    let identity = identity_or_tributary(&git);
    let Some(id) = snapshot_commit(&git, repo.git_dir(), &paths, "Local history", &identity)?
    else {
        return Ok(None);
    };
    // Nothing new since the last one.
    if let Some(last) = newest(&repo) {
        let tree = |rev: &str| git.run(&["rev-parse", &format!("{rev}^{{tree}}")]).ok();
        if tree(&last).is_some() && tree(&last) == tree(&id) {
            return Ok(None);
        }
    }
    let time = now_millis();
    let reference = format!("{SNAPSHOTS}{time}");
    git.run(&["update-ref", &reference, &id])?;
    Ok(Some(Snapshot {
        files: snapshot_files(&git, &id)?,
        reference,
        id,
        time,
    }))
}

/// The snapshots there are, newest first.
pub fn local_history(path: &Path) -> Result<Vec<Snapshot>, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let Some(workdir) = repo.workdir() else {
        return Ok(Vec::new());
    };
    let git = Git::find(workdir.to_owned())?.in_background();
    let mut found = Vec::new();
    for (reference, time) in snapshot_refs(&repo) {
        let Ok(id) = git.run(&["rev-parse", "--verify", "--quiet", &reference]) else {
            continue;
        };
        let id = id.trim().to_owned();
        found.push(Snapshot {
            files: snapshot_files(&git, &id)?,
            reference,
            id,
            time,
        });
    }
    found.sort_by_key(|snapshot| std::cmp::Reverse(snapshot.time));
    Ok(found)
}

/// Put files back as a snapshot had them (all of its files, when `paths` is empty). What
/// they are now is snapshotted first, to undo it.
pub(super) fn restore_from_history(
    repo: &gix::Repository,
    git: &Git,
    reference: String,
    paths: Vec<String>,
    extra: &mut Extra,
) -> Result<String> {
    if !reference.starts_with(SNAPSHOTS) {
        return Err(format!("{reference} isn't from the local history.").into());
    }
    let id = git
        .run(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{reference}^{{commit}}"),
        ])
        .map_err(|_| "That snapshot isn't kept any more.")?;
    let id = id.trim().to_owned();
    let files = snapshot_files(git, &id)?;
    let chosen: Vec<&SnapshotFile> = if paths.is_empty() {
        files.iter().collect()
    } else {
        let wanted = check_file_paths(&paths)?;
        files
            .iter()
            .filter(|file| wanted.contains(&file.path.as_str()))
            .collect()
    };
    if chosen.is_empty() {
        return Err("That snapshot doesn't have those files.".into());
    }
    let names: Vec<String> = chosen.iter().map(|file| file.path.clone()).collect();
    // As they are now, to undo this.
    let identity = identity_or_tributary(git);
    if let Some(now) = snapshot_commit(git, repo.git_dir(), &names, "Before restoring", &identity)?
    {
        let backup = format!("{SNAPSHOTS}{}", now_millis());
        git.run(&["update-ref", &backup, &now])?;
        extra.backup = Some(backup);
    }
    let (gone, kept): (Vec<&SnapshotFile>, Vec<&SnapshotFile>) = chosen
        .into_iter()
        .partition(|file| file.change == "deleted");
    if !kept.is_empty() {
        let mut args = vec!["restore", "--source", id.as_str(), "--worktree", "--"];
        args.extend(kept.iter().map(|file| file.path.as_str()));
        git.run_with_env(&args, &LITERAL)?;
    }
    for file in gone {
        let _ = std::fs::remove_file(git.workdir().join(&file.path));
    }
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    Ok(format!(
        "Restored {} from the local history",
        describe_files(&names)
    ))
}

/// The files a snapshot had changed, compared with the commit it was taken on.
fn snapshot_files(git: &Git, id: &str) -> Result<Vec<SnapshotFile>> {
    let parent = git
        .run(&["rev-parse", "--verify", "--quiet", &format!("{id}^")])
        .ok();
    let mut args = vec!["diff-tree", "-r", "--no-commit-id", "--name-status", "-z"];
    match parent.as_deref().map(str::trim) {
        Some(parent) => args.extend([parent, id]),
        None => args.extend(["--root", id]),
    }
    let output = git.run(&args)?;
    let parts: Vec<&str> = output.split('\0').filter(|part| !part.is_empty()).collect();
    Ok(parts
        .chunks(2)
        .filter_map(|pair| match pair {
            [status, path] => Some(SnapshotFile {
                path: (*path).to_owned(),
                change: match status.chars().next() {
                    Some('A') => "added",
                    Some('D') => "deleted",
                    _ => "modified",
                },
            }),
            _ => None,
        })
        .collect())
}

/// Every changed file, untracked ones too, without git writing its index (a snapshot
/// mustn't get in the way of whatever else is running).
fn changed_paths(git: &Git) -> Result<Vec<String>> {
    let status = git.run(&[
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
    ])?;
    let mut paths = Vec::new();
    let mut parts = status.split('\0');
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        paths.push(entry[3..].to_owned());
        if (entry.starts_with('R') || entry.starts_with('C'))
            && let Some(from) = parts.next()
        {
            paths.push(from.to_owned());
        }
    }
    Ok(paths)
}

fn snapshot_refs(repo: &gix::Repository) -> Vec<(String, i64)> {
    let Ok(references) = repo.references() else {
        return Vec::new();
    };
    let Ok(found) = references.prefixed(SNAPSHOTS) else {
        return Vec::new();
    };
    found
        .flatten()
        .filter_map(|reference| {
            let name = reference.name().as_bstr().to_str_lossy().into_owned();
            let time = name.strip_prefix(SNAPSHOTS)?.parse().ok()?;
            Some((name, time))
        })
        .collect()
}

fn newest(repo: &gix::Repository) -> Option<String> {
    snapshot_refs(repo)
        .into_iter()
        .max_by_key(|(_, time)| *time)
        .map(|(reference, _)| reference)
}

fn forget_old(repo: &gix::Repository, git: &Git, keep_days: u32) {
    let cutoff = now_millis() - i64::from(keep_days) * 24 * 3600 * 1000;
    for (reference, time) in snapshot_refs(repo) {
        if time < cutoff {
            let _ = git.run(&["update-ref", "-d", &reference]);
        }
    }
}
