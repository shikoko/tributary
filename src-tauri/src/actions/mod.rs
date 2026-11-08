//! Actions that change a repository. They run the user's own `git`, so they behave
//! exactly like git does on the command line (line endings, LFS, hooks, credentials, …).
//!
//! Every value that ends up on git's command line is checked first (commit ids must
//! be full ids of existing commits, branch and remote names must exist or be valid),
//! so nothing can be mistaken for a git option.

mod backups;
mod branches;
mod changes;
mod clone;
mod conflicts;
mod elsewhere;
mod files;
mod history;
mod lfs;
mod lfs_health;
mod prune;
mod remote;
mod stash;
mod support;
mod tags;
mod validate;
mod worktrees;

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::git::{Git, Progress};

pub use backups::{BACKUP_DAYS, Backup, BackupEvent, backups};
pub use clone::{CloneOptions, clone_repository, init_repository};
pub use elsewhere::{OtherChange, Overlap, changed_elsewhere};
pub use files::{FileHistory, file_history};
pub use lfs::{FileChecks, LargeFile, LfsStorage, file_checks, lfs_storage_of};
pub use lfs_health::{LfsHealth, lfs_health};
pub use prune::{
    CommitBrief, LostCommits, PruneCandidate, PruneInfo, lost_commits, prune_candidates,
};

use self::stash::{pop_stash, stash_top};

