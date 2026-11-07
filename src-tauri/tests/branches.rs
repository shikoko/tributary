//! Branches and tags: checking out, creating, deleting, renaming, resetting, pruning, backups.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{TempRepo, remote_turn, run, with_identity};
use tributary_lib::actions::{Action, BackupEvent, BranchTip};
use tributary_lib::{actions, repo};

#[test]
fn hard_reset_moves_the_branch_and_discards_changes() {
    let mut repo = TempRepo::new("reset");
    let first = repo.commit("a.txt", "First");
    repo.commit("a.txt", "Second");
    repo.commit("b.txt", "Third");
    std::fs::write(repo.path().join("a.txt"), "uncommitted").unwrap();
    std::fs::write(repo.path().join("untracked.txt"), "keep me").unwrap();

    let message = run(&repo, Action::ResetHard { id: first.clone() }).unwrap();

    assert_eq!(message, format!("Reset main to {}", &first[..7]));
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);
    assert_eq!(repo.git(&["branch", "--show-current"]), "main");
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "First"
    );
    assert!(!repo.path().join("b.txt").exists());
    assert!(
        repo.path().join("untracked.txt").exists(),
        "untracked files are kept"
    );
}

#[test]
fn actions_only_accept_full_ids_of_existing_commits() {
    let mut repo = TempRepo::new("invalid-ids");
    repo.commit("a.txt", "First");
    let missing = "0123456789012345678901234567890123456789";
    for id in ["--hard", "HEAD~1", "main", missing] {
        assert!(
            run(&repo, Action::ResetHard { id: id.into() }).is_err(),
            "{id}"
        );
        assert!(
            run(&repo, Action::CheckoutCommit { id: id.into() }).is_err(),
            "{id}"
        );
    }
}

#[test]
fn checks_out_branches_and_commits() {
    let mut repo = TempRepo::new("checkout");
    let first = repo.commit("a.txt", "First");
    let second = repo.commit("a.txt", "Second");

    let message = run(
        &repo,
        Action::CreateBranch {
            name: "feature".into(),
            id: first.clone(),
            checkout: false,
        },
    )
    .unwrap();
    assert_eq!(message, "Created feature");
    assert_eq!(repo.git(&["branch", "--show-current"]), "main");
    assert_eq!(repo.git(&["rev-parse", "feature"]), first);

    run(
        &repo,
        Action::CheckoutBranch {
            name: "feature".into(),
        },
    )
    .unwrap();
    assert_eq!(repo.git(&["branch", "--show-current"]), "feature");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);

    let message = run(&repo, Action::CheckoutCommit { id: second.clone() }).unwrap();
    assert_eq!(
        message,
        format!("Checked out {} (detached HEAD)", &second[..7])
    );
    assert_eq!(repo.git(&["branch", "--show-current"]), "");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), second);

    let message = run(
        &repo,
        Action::CreateBranch {
            name: " topic ".into(),
            id: first.clone(),
            checkout: true,
        },
    )
    .unwrap();
    assert_eq!(message, "Created and checked out topic");
    assert_eq!(repo.git(&["branch", "--show-current"]), "topic");
}

#[test]
fn rejects_bad_branch_names() {
    let mut repo = TempRepo::new("branch-names");
    let id = repo.commit("a.txt", "First");
    for name in ["", "-x", "has space", "two..dots", "main"] {
        let action = Action::CreateBranch {
            name: name.into(),
            id: id.clone(),
            checkout: false,
        };
        assert!(run(&repo, action).is_err(), "{name:?} should be rejected");
    }
    for name in ["--orphan", "missing"] {
        assert!(run(&repo, Action::CheckoutBranch { name: name.into() }).is_err());
        assert!(run(&repo, Action::CheckoutRemoteBranch { name: name.into() }).is_err());
    }
}

