//! Actions that change a repository. They run the user's own `git`, so they behave
//! exactly like git does on the command line (line endings, LFS, hooks, credentials, …).
//!
//! Every value that ends up on git's command line is checked first (commit ids must
//! be full ids of existing commits, branch and remote names must exist or be valid),
//! so nothing can be mistaken for a git option.

mod backups;
mod bisect;
mod blame;
mod branches;
mod changes;
mod clone;
mod conflicts;
mod diff;
mod diff_tools;
mod elsewhere;
mod file_names;
mod files;
mod history;
mod hooks;
mod identity;
mod ignored;
mod lfs;
mod lfs_count;
mod lfs_health;
mod lfs_settings;
mod local_history;
mod merge_check;
mod partial;
mod patches;
mod prune;
mod releases;
mod remote;
mod remote_settings;
mod rewrites;
mod search;
mod setup_check;
mod shelves;
mod signing;
mod size;
mod snapshot;
mod sparse;
mod speed;
mod split;
mod stacks;
mod stash;
mod submodules;
mod support;
mod tags;
mod team;
mod team_work;
mod unity;
mod unity_meta;
mod validate;
mod worktrees;

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::git::{Git, Progress};

pub use backups::{BACKUP_DAYS, Backup, BackupEvent, backups};
pub use bisect::Verdict;
pub use blame::{Blame, BlameCommit, BlameLine, blame};
pub use clone::{CloneOptions, clone_repository, init_repository};
pub use conflicts::{ConflictText, conflict_text};
pub use diff::{
    DiffLine, DiffSource, FileDiff, Hunk, LineKind, Media, MediaKind, SubmoduleChange,
    SubmoduleCommit, file_diff,
};
pub use diff_tools::{DiffToolSettings, Scope, ToolChoice, diff_tool_settings, set_diff_tool};
pub use elsewhere::{OtherChange, Overlap, changed_elsewhere};
pub use file_names::{LONG_PATH, NameProblem, Problem};
pub use files::{FileHistory, file_history};
pub use identity::{CommitTemplate, RepoIdentity, commit_template, repo_identity};
pub use ignored::{IgnoreReason, IgnoreRule, ignore_reason};
pub use lfs::{FileChecks, LargeFile, LfsStorage, file_checks, lfs_storage_of};
pub use lfs_health::{LfsHealth, lfs_health};
pub use lfs_settings::{LfsFolder, LfsSettings, LfsSuggestion, lfs_settings};
pub use local_history::{Snapshot, SnapshotFile, local_history, take_snapshot};
pub use merge_check::{MergeCheck, MergeOutcome, merge_check};
pub use partial::LineMode;
pub use patches::{PatchCommit, PatchFile, PatchInfo, patch_info, patch_text};
pub use prune::{
    CommitBrief, LostCommits, PruneCandidate, PruneInfo, lost_commits, prune_candidates,
};
pub use releases::{ReleaseItem, ReleaseNotes, release_notes};
pub use remote_settings::{RemoteInfo, remotes};
pub use rewrites::{BranchVersion, CommitPair, PairStatus, RangeDiff, branch_versions, range_diff};
pub use search::{SearchMode, SearchResult, search_commits};
pub use setup_check::{CheckStatus, Engine, ProjectSetup, SetupCheck, SetupFix, project_setup};
pub use shelves::{Shelf, ShelfFile, shelves};
pub use signing::{SigningKey, SigningMode, SigningSettings, signing_settings};
pub use size::{BigFile, RepoSize, SizeGroup, repo_size};
pub use sparse::{FolderChoice, SparseSettings, sparse_settings};
pub use speed::{SpeedSettings, SpeedUp, speed_settings};
pub use stacks::{Stacked, branch_stacks};
pub use submodules::{Submodule, SubmoduleState, submodules};
pub use team::{
    BranchActivity, BranchPerson, TeamActivity, TeamPerson, TeamPulse, team_activity, team_pulse,
};
pub use team_work::{FileKind, Hotspot, KindCount, PersonWork, TeamWork, WorkCommit, team_work};
pub use unity::{UnitySetup, unity_setup};
pub use unity_meta::{MetaKind, MetaProblem};

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
    /// Fetch, and fast-forward the checked-out branch when nothing's in the way (never a merge).
    FetchLatest,
    /// Push the checked-out branch, setting its upstream if it has none.
    /// `force` uses `--force-with-lease`; `no_verify` skips the pre-push hook.
    Push {
        force: bool,
        #[serde(default, rename = "noVerify")]
        no_verify: bool,
    },
    /// Shelve the working copy's versions of `paths` (every change, when empty) for the
    /// team, as `description`; unless `keep`, take them out of the working copy after.
    Shelve {
        #[serde(default)]
        paths: Vec<String>,
        description: String,
        #[serde(default)]
        keep: bool,
    },
    /// Put files back as a local history snapshot had them (all its files, when empty).
    RestoreFromHistory {
        reference: String,
        #[serde(default)]
        paths: Vec<String>,
    },
    /// Take a shelf's files into the working copy.
    OpenShelf { reference: String },
    /// Delete a shelf, on the remote and here.
    DeleteShelf { reference: String },
    /// Run `action` without checking there's room on the disk for the Git LFS files it
    /// downloads (the person chose to go ahead anyway).
    AnyDiskSpace { action: Box<Action> },
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
    /// Stage files even though they're ignored (`git add --force`).
    StageIgnored { paths: Vec<String> },
    /// Unstage files, keeping their changes in the working tree.
    Unstage { paths: Vec<String> },
    /// Stage every change, including untracked files.
    StageAll,
    /// Unstage everything.
    UnstageAll,
    /// Commit the staged changes, or amend the last commit. `no_verify` skips the
    /// pre-commit and commit-msg hooks.
    Commit {
        message: String,
        amend: bool,
        #[serde(default, rename = "noVerify")]
        no_verify: bool,
    },
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
    /// Fold the staged changes into an earlier commit of the checked-out branch: commit
    /// them as a fixup of it, then rebase the commits after it with the fixup squashed in.
    FixupInto { id: String },
    /// Split a commit of the checked-out branch in two: `paths` (some of its files) move into
    /// a new commit right after it, with message `second`; it keeps the rest, with `first`.
    SplitCommit {
        id: String,
        paths: Vec<String>,
        first: String,
        second: String,
    },
    /// Move files matching `patterns` into Git LFS by rewriting history: the checked-out
    /// branch's commits not pushed yet, or with `everything`, every local branch's history.
    MigrateToLfs {
        patterns: Vec<String>,
        #[serde(default)]
        everything: bool,
    },
    /// Move the checked-out branch onto the new version of `onto`, which was rewritten after
    /// it was built on `old` (an earlier version of `onto`).
    Restack { onto: String, old: String },
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
    /// Put the conflicts back into files resolved with [`Action::ResolveConflicts`] or
    /// [`Action::ResolveWithText`] (undo).
    RecreateConflicts { paths: Vec<String> },
    /// Resolve a conflicted text file with `text`, worked out in the app: save it and stage it.
    ResolveWithText { file: String, text: String },
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
    /// Put back changes thrown away by [`Action::DiscardFiles`] or [`Action::ApplyLines`].
    RestoreDiscarded { reference: String },
    /// Stage, unstage or throw away the changes on some lines of `file`: `added` are line
    /// numbers after the change, `removed` before it, as the diff shows them. Thrown away
    /// lines are kept, to undo with [`Action::RestoreDiscarded`].
    ApplyLines {
        file: String,
        mode: LineMode,
        #[serde(default)]
        added: Vec<u32>,
        #[serde(default)]
        removed: Vec<u32>,
    },
    /// Add patterns (like `*.log` or `Saved/`) to the repository's `.gitignore`.
    IgnorePaths { patterns: Vec<String> },
    /// Take patterns out of `.gitignore` again (undo).
    UnignorePaths { patterns: Vec<String> },
    /// Delete local copies of Git LFS files that aren't needed any more (`git lfs prune`).
    PruneLfs,
    /// Download the files stored with Git LFS that are still pointer files (`git lfs pull`).
    DownloadLfsFiles,
    /// Download only the Git LFS files in the `include` folders (all, when empty) and not
    /// those in `exclude`: this repository's `lfs.fetchinclude` and `lfs.fetchexclude`.
    SetLfsFetchFolders {
        #[serde(default)]
        include: Vec<String>,
        #[serde(default)]
        exclude: Vec<String>,
    },
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
    /// Open a file's change in the user's diff tool (`git difftool`).
    OpenInDiffTool { source: DiffSource, path: String },
    /// Open a conflicted file in the user's merge tool (`git mergetool`).
    OpenInMergeTool { path: String },
    /// Stop storing files matching these patterns with Git LFS (`git lfs untrack`).
    UntrackWithLfs { patterns: Vec<String> },
    /// Commit as this name and email in this repository (`git config --local`); both
    /// empty go back to the usual ones.
    SetIdentity { name: String, email: String },
    /// Start new commits' messages from `text` here (empty: no template of this repository's own).
    SetCommitTemplate { text: String },
    /// Put one of the project setup check's findings right.
    FixSetup { fix: SetupFix },
    /// Start bisecting between a commit that works (`good`) and one that doesn't (`bad`).
    BisectStart { bad: String, good: String },
    /// Mark the commit being tested (or `id`) good, bad or skipped.
    BisectMark {
        verdict: Verdict,
        id: Option<String>,
    },
    /// Stop bisecting, back where it started.
    BisectReset,
    /// Add a remote called `name` at `url`.
    AddRemote { name: String, url: String },
    /// Rename a remote (its remote branches follow).
    RenameRemote { from: String, to: String },
    /// Remove a remote and its remote branches.
    RemoveRemote { name: String },
    /// Point a remote at another address, or only its pushes (`push`; empty: none of its own).
    SetRemoteUrl {
        name: String,
        url: String,
        push: bool,
    },
    /// Check out only these folders (and the files at the top), or every folder when it's
    /// empty.
    SetSparseFolders { folders: Vec<String> },
    /// Save commits as one patch file (oldest first), at `file`.
    SavePatch { ids: Vec<String>, file: String },
    /// Apply a patch file: as commits (`git am`), or as changes to the files (`git apply`).
    ApplyPatch {
        file: String,
        #[serde(rename = "asCommits")]
        as_commits: bool,
    },
    /// Turn one of git's speed-ups for big repositories on or off here.
    SetSpeedUp { which: SpeedUp, on: bool },
    /// Turn on every speed-up git has here.
    SpeedUpAll,
    /// Merge Unity's scenes, prefabs and other YAML files with Smart Merge (`tool`, the
    /// UnityYAMLMerge program) from now on, in this repository.
    SetUpUnityMerge { tool: String },
    /// Stop merging Unity's files with Smart Merge in this repository.
    RemoveUnityMerge,
    /// Merge a conflicted Unity file with Smart Merge (`tool`), and stage it.
    UnitySmartMerge { file: String, tool: String },
    /// Sign commits in this repository: as usual, never, or with a GPG or SSH key.
    SetSigning {
        mode: SigningMode,
        key: Option<String>,
    },
    /// Check out the recorded commit in these submodules (all of them when empty),
    /// setting up those that aren't yet (`git submodule update --init --recursive`).
    UpdateSubmodules {
        #[serde(default)]
        paths: Vec<String>,
    },
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
    /// After a push: the files the pushed commits changed.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub pushed_files: Vec<String>,
}