/// Something to do to the repository, as sent by the frontend.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    /// `git reset --hard <id>` on the checked-out branch.
    ResetHard { id: String },
    /// Switch to a local branch.
    CheckoutBranch { name: String },
    /// Create a local branch tracking a remote branch like `origin/feature`, and switch to it.
    CheckoutRemoteBranch { name: String },
    /// Check out a commit without a branch (detached HEAD).
    CheckoutCommit { id: String },
    /// Create a branch at a commit, and optionally switch to it.
    CreateBranch {
        name: String,
        id: String,
        checkout: bool,
    },
    /// Fetch from every remote. `background` fetches never show sign-in prompts.
    Fetch {
        #[serde(default)]
        background: bool,
    },
    /// Pull into the checked-out branch.
    Pull,
    /// Push the checked-out branch, setting its upstream if it has none.
    /// `force` uses `--force-with-lease`.
    Push { force: bool },
    /// Stash uncommitted changes, run `action`, then put the changes back.
    StashAndRetry {
        action: Box<Action>,
        #[serde(default, rename = "includeUntracked")]
        include_untracked: bool,
    },
    /// `git stash push`.
    StashPush {
        message: Option<String>,
        #[serde(default, rename = "includeUntracked")]
        include_untracked: bool,
        /// Only these files (all changes when empty).
        #[serde(default)]
        paths: Vec<String>,
    },
    /// Apply `stash@{index}`, which must be the stash commit `id`, and keep it.
    StashApply { index: usize, id: String },
    /// Apply `stash@{index}` and remove it from the stash list.
    StashPop { index: usize, id: String },
    /// Remove `stash@{index}` without applying it.
    StashDrop { index: usize, id: String },
    /// Stage files (`git add`).
    Stage { paths: Vec<String> },
    /// Unstage files, keeping their changes in the working tree.
    Unstage { paths: Vec<String> },
    /// Stage every change, including untracked files.
    StageAll,
    /// Unstage everything.
    UnstageAll,
    /// Commit the staged changes, or amend the last commit.
    Commit { message: String, amend: bool },
    /// `git reset --soft <id>`: move the branch, keeping all changes staged.
    ResetSoft { id: String },
    /// Delete a local branch. Without `force`, git refuses if it isn't merged.
    DeleteBranch { name: String, force: bool },
    /// Delete a branch like `origin/feature` from its remote.
    DeleteRemoteBranch { name: String },
    /// Delete several local branches (pruning), each only if it still points at the
    /// commit given. The ones that can't be deleted are reported; the rest still go.
    DeleteBranches { branches: Vec<BranchTip> },
    /// Put back deleted branches, with the upstream they had (undoing a prune).
    RestoreBranches { branches: Vec<BranchTip> },
    /// Push a deleted remote branch like `origin/feature` back, at commit `id` (undo).
    RestoreRemoteBranch { name: String, id: String },
    /// Put back what a backup kept (see [`backups`]).
    RestoreBackup { reference: String },
    /// Forget a backup.
    RemoveBackup { reference: String },
    /// Rename a local branch.
    RenameBranch {
        name: String,
        #[serde(rename = "newName")]
        new_name: String,
    },
    /// Merge a branch, tag or commit into the checked-out branch.
    Merge {
        target: String,
        #[serde(default)]
        mode: MergeMode,
    },
    /// Rebase the checked-out branch onto a branch, tag or commit.
    Rebase { onto: String },
    /// Apply the changes of a commit on top of the checked-out branch.
    CherryPick { id: String },
    /// Make a new commit that undoes a commit.
    Revert { id: String },
    /// Carry on with a merge, rebase, cherry-pick or revert after resolving conflicts.
    ContinueOperation,
    /// Leave out the commit a rebase, cherry-pick or revert stopped at.
    SkipCommit,
    /// Give up on a merge, rebase, cherry-pick or revert, going back to how things were.
    AbortOperation,
    /// Cherry-pick several commits, in the order given (oldest first).
    CherryPickMany { ids: Vec<String> },
    /// Revert several commits, in the order given (newest first).
    RevertMany { ids: Vec<String> },
    /// Rewrite the commits after `onto` on the checked-out branch: reorder, reword,
    /// squash, fix up or drop them. `steps` lists every one of those commits, oldest first.
    InteractiveRebase {
        onto: String,
        steps: Vec<RebaseStep>,
    },
    /// Create a tag on a commit: annotated when there is a message, lightweight otherwise.
    CreateTag {
        name: String,
        id: String,
        message: Option<String>,
    },
    /// Delete a local tag.
    DeleteTag { name: String },
    /// Put back a deleted tag, pointing at a commit or tag object `id`.
    RestoreTag { name: String, id: String },
    /// Push a tag to a remote (the default remote when none is given).
    PushTag {
        name: String,
        remote: Option<String>,
    },
    /// Delete a tag from a remote.
    DeleteRemoteTag { name: String, remote: String },
    /// Resolve conflicted files by taking one side's version of each whole file: yours
    /// (the checked-out branch, or the branch being rebased) or theirs. A side that
    /// deleted the file deletes it. For files that can't be merged, like game assets.
    ResolveConflicts { paths: Vec<String>, keep: Side },
    /// Put the conflicts back into files resolved with [`Action::ResolveConflicts`] (undo).
    RecreateConflicts { paths: Vec<String> },
    /// Lock files with Git LFS, so nobody else can push changes to them.
    LockFiles { paths: Vec<String> },
    /// Store files matching `patterns` (like `*.psd`) with Git LFS from now on, and turn
    /// the staged `paths` among them into LFS files.
    TrackWithLfs {
        patterns: Vec<String>,
        #[serde(default)]
        paths: Vec<String>,
    },
    /// Throw away the changes to files (untracked ones are deleted). What they were is
    /// kept for [`BACKUP_DAYS`] days, to undo with [`Action::RestoreDiscarded`].
    DiscardFiles { paths: Vec<String> },
    /// Put back changes thrown away by [`Action::DiscardFiles`].
    RestoreDiscarded { reference: String },
    /// Add patterns (like `*.log` or `Saved/`) to the repository's `.gitignore`.
    IgnorePaths { patterns: Vec<String> },
    /// Take patterns out of `.gitignore` again (undo).
    UnignorePaths { patterns: Vec<String> },
    /// Delete local copies of Git LFS files that aren't needed any more (`git lfs prune`).
    PruneLfs,
    /// Download the files stored with Git LFS that are still pointer files (`git lfs pull`).
    DownloadLfsFiles,
    /// Set git up to use Git LFS (`git lfs install`), then download its files.
    SetUpLfs,
    /// Check out `branch` in a new working tree at `path` (an absolute folder that's new
    /// or empty): an existing local branch, or with `create`, a new one at commit `start`.
    AddWorktree {
        path: String,
        branch: String,
        #[serde(default)]
        create: bool,
        #[serde(default)]
        start: Option<String>,
    },
    /// Delete a linked working tree's folder. `force` throws away its uncommitted changes.
    RemoveWorktree {
        path: String,
        #[serde(default)]
        force: bool,
    },
    /// Forget working trees whose folders are gone.
    PruneWorktrees,
    /// Release Git LFS locks, by id (the file may not exist here). `force` releases
    /// someone else's lock.
    UnlockFiles {
        locks: Vec<LockRef>,
        #[serde(default)]
        force: bool,
    },
}

/// A Git LFS lock: its id, and the file it's on (for messages).
#[derive(Debug, Clone, Deserialize)]
pub struct LockRef {
    pub id: String,
    pub path: String,
}

