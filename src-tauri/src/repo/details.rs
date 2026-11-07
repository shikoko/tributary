//! One commit's full message, people and changed files.

use std::path::Path;

use gix::ObjectId;
use gix::bstr::ByteSlice;
use gix::object::tree::diff::ChangeDetached;
use serde::Serialize;

use super::open;
use super::status::{FileChange, FileStatus};
use crate::error::{Error, Result};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub id: String,
    pub summary: String,
    pub body: String,
    pub author: Person,
    pub committer: Person,
    pub parents: Vec<String>,
    /// Files changed compared to the first parent.
    pub files: Vec<FileChange>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub name: String,
    pub email: String,
    /// Seconds since the Unix epoch.
    pub time: i64,
    /// The author's timezone offset from UTC, in seconds.
    pub offset: i32,
}

/// Full message, people and changed files for one commit.
pub fn details(path: &Path, id: &str) -> Result<CommitDetails, Error> {
    let repo = open(path)?;
    let id =
        ObjectId::from_hex(id.as_bytes()).map_err(|e| format!("Invalid commit id {id}: {e}"))?;
    let commit = repo
        .find_commit(id)
        .map_err(|e| format!("Could not find commit {id}: {e}"))?;

    let (summary, body) = match commit.message() {
        Ok(message) => (
            message.summary().to_str_lossy().into_owned(),
            message
                .body
                .map(|body| body.to_str_lossy().trim().to_owned())
                .unwrap_or_default(),
        ),
        Err(_) => (
            commit.message_raw_sloppy().to_str_lossy().trim().to_owned(),
            String::new(),
        ),
    };

    let person = |signature: gix::Result<gix::actor::SignatureRef<'_>>| match signature {
        Ok(signature) => {
            let time = signature.time().unwrap_or_default();
            Person {
                name: signature.name.to_str_lossy().trim().to_owned(),
                email: signature.email.to_str_lossy().trim().to_owned(),
                time: time.seconds,
                offset: time.offset,
            }
        }
        Err(_) => Person {
            name: String::new(),
            email: String::new(),
            time: 0,
            offset: 0,
        },
    };
    let author = person(commit.author());
    let committer = person(commit.committer());
    let parents: Vec<ObjectId> = commit.parent_ids().map(|id| id.detach()).collect();

    let tree = commit
        .tree()
        .map_err(|e| format!("Could not read the tree of {id}: {e}"))?;
    let parent_tree = match parents.first() {
        Some(parent) => Some(
            repo.find_commit(*parent)
                .and_then(|parent| parent.tree())
                .map_err(|e| format!("Could not read the parent of {id}: {e}"))?,
        ),
        None => None,
    };
    let changes = repo
        .diff_tree_to_tree(parent_tree.as_ref(), &tree, None)
        .map_err(|e| format!("Could not diff {id}: {e}"))?;

    let mut files: Vec<FileChange> = changes
        .iter()
        .filter(|change| !change.entry_mode().is_tree())
        .map(file_change)
        .collect();
    // `git stash --include-untracked` keeps untracked files in a third parent.
    if let Some(untracked) = stash_untracked_files(&repo, &parents) {
        files.extend(untracked);
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(CommitDetails {
        id: id.to_string(),
        summary,
        body,
        author,
        committer,
        parents: parents.iter().map(ToString::to_string).collect(),
        files,
    })
}

/// The untracked files saved in a stash, if `parents` are those of a stash made
/// with `--include-untracked`.
pub(super) fn stash_untracked_files(
    repo: &gix::Repository,
    parents: &[ObjectId],
) -> Option<Vec<FileChange>> {
    let untracked = repo.find_commit(*parents.get(2)?).ok()?;
    let message = untracked.message_raw_sloppy();
    if untracked.parent_ids().next().is_some() || !message.starts_with(b"untracked files on ") {
        return None;
    }
    let tree = untracked.tree().ok()?;
    let changes = repo.diff_tree_to_tree(None, &tree, None).ok()?;
    Some(
        changes
            .iter()
            .filter(|change| !change.entry_mode().is_tree())
            .map(|change| FileChange {
                path: change.location().to_str_lossy().into_owned(),
                old_path: None,
                status: FileStatus::Untracked,
            })
            .collect(),
    )
}

pub(super) fn file_change(change: &ChangeDetached) -> FileChange {
    let path = change.location().to_str_lossy().into_owned();
    match change {
        ChangeDetached::Addition { .. } => FileChange {
            path,
            old_path: None,
            status: FileStatus::Added,
        },
        ChangeDetached::Deletion { .. } => FileChange {
            path,
            old_path: None,
            status: FileStatus::Deleted,
        },
        ChangeDetached::Modification { .. } => FileChange {
            path,
            old_path: None,
            status: FileStatus::Modified,
        },
        ChangeDetached::Rewrite {
            source_location,
            copy,
            ..
        } => FileChange {
            path,
            old_path: Some(source_location.to_str_lossy().into_owned()),
            status: if *copy {
                FileStatus::Copied
            } else {
                FileStatus::Renamed
            },
        },
    }
}
