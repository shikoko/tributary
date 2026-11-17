//! What each action is like, for the frontend: how it shows while it runs, what can be done
//! when it fails, whether it rewrites history, and what undoes it. Said here, beside the
//! actions, so that a new one is described when it's added: [`Action::running`] lists every
//! action, with no catch-all.

use serde::Serialize;
use ts_rs::TS;

use super::Action;

/// What a long action shows while it runs: its progress bar, and the toolbar button it's
/// running from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Running {
    Fetch,
    Pull,
    Push,
    Sync,
    /// Downloading Git LFS files.
    Download,
    Submodules,
    Checkout,
    Discard,
}

impl Running {
    /// Its progress bar's words, when nothing more particular is known.
    fn label(self) -> &'static str {
        match self {
            Running::Fetch => "Fetching",
            Running::Pull => "Pulling",
            Running::Push => "Pushing",
            Running::Sync => "Syncing",
            Running::Download => "Downloading Git LFS files",
            Running::Submodules => "Updating submodules",
            Running::Checkout => "Checking out",
            Running::Discard => "Discarding changes",
        }
    }
}

/// An action that rewrites the checked-out branch's history, which is asked about first on a
/// protected branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Rewrite {
    /// What does it, to start a sentence: "This interactive rebase".
    pub what: String,
    /// The button that goes ahead: "Start rebase".
    pub confirm: String,
}

/// What an action is like.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ActionInfo {
    /// What it shows while it runs, for one that can take a while: none for a quick one.
    pub running: Option<Running>,
    /// Its progress bar's words: "Pushing", "Force pushing", "Checking out main".
    pub label: Option<String>,
    /// It can be stopped partway. A checkout or a discard can't: the files would be left
    /// half done.
    pub cancellable: bool,
    /// It goes to a remote, so file locks and pull requests may have changed after it.
    pub remote: bool,
    /// When uncommitted changes are in the way, it can run again with them put aside.
    pub retryable: bool,
    /// It rewrites the checked-out branch's history.
    pub rewrites: Option<Rewrite>,
}

impl Action {
    /// What this action is like, for the frontend.
    pub fn info(&self) -> ActionInfo {
        let running = self.running();
        ActionInfo {
            running,
            label: running.map(|running| match self.checkout_target() {
                Some(target) if running == Running::Checkout => format!("Checking out {target}"),
                _ if matches!(self, Action::Push { force: true, .. }) => "Force pushing".into(),
                _ => running.label().into(),
            }),
            cancellable: running
                .is_some_and(|running| !matches!(running, Running::Checkout | Running::Discard)),
            remote: running
                .is_some_and(|running| !matches!(running, Running::Checkout | Running::Discard)),
            retryable: matches!(
                self,
                Action::Pull
                    | Action::Sync
                    | Action::FetchLatest
                    | Action::CheckoutBranch { .. }
                    | Action::CheckoutRemoteBranch { .. }
                    | Action::CheckoutCommit { .. }
                    | Action::CreateBranch { .. }
                    | Action::Merge { .. }
                    | Action::Rebase { .. }
                    | Action::CherryPick { .. }
                    | Action::CherryPickOnto { .. }
                    | Action::Revert { .. }
                    | Action::CherryPickMany { .. }
                    | Action::RevertMany { .. }
                    | Action::InteractiveRebase { .. }
                    | Action::BisectStart { .. }
                    | Action::BisectMark { .. }
            ),
            rewrites: self.rewrites(),
        }
    }