#[test]
fn deletes_and_renames_branches() {
    let mut repo = TempRepo::new("branch-admin");
    repo.commit("a.txt", "first");
    repo.git(&["branch", "merged"]);
    repo.git(&["switch", "--quiet", "--create", "unmerged"]);
    repo.commit("b.txt", "only here");
    repo.git(&["switch", "--quiet", "main"]);

    assert_eq!(
        run(
            &repo,
            Action::DeleteBranch {
                name: "merged".into(),
                force: false
            }
        )
        .unwrap(),
        "Deleted branch merged"
    );
    let refused = run(
        &repo,
        Action::DeleteBranch {
            name: "unmerged".into(),
            force: false,
        },
    )
    .unwrap_err();
    assert!(refused.contains("not fully merged"), "{refused}");
    run(
        &repo,
        Action::DeleteBranch {
            name: "unmerged".into(),
            force: true,
        },
    )
    .unwrap();
    assert!(repo.git(&["branch", "--list", "unmerged"]).is_empty());
    assert!(
        run(
            &repo,
            Action::DeleteBranch {
                name: "main".into(),
                force: true
            }
        )
        .is_err()
    );

    repo.git(&["branch", "old-name"]);
    assert_eq!(
        run(
            &repo,
            Action::RenameBranch {
                name: "old-name".into(),
                new_name: "new-name".into()
            }
        )
        .unwrap(),
        "Renamed old-name to new-name"
    );
    assert!(
        repo.git(&["branch", "--list", "new-name"])
            .contains("new-name")
    );
    assert!(
        run(
            &repo,
            Action::RenameBranch {
                name: "new-name".into(),
                new_name: "main".into()
            }
        )
        .is_err()
    );
    assert!(
        run(
            &repo,
            Action::RenameBranch {
                name: "new-name".into(),
                new_name: "bad name".into()
            }
        )
        .is_err()
    );
}

#[test]
fn deletes_remote_branches_and_fetches_in_the_background() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("delete-remote.git");
    let mut alice = TempRepo::new("delete-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    alice.commit("a.txt", "First");
    alice.git(&["push", "--quiet", "origin", "main", "main:feature"]);
    run(&alice, Action::Fetch { background: true }).unwrap();
    assert!(
        !alice
            .git(&["branch", "--remotes", "--list", "origin/feature"])
            .is_empty()
    );

    assert_eq!(
        run(
            &alice,
            Action::DeleteRemoteBranch {
                name: "origin/feature".into()
            }
        )
        .unwrap(),
        "Deleted feature from origin"
    );
    assert!(remote.git(&["branch", "--list", "feature"]).is_empty());
    assert!(
        alice
            .git(&["branch", "--remotes", "--list", "origin/feature"])
            .is_empty()
    );
    assert!(
        run(
            &alice,
            Action::DeleteRemoteBranch {
                name: "origin/missing".into()
            }
        )
        .is_err()
    );
    assert!(
        run(
            &alice,
            Action::DeleteRemoteBranch {
                name: "main".into()
            }
        )
        .is_err()
    );
}