/// How to merge.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeMode {
    /// Like `git merge`: fast-forward when possible, otherwise a merge commit.
    #[default]
    Default,
    /// Always make a merge commit (`--no-ff`).
    NoFastForward,
    /// Put all the changes together, staged, to commit as one commit (`--squash`).
    Squash,
}

/// Which version of a conflicted file to keep.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    /// The checked-out branch's version (for a rebase, the branch being rebased).
    Mine,
    /// The version being merged, picked or rebased onto.
    Theirs,
}

/// A local branch, the commit it points to and, to restore it as it was, its upstream
/// (`branch.<name>.remote` and `branch.<name>.merge`).
#[derive(Debug, Clone, Deserialize)]
pub struct BranchTip {
    pub name: String,
    pub id: String,
    #[serde(default)]
    pub remote: Option<String>,
    #[serde(default)]
    pub merge: Option<String>,
}

/// One commit in an interactive rebase.
#[derive(Debug, Deserialize)]
pub struct RebaseStep {
    pub id: String,
    pub action: StepAction,
    /// The new message, for [`StepAction::Reword`].
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StepAction {
    Pick,
    /// Keep the commit with a new message.
    Reword,
    /// Combine with the commit before it, keeping both messages.
    Squash,
    /// Combine with the commit before it, keeping only that commit's message.
    Fixup,
    Drop,
}

/// What an action did.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    /// A short message for the user.
    pub message: String,
    /// After pushing a new branch: the page the remote suggested for opening a pull request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<String>,
    /// Where what the action threw away was kept, to undo it (like discarded changes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup: Option<String>,
}

/// What an action reports besides its message.
#[derive(Default)]
struct Extra {
    pull_request: Option<String>,
    backup: Option<String>,
}

/// Run `action` and return a short message saying what happened.
pub fn run(path: &Path, action: Action) -> Result<String, Error> {
    run_with_progress(path, action, &|_| {}).map(|outcome| outcome.message)
}

/// Like [`run`], reporting how far a fetch, pull or push has got.
pub fn run_with_progress(
    path: &Path,
    action: Action,
    on_progress: &dyn Fn(Progress),
) -> Result<Outcome, Error> {
    let mut extra = Extra::default();
    let message = perform(path, action, on_progress, &mut extra)?;
    Ok(Outcome {
        message,
        pull_request: extra.pull_request,
        backup: extra.backup,
    })
}