    /// What it shows while it runs, if it can take a while. Every action is here, so a new
    /// one has to say.
    fn running(&self) -> Option<Running> {
        match self {
            Action::Fetch { .. } | Action::FetchLatest => Some(Running::Fetch),
            Action::Pull => Some(Running::Pull),
            Action::Push { .. } | Action::Shelve { .. } => Some(Running::Push),
            Action::Sync => Some(Running::Sync),
            Action::OpenShelf { .. }
            | Action::DownloadLfsFiles
            | Action::SetUpLfs
            | Action::AnyDiskSpace { .. } => Some(Running::Download),
            Action::UpdateSubmodules { .. } => Some(Running::Submodules),
            Action::CheckoutBranch { .. }
            | Action::CheckoutRemoteBranch { .. }
            | Action::CheckoutCommit { .. } => Some(Running::Checkout),
            Action::CreateBranch { checkout, .. } => checkout.then_some(Running::Checkout),
            Action::DiscardFiles { .. } | Action::DiscardAll => Some(Running::Discard),
            // As the action it runs again.
            Action::StashAndRetry { action, .. } => action.running(),
            Action::ResetHard { .. }
            | Action::RestoreFromHistory { .. }
            | Action::DeleteShelf { .. }
            | Action::StashPush { .. }
            | Action::StashApply { .. }
            | Action::StashPop { .. }
            | Action::StashDrop { .. }
            | Action::Stage { .. }
            | Action::StageIgnored { .. }
            | Action::Unstage { .. }
            | Action::StageAll
            | Action::UnstageAll
            | Action::Commit { .. }
            | Action::ResetSoft { .. }
            | Action::DeleteBranch { .. }
            | Action::DeleteRemoteBranch { .. }
            | Action::DeleteBranches { .. }
            | Action::RestoreBranches { .. }
            | Action::RestoreRemoteBranch { .. }
            | Action::RestoreBackup { .. }
            | Action::RemoveBackup { .. }
            | Action::RenameBranch { .. }
            | Action::SetUpstream { .. }
            | Action::Merge { .. }
            | Action::Rebase { .. }
            | Action::CherryPick { .. }
            | Action::CherryPickOnto { .. }
            | Action::DropTip { .. }
            | Action::Revert { .. }
            | Action::ContinueOperation
            | Action::SkipCommit
            | Action::AbortOperation
            | Action::CherryPickMany { .. }
            | Action::RevertMany { .. }
            | Action::InteractiveRebase { .. }
            | Action::FixupInto { .. }
            | Action::SplitCommit { .. }
            | Action::MigrateToLfs { .. }
            | Action::Restack { .. }
            | Action::CreateTag { .. }
            | Action::DeleteTag { .. }
            | Action::RestoreTag { .. }
            | Action::PushTag { .. }
            | Action::DeleteRemoteTag { .. }
            | Action::ResolveConflicts { .. }
            | Action::RecreateConflicts { .. }
            | Action::ResolveWithText { .. }
            | Action::LockFiles { .. }
            | Action::TrackWithLfs { .. }
            | Action::RestoreDiscarded { .. }
            | Action::ApplyLines { .. }
            | Action::IgnorePaths { .. }
            | Action::UnignorePaths { .. }
            | Action::PruneLfs
            | Action::SetLfsFetchFolders { .. }
            | Action::AddWorktree { .. }
            | Action::RemoveWorktree { .. }
            | Action::PruneWorktrees
            | Action::OpenInDiffTool { .. }
            | Action::OpenInMergeTool { .. }
            | Action::UntrackWithLfs { .. }
            | Action::SetIdentity { .. }
            | Action::SetCommitTemplate { .. }
            | Action::FixSetup { .. }
            | Action::BisectStart { .. }
            | Action::BisectMark { .. }
            | Action::BisectReset
            | Action::AddRemote { .. }
            | Action::RenameRemote { .. }
            | Action::RemoveRemote { .. }
            | Action::SetRemoteUrl { .. }
            | Action::SetSparseFolders { .. }
            | Action::SavePatch { .. }
            | Action::ApplyPatch { .. }
            | Action::SetSpeedUp { .. }
            | Action::SpeedUpAll
            | Action::SetUpUnityMerge { .. }
            | Action::RemoveUnityMerge
            | Action::UnitySmartMerge { .. }
            | Action::SetSigning { .. }
            | Action::UnlockFiles { .. } => None,
        }
    }

    /// What a checkout checks out, for its progress bar: "art/barber-v2".
    fn checkout_target(&self) -> Option<String> {
        match self {
            Action::CheckoutBranch { name } => Some(name.clone()),
            Action::CheckoutRemoteBranch { name } => Some(
                name.split_once('/')
                    .map_or(name.as_str(), |(_, branch)| branch)
                    .into(),
            ),
            Action::CheckoutCommit { id } => Some(id.chars().take(7).collect()),
            Action::CreateBranch {
                name,
                checkout: true,
                ..
            } => Some(name.clone()),
            Action::StashAndRetry { action, .. } | Action::AnyDiskSpace { action } => {
                action.checkout_target()
            }
            _ => None,
        }
    }

    /// How it rewrites the checked-out branch's history, if it does.
    fn rewrites(&self) -> Option<Rewrite> {
        let (what, confirm) = match self {
            Action::Rebase { .. } => ("Rebasing", "Rebase"),
            Action::InteractiveRebase { .. } => ("This interactive rebase", "Start rebase"),
            Action::FixupInto { .. } => ("Fixing up an earlier commit", "Fix it up"),
            Action::SplitCommit { .. } => ("Splitting a commit", "Split it"),
            Action::Restack { .. } => ("Moving it onto the new branch below", "Move it"),
            Action::MigrateToLfs { .. } => ("Moving files into Git LFS", "Rewrite it"),
            _ => return None,
        };
        Some(Rewrite {
            what: what.into(),
            confirm: confirm.into(),
        })
    }
}