/// Pruning offers local branches whose remote branch is gone or that are merged, never
/// the checked-out branch or long-lived ones, deletes only what still points where it did,
/// and can put them all back, upstreams included.
#[test]
fn prunes_gone_and_merged_branches_and_restores_them() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("prune-remote.git");
    let mut alice = TempRepo::new("prune-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    alice.commit("a.txt", "First");
    alice.git(&["push", "--quiet", "-u", "origin", "main"]);

    // Merged, then deleted on the remote: a merged pull request.
    alice.git(&["switch", "--quiet", "-c", "feat/merged"]);
    alice.commit("merged.txt", "Merged work");
    alice.git(&["push", "--quiet", "-u", "origin", "feat/merged"]);
    // Pushed, then deleted on the remote without being merged here: a squash merge.
    alice.git(&["switch", "--quiet", "-c", "feat/squashed", "main"]);
    alice.commit("squashed.txt", "Squashed work");
    alice.git(&["push", "--quiet", "-u", "origin", "feat/squashed"]);
    // Merged locally, never pushed.
    alice.git(&["switch", "--quiet", "-c", "feat/local", "main"]);
    alice.commit("local.txt", "Local work");
    // Still being worked on.
    alice.git(&["switch", "--quiet", "-c", "feat/active", "main"]);
    alice.commit("active.txt", "Active work");
    alice.git(&["push", "--quiet", "-u", "origin", "feat/active"]);
    alice.git(&["switch", "--quiet", "main"]);
    alice.git(&["merge", "--quiet", "--no-edit", "feat/merged"]);
    alice.git(&["merge", "--quiet", "--no-edit", "feat/local"]);
    alice.git(&["branch", "develop"]);
    alice.git(&["push", "--quiet", "origin", "main"]);
    remote.git(&["branch", "-D", "feat/merged", "feat/squashed"]);
    alice.git(&["fetch", "--quiet", "--prune"]);

    let snapshot = repo::load(alice.path(), 100, false).unwrap();
    assert_eq!(snapshot.gone_branches, ["feat/merged", "feat/squashed"]);

    let info = actions::prune_candidates(alice.path()).unwrap();
    assert_eq!(info.base.as_deref(), Some("origin/main"));
    let found: Vec<(&str, bool, bool, u32)> = info
        .candidates
        .iter()
        .map(|c| (c.name.as_str(), c.gone, c.merged, c.unmerged))
        .collect();
    assert_eq!(
        found,
        [
            ("feat/squashed", true, false, 1),
            ("feat/merged", true, true, 0),
            ("feat/local", false, true, 0),
        ],
        "gone first, newest first; not main, develop or feat/active"
    );
    let squashed = &info.candidates[0];
    assert_eq!(squashed.upstream.as_deref(), Some("origin/feat/squashed"));
    assert_eq!(squashed.remote.as_deref(), Some("origin"));
    assert_eq!(squashed.merge.as_deref(), Some("refs/heads/feat/squashed"));

    let tips: Vec<BranchTip> = info
        .candidates
        .iter()
        .map(|c| BranchTip {
            name: c.name.clone(),
            id: c.id.clone(),
            remote: c.remote.clone(),
            merge: c.merge.clone(),
        })
        .collect();
    // A branch that moved since it was listed is left alone; the others still go.
    let mut stale = tips.clone();
    stale[2].id = alice.git(&["rev-parse", "main~1"]);
    let message = run(&alice, Action::DeleteBranches { branches: stale }).unwrap();
    assert_eq!(
        message,
        "Deleted 2 branches. Couldn't delete feat/local (it has new commits since)"
    );
    let left = alice.git(&["branch", "--format=%(refname:short)"]);
    assert_eq!(
        left.lines().collect::<Vec<_>>(),
        ["develop", "feat/active", "feat/local", "main"]
    );

    assert_eq!(
        run(
            &alice,
            Action::RestoreBranches {
                branches: tips[..2].to_vec()
            }
        )
        .unwrap(),
        "Restored 2 branches"
    );
    assert_eq!(alice.git(&["rev-parse", "feat/squashed"]), squashed.id);
    assert_eq!(
        alice.git(&["config", "branch.feat/squashed.remote"]),
        "origin"
    );
    assert_eq!(
        alice.git(&["config", "branch.feat/squashed.merge"]),
        "refs/heads/feat/squashed"
    );
    // Undoing the whole prune skips the branch that was never deleted.
    assert_eq!(
        run(
            &alice,
            Action::RestoreBranches {
                branches: tips.clone()
            }
        )
        .unwrap(),
        "Nothing to restore: the branches are all there"
    );
    // Restoring over a branch that has since moved is refused.
    alice.git(&["branch", "--force", "feat/local", "main~1"]);
    assert!(
        run(
            &alice,
            Action::RestoreBranches {
                branches: tips[2..].to_vec()
            }
        )
        .is_err()
    );
}