fn perform(
    path: &Path,
    action: Action,
    on_progress: &dyn Fn(Progress),
    extra: &mut Extra,
) -> Result<String, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree, so this can't be done here.")?
        .to_owned();
    let git = Git::find(workdir)?;

    match action {
        Action::ResetHard { id } => branches::reset_hard(&repo, &git, id),
        Action::CheckoutBranch { name } => branches::checkout_branch(&repo, &git, name),
        Action::CheckoutRemoteBranch { name } => {
            branches::checkout_remote_branch(&repo, &git, name)
        }
        Action::CheckoutCommit { id } => branches::checkout_commit(&repo, &git, id),
        Action::CreateBranch { name, id, checkout } => {
            branches::create_branch(&repo, &git, name, id, checkout)
        }
        Action::Fetch { background } => remote::fetch(&repo, &git, background, on_progress),
        Action::Pull => remote::pull(&repo, &git, on_progress),
        Action::Push { force } => remote::push(&repo, &git, force, on_progress, extra),
        Action::StashAndRetry {
            action,
            include_untracked,
        } => {
            if matches!(*action, Action::StashAndRetry { .. }) {
                return Err("Nested retries aren't supported.".into());
            }
            let before = stash_top(&git);
            let mut args = vec![
                "stash",
                "push",
                "--quiet",
                "--message",
                "Tributary: stashed to retry",
            ];
            if include_untracked {
                args.push("--include-untracked");
            }
            git.run(&args)?;
            if stash_top(&git) == before {
                // Nothing was stashed after all.
                return perform(path, *action, on_progress, extra);
            }
            match perform(path, *action, on_progress, extra) {
                Err(error) => match pop_stash(&git) {
                    Ok(()) => Err(error),
                    Err(_) => Err(format!(
                        "{error}\n\nYour changes couldn't be put back automatically. They're saved as stash@{{0}}."
                    ).into()),
                },
                Ok(message) => match pop_stash(&git) {
                    Ok(()) => Ok(format!("{message}, and put your changes back")),
                    Err(conflict) => Err(format!(
                        "{message}, but your changes conflict with it. Resolve the conflicts in the marked files; \
                         your changes are also still saved as stash@{{0}}.\n\n{conflict}"
                    ).into()),
                },
            }
        }
        Action::StashPush {
            message,
            include_untracked,
            paths,
        } => stash::stash_push(&git, message, include_untracked, paths),
        Action::StashApply { index, id } => stash::stash_apply(&git, index, id),
        Action::StashPop { index, id } => stash::stash_pop(&git, index, id),
        Action::StashDrop { index, id } => stash::stash_drop(&git, index, id),
        Action::Stage { paths } => changes::stage(&git, paths),
        Action::Unstage { paths } => changes::unstage(&repo, &git, paths),
        Action::StageAll => changes::stage_all(&git),
        Action::UnstageAll => changes::unstage_all(&repo, &git),
        Action::Commit { message, amend } => changes::commit(&git, message, amend),
        Action::ResetSoft { id } => branches::reset_soft(&repo, &git, id),
        Action::DeleteBranch { name, force } => branches::delete_branch(&repo, &git, name, force),
        Action::DeleteRemoteBranch { name } => branches::delete_remote_branch(&repo, &git, name),
        Action::DeleteBranches { branches } => branches::delete_branches(&repo, &git, branches),
        Action::RestoreBranches { branches } => branches::restore_branches(&repo, &git, branches),
        Action::RestoreRemoteBranch { name, id } => {
            branches::restore_remote_branch(&repo, &git, name, id, on_progress)
        }
        Action::RestoreBackup { reference } => {
            backups::restore_backup(&repo, &git, reference, on_progress)
        }
        Action::RemoveBackup { reference } => backups::remove_backup(&git, reference),
        Action::RenameBranch { name, new_name } => {
            branches::rename_branch(&repo, &git, name, new_name)
        }
        Action::Merge { target, mode } => history::merge(&repo, &git, target, mode),
        Action::Rebase { onto } => history::rebase(&repo, &git, onto),
        Action::CherryPick { id } => history::cherry_pick(&repo, &git, id),
        Action::Revert { id } => history::revert(&repo, &git, id),
        Action::ContinueOperation => conflicts::continue_operation(&repo, &git),
        Action::SkipCommit => conflicts::skip_commit(&repo, &git),
        Action::AbortOperation => conflicts::abort_operation(&repo, &git),
        Action::CherryPickMany { ids } => history::cherry_pick_many(&repo, &git, ids),
        Action::RevertMany { ids } => history::revert_many(&repo, &git, ids),
        Action::InteractiveRebase { onto, steps } => {
            history::interactive_rebase(&repo, &git, onto, steps)
        }
        Action::CreateTag { name, id, message } => tags::create_tag(&repo, &git, name, id, message),
        Action::DeleteTag { name } => tags::delete_tag(&repo, &git, name),
        Action::RestoreTag { name, id } => tags::restore_tag(&repo, &git, name, id),
        Action::PushTag { name, remote } => tags::push_tag(&repo, &git, name, remote, on_progress),
        Action::DeleteRemoteTag { name, remote } => {
            tags::delete_remote_tag(&repo, &git, name, remote)
        }
        Action::ResolveConflicts { paths, keep } => {
            conflicts::resolve_conflicts(&repo, &git, paths, keep)
        }
        Action::RecreateConflicts { paths } => conflicts::recreate_conflicts(&repo, &git, paths),
        Action::LockFiles { paths } => lfs::lock_files(&git, paths),
        Action::TrackWithLfs { patterns, paths } => lfs::track_with_lfs(&git, patterns, paths),
        Action::DiscardFiles { paths } => changes::discard_files(&repo, &git, paths, extra),
        Action::RestoreDiscarded { reference } => {
            changes::restore_discarded(&repo, &git, reference)
        }
        Action::IgnorePaths { patterns } => changes::ignore_paths(&git, patterns),
        Action::UnignorePaths { patterns } => changes::unignore_paths(&git, patterns),
        Action::PruneLfs => lfs::prune_lfs(&git),
        Action::DownloadLfsFiles => lfs_health::download_lfs_files(&git, on_progress),
        Action::SetUpLfs => lfs_health::set_up_lfs(&git, on_progress),
        Action::AddWorktree {
            path,
            branch,
            create,
            start,
        } => worktrees::add_worktree(&repo, &git, path, branch, create, start),
        Action::RemoveWorktree { path, force } => {
            worktrees::remove_worktree(&repo, &git, path, force)
        }
        Action::PruneWorktrees => worktrees::prune_worktrees(&git),
        Action::UnlockFiles { locks, force } => lfs::unlock_files(&git, locks, force),
    }
}