/// Where the repository was before an action: the checked-out branch, and the commit HEAD
/// was on.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Before {
    pub branch: Option<String>,
    pub commit: Option<String>,
}

/// The action that undoes `action`, given where the repository was before it and `backup`,
/// where the action kept what it threw away (when it did). None when it can't be undone.
pub fn undo(action: &Action, before: &Before, backup: Option<&str>) -> Option<Action> {
    if let Some(reference) = backup {
        match action {
            // Discarded files and lines are kept for a while, to put back.
            Action::DiscardFiles { .. }
            | Action::DiscardAll
            | Action::ApplyLines { .. }
            | Action::Shelve { keep: false, .. } => {
                return Some(Action::RestoreDiscarded {
                    reference: reference.into(),
                });
            }
            // Cherry-picked onto a branch that isn't checked out: it goes back where it was.
            Action::CherryPickOnto { branch, .. } => {
                return Some(Action::DropTip {
                    branch: branch.clone(),
                    id: reference.into(),
                });
            }
            // Restored from the local history: what the files were just before was kept too.
            Action::RestoreFromHistory { paths, .. } => {
                return Some(Action::RestoreFromHistory {
                    reference: reference.into(),
                    paths: paths.clone(),
                });
            }
            _ => {}
        }
    }
    let reset_hard = || before.commit.clone().map(|id| Action::ResetHard { id });
    let reset_soft = || before.commit.clone().map(|id| Action::ResetSoft { id });
    match action {
        Action::CheckoutBranch { .. }
        | Action::CheckoutRemoteBranch { .. }
        | Action::CheckoutCommit { .. } => match (&before.branch, &before.commit) {
            (Some(name), _) => Some(Action::CheckoutBranch { name: name.clone() }),
            (None, Some(id)) => Some(Action::CheckoutCommit { id: id.clone() }),
            (None, None) => None,
        },
        Action::ResetHard { .. }
        | Action::Merge { .. }
        | Action::Rebase { .. }
        | Action::Restack { .. }
        | Action::CherryPick { .. }
        | Action::Revert { .. }
        | Action::CherryPickMany { .. }
        | Action::RevertMany { .. }
        | Action::InteractiveRebase { .. } => reset_hard(),
        // Onto the checked-out branch, as a cherry-pick is (onto another, the backup says
        // what to take back off it, above).
        Action::CherryPickOnto { branch, .. } if before.branch.as_ref() == Some(branch) => {
            reset_hard()
        }
        // The files are as they were (split), or the staged changes go back to being staged
        // (commit): moving the branch back is enough.
        Action::SplitCommit { .. } | Action::Commit { .. } | Action::FixupInto { .. } => {
            reset_soft()
        }
        // Branches that weren't deleted are skipped when restoring.
        Action::DeleteBranches { branches } => Some(Action::RestoreBranches {
            branches: branches.clone(),
        }),
        Action::ResolveConflicts { paths, .. } => Some(Action::RecreateConflicts {
            paths: paths.clone(),
        }),
        Action::ResolveWithText { file, .. } | Action::UnitySmartMerge { file, .. } => {
            Some(Action::RecreateConflicts {
                paths: vec![file.clone()],
            })
        }
        Action::AddRemote { name, .. } => Some(Action::RemoveRemote { name: name.clone() }),
        Action::RenameRemote { from, to } => Some(Action::RenameRemote {
            from: to.trim().into(),
            to: from.clone(),
        }),
        Action::IgnorePaths { patterns } => Some(Action::UnignorePaths {
            patterns: patterns.clone(),
        }),
        Action::AnyDiskSpace { action } => undo(action, before, None),
        // Undone the same way: the changes put aside, undone, and put back. A commit's undo
        // keeps the changes staged, which putting them aside would get in the way of.
        Action::StashAndRetry {
            action,
            include_untracked,
        } => match undo(action, before, None)? {
            Action::ResetSoft { .. } => None,
            inner => Some(Action::StashAndRetry {
                action: Box::new(inner),
                include_untracked: *include_untracked,
            }),
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on_branch() -> Before {
        Before {
            branch: Some("main".into()),
            commit: Some("c3".into()),
        }
    }

    #[test]
    fn shows_long_actions_with_their_words() {
        let push = Action::Push {
            force: false,
            no_verify: false,
            overwrite: false,
        };
        let info = push.info();
        assert_eq!(info.running, Some(Running::Push));
        assert_eq!(info.label.as_deref(), Some("Pushing"));
        assert!(info.cancellable && info.remote && !info.retryable);
        let forced = Action::Push {
            force: true,
            no_verify: false,
            overwrite: false,
        };
        assert_eq!(forced.info().label.as_deref(), Some("Force pushing"));
        let checkout = Action::CheckoutRemoteBranch {
            name: "origin/art/barber".into(),
        };
        let info = checkout.info();
        assert_eq!(info.label.as_deref(), Some("Checking out art/barber"));
        assert!(!info.cancellable && !info.remote && info.retryable);
        assert_eq!(Action::StageAll.info().running, None);
    }

    #[test]
    fn runs_again_with_changes_put_aside_as_what_it_runs() {
        let retry = Action::StashAndRetry {
            action: Box::new(Action::Pull),
            include_untracked: false,
        };
        assert_eq!(retry.info().label.as_deref(), Some("Pulling"));
        let created = Action::CreateBranch {
            name: "art/barber".into(),
            id: "c3".into(),
            checkout: false,
        };
        assert_eq!(created.info().running, None);
    }

    #[test]
    fn says_which_actions_rewrite_history() {
        let rebase = Action::Rebase {
            onto: "main".into(),
        };
        assert_eq!(
            rebase.info().rewrites.map(|r| r.confirm),
            Some("Rebase".into())
        );
        assert_eq!(Action::Pull.info().rewrites, None);
    }

    #[test]
    fn goes_back_to_where_head_was_after_a_checkout() {
        let checkout = Action::CheckoutBranch {
            name: "feat".into(),
        };
        assert_eq!(
            undo(&checkout, &on_branch(), None),
            Some(Action::CheckoutBranch {
                name: "main".into()
            })
        );
        let detached = Before {
            branch: None,
            commit: Some("c3".into()),
        };
        assert_eq!(
            undo(&checkout, &detached, None),
            Some(Action::CheckoutCommit { id: "c3".into() })
        );
    }

    #[test]
    fn resets_after_history_changes_and_keeps_the_changes_after_a_commit() {
        let rebase = Action::Rebase { onto: "x".into() };
        assert_eq!(
            undo(&rebase, &on_branch(), None),
            Some(Action::ResetHard { id: "c3".into() })
        );
        let commit = Action::Commit {
            message: "s".into(),
            amend: false,
            no_verify: false,
        };
        assert_eq!(
            undo(&commit, &on_branch(), None),
            Some(Action::ResetSoft { id: "c3".into() })
        );
    }

    #[test]
    fn takes_a_pick_back_off_the_branch_it_went_onto() {
        let here = Action::CherryPickOnto {
            id: "c1".into(),
            branch: "main".into(),
        };
        assert_eq!(
            undo(&here, &on_branch(), None),
            Some(Action::ResetHard { id: "c3".into() })
        );
        let there = Action::CherryPickOnto {
            id: "c1".into(),
            branch: "release".into(),
        };
        assert_eq!(undo(&there, &on_branch(), None), None);
        assert_eq!(
            undo(&there, &on_branch(), Some("c9")),
            Some(Action::DropTip {
                branch: "release".into(),
                id: "c9".into()
            })
        );
    }

    #[test]
    fn puts_back_what_was_discarded() {
        assert_eq!(
            undo(
                &Action::DiscardAll,
                &on_branch(),
                Some("refs/tributary/discarded/1")
            ),
            Some(Action::RestoreDiscarded {
                reference: "refs/tributary/discarded/1".into()
            })
        );
    }

    #[test]
    fn undoes_stash_and_retry_the_same_way_but_not_a_commit() {
        let retried = Action::StashAndRetry {
            action: Box::new(Action::CheckoutBranch {
                name: "feat".into(),
            }),
            include_untracked: true,
        };
        assert_eq!(
            undo(&retried, &on_branch(), None),
            Some(Action::StashAndRetry {
                action: Box::new(Action::CheckoutBranch {
                    name: "main".into()
                }),
                include_untracked: true,
            })
        );
        let commit = Action::StashAndRetry {
            action: Box::new(Action::Commit {
                message: "s".into(),
                amend: false,
                no_verify: false,
            }),
            include_untracked: false,
        };
        assert_eq!(undo(&commit, &on_branch(), None), None);
        assert_eq!(
            undo(&Action::Fetch { background: false }, &on_branch(), None),
            None
        );
    }
}
