//! One commit's full message, people and changed files.

use std::path::Path;

use gix::ObjectId;
use gix::bstr::ByteSlice;
use gix::object::tree::diff::ChangeDetached;
use serde::Serialize;
use ts_rs::TS;

use super::open;
use super::status::{FileChange, FileStatus};
use crate::error::{Error, Result};

#[derive(Debug, Serialize, TS)]
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
    /// Its signature, when it's signed.
    pub signature: Option<CommitSignature>,
}

/// A signed commit's signature, as git checks it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CommitSignature {
    /// good: a trusted key's; untrusted: good, but the key isn't trusted; expired or revoked:
    /// good, by a key that no longer is; bad: it doesn't match; unchecked: it couldn't be checked.
    pub status: SignatureStatus,
    /// "gpg", "ssh" or "x509".
    pub kind: &'static str,
    /// Who signed it, as the key says.
    pub signer: Option<String>,
    /// The key it was signed with.
    pub key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SignatureStatus {
    /// A good signature, by a key that's trusted.
    Good,
    /// A good signature, by a key that isn't trusted (or can't be told).
    Untrusted,
    /// A good signature by a key that has expired or was revoked, or that has expired itself.
    Expired,
    Revoked,
    /// The signature doesn't match the commit.
    Bad,
    /// It couldn't be checked: the key is missing, or (for SSH) no allowed signers are set up.
    Unchecked,
}

#[derive(Debug, Serialize, TS)]
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
        signature: signature(path, &commit),
    })
}

/// The commit's signature, checked by git (which asks GPG or ssh-keygen), if it's signed.
fn signature(path: &Path, commit: &gix::Commit<'_>) -> Option<CommitSignature> {
    let decoded = commit.decode().ok()?;
    let raw = decoded.extra_headers().pgp_signature()?;
    let kind = signature_kind(raw.as_ref());
    let git = crate::git::Git::find(path.to_owned()).ok()?.in_background();
    let id = commit.id.to_string();
    let checked = git
        .run(&["log", "-1", "--no-walk", "--format=%G?%x1f%GS%x1f%GK", &id])
        .unwrap_or_default();
    Some(read_signature(&checked, kind))
}

fn signature_kind(raw: &[u8]) -> &'static str {
    if raw.starts_with(b"-----BEGIN SSH SIGNATURE") {
        "ssh"
    } else if raw.starts_with(b"-----BEGIN SIGNED MESSAGE") || raw.starts_with(b"-----BEGIN PKCS7")
    {
        "x509"
    } else {
        "gpg"
    }
}

/// `git log --format=%G?%x1f%GS%x1f%GK` for a signed commit.
fn read_signature(checked: &str, kind: &'static str) -> CommitSignature {
    let mut fields = checked.trim_end_matches('\n').split('\x1f');
    let code = fields.next().unwrap_or_default().trim();
    let text = |field: Option<&str>| {
        field
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let signer = text(fields.next());
    let key = text(fields.next());
    let status = match code {
        "G" => SignatureStatus::Good,
        "U" => SignatureStatus::Untrusted,
        "X" | "Y" => SignatureStatus::Expired,
        "R" => SignatureStatus::Revoked,
        "B" => SignatureStatus::Bad,
        // E: the key is missing; N: git couldn't check it at all (for SSH, without allowed signers).
        _ => SignatureStatus::Unchecked,
    };
    CommitSignature {
        status,
        kind,
        signer,
        key,
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_signatures() {
        let good = read_signature(
            "G\x1fMaya Chen <maya@example.com>\x1fA5EAD03C8BBDB70B\n",
            "gpg",
        );
        assert_eq!(good.status, SignatureStatus::Good);
        assert_eq!(good.signer.as_deref(), Some("Maya Chen <maya@example.com>"));
        assert_eq!(good.key.as_deref(), Some("A5EAD03C8BBDB70B"));
        assert_eq!(
            read_signature("B\x1f\x1f", "gpg").status,
            SignatureStatus::Bad
        );
        let unchecked = read_signature("N\x1f\x1f\n", "ssh");
        assert_eq!(
            (unchecked.status, unchecked.signer),
            (SignatureStatus::Unchecked, None)
        );
        assert_eq!(read_signature("", "gpg").status, SignatureStatus::Unchecked);
        assert_eq!(
            signature_kind(b"-----BEGIN SSH SIGNATURE-----\nU1NI"),
            "ssh"
        );
        assert_eq!(signature_kind(b"-----BEGIN PGP SIGNATURE-----"), "gpg");
    }
}