/// Deleting, resetting, rebasing and force-pushing keep a backup of where the branch was
/// (out of the graph), which can be put back without overwriting anything; deleting says
/// what would be lost; deleting from the remote can be undone.
#[test]
fn keeps_backups_of_changed_branches_and_restores_them() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("backup-remote.git");
    let mut alice = TempRepo::new("backup-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    let first = alice.commit("a.txt", "First");
    alice.git(&["push", "--quiet", "-u", "origin", "main"]);
    alice.git(&["switch", "--quiet", "-c", "feat/x"]);
    let x = alice.commit("x.txt", "X work");
    alice.git(&["switch", "--quiet", "main"]);

    // What deleting would lose: feat/x's own commit; nothing for main, which is on origin.
    let lost = actions::lost_commits(alice.path(), "refs/heads/feat/x").unwrap();
    assert_eq!(lost.count, 1);
    assert_eq!(
        (
            lost.commits[0].id.as_str(),
            lost.commits[0].summary.as_str()
        ),
        (x.as_str(), "X work")
    );
    assert_eq!(
        actions::lost_commits(alice.path(), "refs/heads/main")
            .unwrap()
            .count,
        0
    );

    // Deleting keeps a backup, which isn't drawn in the graph and can be restored.
    run(
        &alice,
        Action::DeleteBranch {
            name: "feat/x".into(),
            force: true,
        },
    )
    .unwrap();
    let snapshot = repo::load(alice.path(), 100, false).unwrap();
    assert!(
        snapshot.commits.iter().all(|c| c.id != x),
        "backups stay out of the graph"
    );
    let backups = actions::backups(alice.path()).unwrap();
    assert_eq!(backups.len(), 1);
    let deleted = &backups[0];
    assert_eq!(
        (
            deleted.event,
            deleted.name.as_str(),
            deleted.remote,
            deleted.id.as_str()
        ),
        (BackupEvent::Deleted, "feat/x", false, x.as_str())
    );
    assert_eq!(
        (deleted.summary.as_str(), deleted.current.as_deref()),
        ("X work", None)
    );
    assert_eq!(
        restore(&alice, &deleted.reference).unwrap(),
        "Restored feat/x"
    );
    assert_eq!(alice.git(&["rev-parse", "feat/x"]), x);
    assert_eq!(
        restore(&alice, &deleted.reference).unwrap(),
        "feat/x is already there, as it was"
    );

    // A hard reset keeps the old tip; restoring puts it beside the moved branch.
    let second = alice.commit("b.txt", "Second");
    run(&alice, Action::ResetHard { id: first.clone() }).unwrap();
    let reset = find_backup(&alice, BackupEvent::Reset);
    assert_eq!(
        (
            reset.name.as_str(),
            reset.id.as_str(),
            reset.current.as_deref()
        ),
        ("main", second.as_str(), Some(first.as_str()))
    );
    assert_eq!(
        restore(&alice, &reset.reference).unwrap(),
        "main has changed since, so its earlier version is now the branch main-restored"
    );
    assert_eq!(alice.git(&["rev-parse", "main-restored"]), second);

    // A force push keeps what it replaced on the remote.
    alice.git(&["push", "--quiet", "origin", "main-restored:main"]);
    alice.git(&["fetch", "--quiet"]);
    run(&alice, Action::Push { force: true }).unwrap();
    assert_eq!(remote.git(&["rev-parse", "main"]), first);
    let pushed = find_backup(&alice, BackupEvent::ForcePushed);
    assert_eq!(
        (pushed.name.as_str(), pushed.remote, pushed.id.as_str()),
        ("origin/main", true, second.as_str())
    );
    assert_eq!(
        restore(&alice, &pushed.reference).unwrap(),
        "The earlier version of origin/main is now the local branch main-before-force-push"
    );
    assert_eq!(alice.git(&["rev-parse", "main-before-force-push"]), second);

    // A rebase keeps the branch's old tip.
    alice.git(&["switch", "--quiet", "-c", "feat/y"]);
    let y = alice.commit("y.txt", "Y work");
    alice.git(&["switch", "--quiet", "main"]);
    alice.commit("c.txt", "Third");
    alice.git(&["switch", "--quiet", "feat/y"]);
    run(
        &alice,
        Action::Rebase {
            onto: "main".into(),
        },
    )
    .unwrap();
    let rebased = find_backup(&alice, BackupEvent::Rebased);
    assert_eq!(
        (rebased.name.as_str(), rebased.id.as_str()),
        ("feat/y", y.as_str())
    );

    // Deleting from the remote: undo pushes it back, and so does its backup.
    alice.git(&["push", "--quiet", "origin", "feat/x"]);
    alice.git(&["fetch", "--quiet"]);
    assert_eq!(
        actions::lost_commits(alice.path(), "refs/remotes/origin/feat/x")
            .unwrap()
            .count,
        0,
        "feat/x is still a local branch"
    );
    run(
        &alice,
        Action::DeleteRemoteBranch {
            name: "origin/feat/x".into(),
        },
    )
    .unwrap();
    assert_eq!(
        run(
            &alice,
            Action::RestoreRemoteBranch {
                name: "origin/feat/x".into(),
                id: x.clone()
            }
        )
        .unwrap(),
        "Pushed feat/x back to origin"
    );
    assert_eq!(remote.git(&["rev-parse", "feat/x"]), x);
    run(
        &alice,
        Action::DeleteRemoteBranch {
            name: "origin/feat/x".into(),
        },
    )
    .unwrap();
    let from_remote = find_backup(&alice, BackupEvent::DeletedFromRemote);
    assert_eq!(
        restore(&alice, &from_remote.reference).unwrap(),
        "Pushed feat/x back to origin"
    );
    assert_eq!(remote.git(&["rev-parse", "feat/x"]), x);

    // Backups can be removed.
    let count = actions::backups(alice.path()).unwrap().len();
    run(
        &alice,
        Action::RemoveBackup {
            reference: from_remote.reference,
        },
    )
    .unwrap();
    assert_eq!(actions::backups(alice.path()).unwrap().len(), count - 1);
}

