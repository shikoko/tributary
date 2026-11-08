//! Reading a repository with gix (pure Rust, no git needed): its history, refs,
//! uncommitted changes, per-commit details and working trees.

mod compare;
mod details;
mod operation;
mod reflog;
mod refs;
mod remotes;
mod snapshot;
mod status;
mod worktrees;

use std::path::Path;

use crate::error::{Error, Result};

pub use compare::{Comparison, compare};
pub use details::{CommitDetails, CommitSignature, Person, SignatureStatus, details};
pub use operation::{Operation, OperationKind};
pub use reflog::{ReflogEntry, reflog};
pub(crate) use refs::web_remotes;
pub use refs::{HiddenRef, RefKind, RefLabel, Upstream, is_long_lived_branch};
pub use remotes::{NewCommits, RemoteState, commits_between, remote_state};
pub use snapshot::{
    CommitRow, Identity, LoadOptions, MAX_LIMIT, RepoSnapshot, RowKind, WORKTREE_ID, load,
    load_with,
};
pub use status::{FileChange, FileStatus, WorktreeStatus};
pub use worktrees::{Worktree, worktrees};

pub(crate) fn open(path: &Path) -> Result<gix::Repository, Error> {
    let mut repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    // Commits are looked up more than once while walking; a cache makes that cheap.
    repo.object_cache_size_if_unset(64 * 1024 * 1024);
    Ok(repo)
}