/// What an action reports besides its message.
#[derive(Default)]
struct Extra {
    pull_request: Option<String>,
    backup: Option<String>,
    pushed_files: Vec<String>,
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
        pushed_files: extra.pushed_files,
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
        Action::CheckoutBranch { name } => {
            branches::checkout_branch(&repo, &git, name, on_progress)
        }
        Action::CheckoutRemoteBranch { name } => {
            branches::checkout_remote_branch(&repo, &git, name, on_progress)
        }
        Action::CheckoutCommit { id } => branches::checkout_commit(&repo, &git, id, on_progress),
        Action::CreateBranch { name, id, checkout } => {
            branches::create_branch(&repo, &git, name, id, checkout, on_progress)
        }
        Action::Fetch { background } => remote::fetch(&repo, &git, background, on_progress),
        Action::Pull => remote::pull(&repo, &git, on_progress),
        Action::FetchLatest => remote::fetch_latest(&repo, &git, on_progress),
        Action::Push { force, no_verify } => {
            remote::push(&repo, &git, force, no_verify, on_progress, extra)
        }
        Action::Shelve {
            paths,
            description,
            keep,
        } => shelves::shelve(&repo, &git, paths, description, keep, on_progress, extra),
        Action::RestoreFromHistory { reference, paths } => {
            local_history::restore_from_history(&repo, &git, reference, paths, extra)
        }
        Action::OpenShelf { reference } => shelves::open_shelf(&repo, &git, reference, on_progress),
        Action::DeleteShelf { reference } => shelves::delete_shelf(&git, reference),
        Action::AnyDiskSpace { action } => {
            lfs_count::without_space_check(|| perform(path, *action, on_progress, extra))
        }
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
        Action::StageIgnored { paths } => ignored::stage_ignored(&git, paths),
        Action::Unstage { paths } => changes::unstage(&repo, &git, paths),
        Action::StageAll => changes::stage_all(&git),
        Action::UnstageAll => changes::unstage_all(&repo, &git),
        Action::Commit {
            message,
            amend,
            no_verify,
        } => changes::commit(&git, message, amend, no_verify),
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
        Action::FixupInto { id } => history::fixup_into(&repo, &git, id),
        Action::SplitCommit {
            id,
            paths,
            first,
            second,
        } => split::split_commit(&repo, &git, id, paths, first, second),
        Action::Restack { onto, old } => stacks::restack(&repo, &git, onto, old),
        Action::MigrateToLfs {
            patterns,
            everything,
        } => size::migrate_to_lfs(&repo, &git, patterns, everything),
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
        Action::ResolveWithText { file, text } => conflicts::resolve_with_text(&git, file, text),
        Action::LockFiles { paths } => lfs::lock_files(&git, paths),
        Action::TrackWithLfs { patterns, paths } => lfs::track_with_lfs(&git, patterns, paths),
        Action::DiscardFiles { paths } => changes::discard_files(&repo, &git, paths, extra),
        Action::RestoreDiscarded { reference } => {
            if partial::is_discarded_lines(&git, &reference) {
                partial::restore_discarded_lines(&repo, &git, &reference)
            } else {
                changes::restore_discarded(&repo, &git, reference)
            }
        }
        Action::ApplyLines {
            file,
            mode,
            added,
            removed,
        } => partial::apply_lines(&repo, &git, file, mode, added, removed, extra),
        Action::IgnorePaths { patterns } => changes::ignore_paths(&git, patterns),
        Action::UnignorePaths { patterns } => changes::unignore_paths(&git, patterns),
        Action::PruneLfs => lfs::prune_lfs(&git),
        Action::DownloadLfsFiles => lfs_health::download_lfs_files(&git, on_progress),
        Action::SetLfsFetchFolders { include, exclude } => {
            lfs_settings::set_lfs_fetch_folders(&git, include, exclude)
        }
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
        Action::OpenInDiffTool { source, path } => {
            diff::open_in_diff_tool(&repo, &git, source, path)
        }
        Action::OpenInMergeTool { path } => diff::open_in_merge_tool(&git, path),
        Action::SetIdentity { name, email } => identity::set_identity(&git, name, email),
        Action::SetCommitTemplate { text } => identity::set_commit_template(&git, text),
        Action::FixSetup { fix } => {
            let top = repo.workdir().map(Path::to_owned).unwrap_or_default();
            setup_check::fix_setup(&git, &top, fix)
        }
        Action::SetSigning { mode, key } => signing::set_signing(&git, mode, key),
        Action::SavePatch { ids, file } => patches::save_patch(path, ids, file),
        Action::ApplyPatch { file, as_commits } => patches::apply_patch(&git, file, as_commits),
        Action::SetSpeedUp { which, on } => speed::set_speed_up(&git, which, on, on_progress),
        Action::SpeedUpAll => speed::speed_up_all(&git, path, on_progress),
        Action::SetSparseFolders { folders } => {
            sparse::set_sparse_folders(&git, folders, on_progress)
        }
        Action::SetUpUnityMerge { tool } => unity::set_up_unity_merge(&git, tool),
        Action::RemoveUnityMerge => unity::remove_unity_merge(&git),
        Action::UnitySmartMerge { file, tool } => unity::unity_smart_merge(&git, file, tool),
        Action::BisectStart { bad, good } => bisect::start(&repo, &git, bad, good),
        Action::BisectMark { verdict, id } => bisect::mark(&repo, &git, verdict, id),
        Action::BisectReset => bisect::reset(&repo, &git),
        Action::AddRemote { name, url } => remote_settings::add_remote(&git, name, url),
        Action::RenameRemote { from, to } => remote_settings::rename_remote(&git, from, to),
        Action::RemoveRemote { name } => remote_settings::remove_remote(&git, name),
        Action::SetRemoteUrl { name, url, push } => {
            remote_settings::set_remote_url(&git, name, url, push)
        }
        Action::UntrackWithLfs { patterns } => lfs_settings::untrack_with_lfs(&git, patterns),
        Action::UpdateSubmodules { paths } => {
            submodules::update_submodules(&git, paths, on_progress)
        }
        Action::UnlockFiles { locks, force } => lfs::unlock_files(&git, locks, force),
    }
}