#[test]
fn creates_pushes_deletes_and_restores_tags() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("tags-remote.git");
    let mut repo = TempRepo::new("tags");
    with_identity(&repo);
    repo.git(&["remote", "add", "origin", remote.url()]);
    let first = repo.commit("a.txt", "First");
    let second = repo.commit("b.txt", "Second");

    run(
        &repo,
        Action::CreateTag {
            name: "v1".into(),
            id: first.clone(),
            message: None,
        },
    )
    .unwrap();
    run(
        &repo,
        Action::CreateTag {
            name: "v2".into(),
            id: second.clone(),
            message: Some("Release two".into()),
        },
    )
    .unwrap();
    assert_eq!(repo.git(&["rev-parse", "v1^{commit}"]), first);
    assert_eq!(repo.git(&["cat-file", "-t", "v2"]), "tag");
    for (name, error) in [
        ("v1", "already exists"),
        ("bad name", "isn't a valid"),
        ("-x", "isn't a valid"),
    ] {
        let result = run(
            &repo,
            Action::CreateTag {
                name: name.into(),
                id: first.clone(),
                message: None,
            },
        );
        assert!(result.unwrap_err().contains(error), "{name}");
    }

    let snapshot = repo::load(repo.path(), 100, false).unwrap();
    let v2 = snapshot.commits[0]
        .refs
        .iter()
        .find(|r| r.name == "v2")
        .unwrap();
    let tag_object = v2
        .target
        .clone()
        .expect("annotated tags know their tag object");
    assert_eq!(tag_object, repo.git(&["rev-parse", "v2"]));
    let v1 = snapshot.commits[1]
        .refs
        .iter()
        .find(|r| r.name == "v1")
        .unwrap();
    assert_eq!(v1.target, None);

    run(
        &repo,
        Action::PushTag {
            name: "v2".into(),
            remote: None,
        },
    )
    .unwrap();
    assert_eq!(remote.git(&["tag", "--list"]), "v2");
    run(
        &repo,
        Action::DeleteRemoteTag {
            name: "v2".into(),
            remote: "origin".into(),
        },
    )
    .unwrap();
    assert_eq!(remote.git(&["tag", "--list"]), "");

    run(&repo, Action::DeleteTag { name: "v2".into() }).unwrap();
    assert!(run(&repo, Action::DeleteTag { name: "v2".into() }).is_err());
    run(
        &repo,
        Action::RestoreTag {
            name: "v2".into(),
            id: tag_object.clone(),
        },
    )
    .unwrap();
    assert_eq!(
        repo.git(&["rev-parse", "v2"]),
        tag_object,
        "the same annotated tag is back"
    );
    assert_eq!(
        repo.git(&["tag", "--list", "--format=%(contents:subject)", "v2"]),
        "Release two"
    );
}

fn restore(repo: &TempRepo, reference: &str) -> Result<String, String> {
    run(
        repo,
        Action::RestoreBackup {
            reference: reference.into(),
        },
    )
}

fn find_backup(repo: &TempRepo, event: BackupEvent) -> actions::Backup {
    actions::backups(repo.path())
        .unwrap()
        .into_iter()
        .find(|b| b.event == event)
        .unwrap_or_else(|| panic!("no {event:?} backup"))
}
