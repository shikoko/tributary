//! Uncommitted changes: staging, committing, stashing, discarding and ignoring.

mod common;

use common::{TempRepo, outcome, read, run, stash_count, with_identity};
use tributary_lib::actions::Action;

#[test]
fn stashes_apply_pop_and_drop() {
    let mut repo = TempRepo::new("stash-actions");
    repo.commit("a.txt", "committed");
    std::fs::write(repo.path().join("a.txt"), "changed").unwrap();

    let message = run(
        &repo,
        Action::StashPush {
            message: Some("Half done".into()),
            include_untracked: false,
            paths: vec![],
        },
    )
    .unwrap();
    assert_eq!(message, "Stashed your changes as stash@{0}");
    assert_eq!(read(&repo, "a.txt"), "committed");
    assert!(repo.git(&["stash", "list"]).contains("Half done"));
    let nothing = run(
        &repo,
        Action::StashPush {
            message: None,
            include_untracked: false,
            paths: vec![],
        },
    )
    .unwrap_err();
    assert!(nothing.contains("no changes"), "{nothing}");

    let id = repo.git(&["rev-parse", "stash@{0}"]);
    run(
        &repo,
        Action::StashApply {
            index: 0,
            id: id.clone(),
        },
    )
    .unwrap();
    assert_eq!(read(&repo, "a.txt"), "changed");
    assert_eq!(stash_count(&repo), 1, "apply keeps the stash");

    repo.git(&["checkout", "--", "a.txt"]);
    run(
        &repo,
        Action::StashPop {
            index: 0,
            id: id.clone(),
        },
    )
    .unwrap();
    assert_eq!(read(&repo, "a.txt"), "changed");
    assert_eq!(stash_count(&repo), 0, "pop removes the stash");

    run(
        &repo,
        Action::StashPush {
            message: None,
            include_untracked: false,
            paths: vec![],
        },
    )
    .unwrap();
    let wrong = "0123456789012345678901234567890123456789".to_owned();
    assert!(
        run(
            &repo,
            Action::StashDrop {
                index: 0,
                id: wrong
            }
        )
        .is_err()
    );
    let id = repo.git(&["rev-parse", "stash@{0}"]);
    run(&repo, Action::StashDrop { index: 0, id }).unwrap();
    assert_eq!(stash_count(&repo), 0);
}

#[test]
fn stash_and_retry_puts_changes_back() {
    let mut repo = TempRepo::new("stash-retry");
    repo.commit("a.txt", "one\ntwo\nthree\nfour\nfive\n");
    repo.git(&["branch", "old"]);
    repo.commit("a.txt", "ONE\ntwo\nthree\nfour\nfive\n");
    // An uncommitted edit to a file that differs between the branches.
    std::fs::write(repo.path().join("a.txt"), "ONE\ntwo\nthree\nfour\nFIVE\n").unwrap();

    let refused = run(&repo, Action::CheckoutBranch { name: "old".into() }).unwrap_err();
    assert!(refused.contains("would be overwritten"), "{refused}");

    let message = run(
        &repo,
        Action::StashAndRetry {
            action: Box::new(Action::CheckoutBranch { name: "old".into() }),
            include_untracked: false,
        },
    )
    .unwrap();
    assert_eq!(message, "Checked out old, and put your changes back");
    assert_eq!(repo.git(&["branch", "--show-current"]), "old");
    assert_eq!(read(&repo, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
    assert_eq!(stash_count(&repo), 0);
}

#[test]
fn stash_and_retry_keeps_the_stash_when_changes_conflict() {
    let mut repo = TempRepo::new("stash-retry-conflict");
    repo.commit("a.txt", "one");
    repo.git(&["branch", "old"]);
    repo.commit("a.txt", "two");
    std::fs::write(repo.path().join("a.txt"), "three").unwrap();

    let error = run(
        &repo,
        Action::StashAndRetry {
            action: Box::new(Action::CheckoutBranch { name: "old".into() }),
            include_untracked: false,
        },
    )
    .unwrap_err();
    assert!(error.contains("stash@{0}"), "{error}");
    assert_eq!(repo.git(&["branch", "--show-current"]), "old");
    assert_eq!(stash_count(&repo), 1, "the changes are still saved");
}

#[test]
fn stages_unstages_commits_and_undoes() {
    let mut repo = TempRepo::new("commit");
    with_identity(&repo);
    let first = repo.commit("a.txt", "first");
    std::fs::write(repo.path().join("a.txt"), "changed").unwrap();
    std::fs::write(repo.path().join("b.txt"), "new").unwrap();
    let staged = |repo: &TempRepo| repo.git(&["diff", "--cached", "--name-only"]);

    run(
        &repo,
        Action::Stage {
            paths: vec!["a.txt".into()],
        },
    )
    .unwrap();
    assert_eq!(staged(&repo), "a.txt");
    run(
        &repo,
        Action::Unstage {
            paths: vec!["a.txt".into()],
        },
    )
    .unwrap();
    assert_eq!(staged(&repo), "");
    run(&repo, Action::StageAll).unwrap();
    assert_eq!(staged(&repo), "a.txt\nb.txt");
    run(&repo, Action::UnstageAll).unwrap();
    assert_eq!(staged(&repo), "");
    assert!(run(&repo, Action::Stage { paths: vec![] }).is_err());

    run(&repo, Action::StageAll).unwrap();
    assert!(
        run(
            &repo,
            Action::Commit {
                message: "  ".into(),
                amend: false,
                no_verify: false,
            }
        )
        .is_err()
    );
    let message = run(
        &repo,
        Action::Commit {
            message: "Second\n\nWith a body.".into(),
            amend: false,
            no_verify: false,
        },
    )
    .unwrap();
    assert!(
        message.starts_with("Committed ") && message.ends_with(": Second"),
        "{message}"
    );
    assert_eq!(
        repo.git(&["log", "-1", "--format=%s|%b"]),
        "Second|With a body."
    );

    let message = run(
        &repo,
        Action::Commit {
            message: "Second, amended".into(),
            amend: true,
            no_verify: false,
        },
    )
    .unwrap();
    assert!(message.starts_with("Amended "), "{message}");
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]), "2");
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Second, amended");

    // Undo: the commit goes away, its changes stay staged.
    run(&repo, Action::ResetSoft { id: first.clone() }).unwrap();
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);
    assert_eq!(staged(&repo), "a.txt\nb.txt");
}

#[test]
fn unstages_before_the_first_commit() {
    let repo = TempRepo::new("unborn");
    std::fs::write(repo.path().join("a.txt"), "new").unwrap();
    run(
        &repo,
        Action::Stage {
            paths: vec!["a.txt".into()],
        },
    )
    .unwrap();
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "a.txt");
    run(
        &repo,
        Action::Unstage {
            paths: vec!["a.txt".into()],
        },
    )
    .unwrap();
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
    run(&repo, Action::StageAll).unwrap();
    run(&repo, Action::UnstageAll).unwrap();
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
}

#[test]
fn discards_files_and_puts_them_back() {
    let mut repo = TempRepo::new("discard");
    with_identity(&repo);
    repo.commit("a.txt", "original");
    repo.commit("keep.txt", "keep");
    std::fs::write(repo.path().join("a.txt"), "edited").unwrap();
    std::fs::write(repo.path().join("keep.txt"), "also edited").unwrap();
    std::fs::write(repo.path().join("new.log"), "new").unwrap();

    let discarded = outcome(
        &repo,
        Action::DiscardFiles {
            paths: vec!["a.txt".into(), "new.log".into()],
        },
    );
    assert_eq!(discarded.message, "Discarded the changes to 2 files");
    assert_eq!(read(&repo, "a.txt"), "original");
    assert!(!repo.path().join("new.log").exists());
    // Other changes stay, and the stash list isn't touched.
    assert_eq!(read(&repo, "keep.txt"), "also edited");
    assert_eq!(stash_count(&repo), 0);

    let reference = discarded.backup.expect("kept for undo");
    assert!(reference.starts_with("refs/tributary/discarded/"));
    assert_eq!(
        run(
            &repo,
            Action::RestoreDiscarded {
                reference: reference.clone()
            }
        )
        .unwrap(),
        "Put the discarded changes back"
    );
    assert_eq!(read(&repo, "a.txt"), "edited");
    assert_eq!(read(&repo, "new.log"), "new");
    assert!(run(&repo, Action::RestoreDiscarded { reference }).is_err());
    assert!(
        run(
            &repo,
            Action::DiscardFiles {
                paths: vec!["unchanged.txt".into()]
            }
        )
        .is_err()
    );
}

#[test]
fn discards_everything_and_puts_it_back() {
    let mut repo = TempRepo::new("discard-all");
    with_identity(&repo);
    repo.commit(".gitignore", "*.tmp\n");
    repo.commit("a.txt", "original");
    std::fs::write(repo.path().join("a.txt"), "edited").unwrap();
    std::fs::write(repo.path().join("staged.txt"), "staged").unwrap();
    repo.git(&["add", "staged.txt"]);
    std::fs::write(repo.path().join("new.log"), "new").unwrap();
    std::fs::create_dir_all(repo.path().join("Art/Props")).unwrap();
    std::fs::write(repo.path().join("Art/Props/crate.uasset"), "art").unwrap();
    std::fs::write(repo.path().join("cache.tmp"), "ignored").unwrap();

    let discarded = outcome(&repo, Action::DiscardAll);
    assert_eq!(discarded.message, "Discarded all uncommitted changes");
    assert_eq!(read(&repo, "a.txt"), "original");
    // New files go, staged or not, folders and all; ignored ones stay.
    assert!(!repo.path().join("staged.txt").exists());
    assert!(!repo.path().join("new.log").exists());
    assert!(!repo.path().join("Art").exists());
    assert_eq!(read(&repo, "cache.tmp"), "ignored");
    assert_eq!(
        repo.git(&["status", "--porcelain", "--untracked-files=all"]),
        ""
    );
    assert_eq!(stash_count(&repo), 0);

    let reference = discarded.backup.expect("kept for undo");
    run(&repo, Action::RestoreDiscarded { reference }).unwrap();
    assert_eq!(read(&repo, "a.txt"), "edited");
    assert_eq!(read(&repo, "new.log"), "new");
    assert_eq!(read(&repo, "Art/Props/crate.uasset"), "art");
    // Staged again, as it was.
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "staged.txt");

    run(&repo, Action::DiscardAll).unwrap();
    assert!(run(&repo, Action::DiscardAll).is_err());
}

#[test]
fn ignores_files_and_stops_ignoring_them() {
    let mut repo = TempRepo::new("ignore");
    repo.commit("a.txt", "First");
    std::fs::write(repo.path().join("debug.log"), "noise").unwrap();
    std::fs::create_dir_all(repo.path().join("Saved")).unwrap();
    std::fs::write(repo.path().join("Saved/autosave.uasset"), "noise").unwrap();
    let untracked = |repo: &TempRepo| repo.git(&["status", "--porcelain", "--untracked-files=all"]);
    assert!(untracked(&repo).contains("debug.log"));

    run(
        &repo,
        Action::IgnorePaths {
            patterns: vec!["*.log".into(), "Saved/".into()],
        },
    )
    .unwrap();
    assert_eq!(read(&repo, ".gitignore"), "*.log\nSaved/\n");
    assert_eq!(untracked(&repo), "?? .gitignore");
    // Already there: not added twice.
    run(
        &repo,
        Action::IgnorePaths {
            patterns: vec!["*.log".into()],
        },
    )
    .unwrap();
    assert_eq!(read(&repo, ".gitignore"), "*.log\nSaved/\n");

    run(
        &repo,
        Action::UnignorePaths {
            patterns: vec!["*.log".into(), "Saved/".into()],
        },
    )
    .unwrap();
    assert!(!repo.path().join(".gitignore").exists());
}

#[test]
fn stashes_only_the_chosen_files() {
    let mut repo = TempRepo::new("stash-files");
    repo.commit("a.txt", "a");
    repo.commit("b.txt", "b");
    std::fs::write(repo.path().join("a.txt"), "a edited").unwrap();
    std::fs::write(repo.path().join("b.txt"), "b edited").unwrap();
    assert_eq!(
        run(
            &repo,
            Action::StashPush {
                message: None,
                include_untracked: false,
                paths: vec!["a.txt".into()],
            },
        )
        .unwrap(),
        "Stashed a.txt as stash@{0}"
    );
    assert_eq!(read(&repo, "a.txt"), "a");
    assert_eq!(read(&repo, "b.txt"), "b edited");
}

#[test]
fn sets_who_commits_are_made_as_in_one_repository() {
    use tributary_lib::actions::repo_identity;
    let mut repo = TempRepo::new("identity");
    repo.commit("a.txt", "a");
    // Nothing set for this repository yet (the usual identity is whatever this computer has).
    assert_eq!(repo_identity(repo.path()).unwrap().local_name, None);

    let set = Action::SetIdentity {
        name: "Maya Chen".into(),
        email: "maya@work.example.com".into(),
    };
    assert_eq!(
        run(&repo, set).unwrap(),
        "Commits here are made as Maya Chen <maya@work.example.com>"
    );
    let here = repo_identity(repo.path()).unwrap();
    assert_eq!(here.local_name.as_deref(), Some("Maya Chen"));
    assert_eq!(here.local_email.as_deref(), Some("maya@work.example.com"));
    repo.git(&["commit", "--quiet", "--allow-empty", "-m", "As Maya"]);

    // Half an identity, or a bad address, isn't taken.
    let half = Action::SetIdentity {
        name: "Maya".into(),
        email: String::new(),
    };
    assert!(run(&repo, half).is_err());
    let bad = Action::SetIdentity {
        name: "Maya".into(),
        email: "not an address".into(),
    };
    assert!(run(&repo, bad).is_err());

    // Both empty: back to the usual one (twice is fine).
    for _ in 0..2 {
        let reset = Action::SetIdentity {
            name: String::new(),
            email: String::new(),
        };
        run(&repo, reset).unwrap();
    }
    assert_eq!(repo_identity(repo.path()).unwrap().local_email, None);
}

#[test]
fn stages_and_unstages_thousands_of_files_at_once() {
    let mut repo = TempRepo::new("stage-many");
    repo.commit("a.txt", "a");
    std::fs::create_dir_all(repo.path().join("Content/Generated/Level01")).unwrap();
    let paths: Vec<String> = (0..3000)
        .map(|i| {
            format!("Content/Generated/Level01/Instance_{i:05}_LongerNameForTheCommandLine.txt")
        })
        .collect();
    for path in &paths {
        std::fs::write(repo.path().join(path), "x").unwrap();
    }
    // Over 200,000 characters of paths: more than one command line takes.
    assert_eq!(
        run(
            &repo,
            Action::Stage {
                paths: paths.clone()
            }
        )
        .unwrap(),
        "Staged 3,000 files"
    );
    assert_eq!(
        repo.git(&["diff", "--cached", "--name-only"])
            .lines()
            .count(),
        3000
    );
    run(&repo, Action::Unstage { paths }).unwrap();
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
}

#[test]
fn flags_new_file_names_windows_and_macos_cannot_have() {
    use tributary_lib::actions::Problem;
    let mut repo = TempRepo::new("file-names");
    with_identity(&repo);
    std::fs::create_dir_all(repo.path().join("Content/Maps")).unwrap();
    repo.commit("Content/Maps/Arena.umap", "arena");
    repo.commit("README.md", "readme");
    // Already committed: not news.
    std::fs::write(repo.path().join("README.md"), "changed").unwrap();
    std::fs::create_dir_all(repo.path().join("Content/maps")).unwrap();
    std::fs::write(repo.path().join("Content/maps/Tavern.umap"), "tavern").unwrap();
    std::fs::write(repo.path().join("readme.md"), "another").unwrap();
    std::fs::write(repo.path().join("aux.txt"), "aux").unwrap();
    std::fs::write(repo.path().join("Content/Maps/Fine.umap"), "fine").unwrap();
    // Where capitals don't matter, Tavern.umap went into Content/Maps, and git lists it
    // there, so name the file as it would be on Linux. (There, git lists the new folder.)
    let tavern = if common::ignores_case(repo.path()) {
        "Content/maps/Tavern.umap"
    } else {
        "Content/maps/"
    };

    let changed: Vec<String> = [
        "README.md",
        tavern,
        "readme.md",
        "aux.txt",
        "Content/Maps/Fine.umap",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let checks =
        tributary_lib::actions::file_checks(repo.path(), &changed, &[], 1_000_000).unwrap();
    let found: Vec<(&str, Problem, &str)> = checks
        .names
        .iter()
        .map(|n| (n.path.as_str(), n.problem, n.detail.as_str()))
        .collect();
    assert_eq!(
        found,
        vec![
            (
                "Content/maps/Tavern.umap",
                Problem::CaseClash,
                "Content/Maps"
            ),
            ("aux.txt", Problem::Reserved, "aux.txt"),
            ("readme.md", Problem::CaseClash, "README.md"),
        ]
    );
}

#[test]
fn says_why_a_file_is_ignored_and_stages_it_anyway() {
    let mut repo = TempRepo::new("ignored");
    with_identity(&repo);
    repo.commit(".gitignore", "*.tmp\nSaved/\n");
    std::fs::create_dir_all(repo.path().join("Saved/Logs")).unwrap();
    std::fs::write(repo.path().join("Saved/Logs/editor.log"), "log").unwrap();
    std::fs::write(repo.path().join("keep.txt"), "kept").unwrap();

    let absolute = repo.path().join("Saved/Logs/editor.log");
    let reason =
        tributary_lib::actions::ignore_reason(repo.path(), &absolute.to_string_lossy()).unwrap();
    assert_eq!(reason.path, "Saved/Logs/editor.log");
    let rule = reason.rule.unwrap();
    assert_eq!(
        (rule.source.as_str(), rule.line, rule.pattern.as_str()),
        (".gitignore", 2, "Saved/")
    );
    assert!(
        tributary_lib::actions::ignore_reason(repo.path(), "keep.txt")
            .unwrap()
            .rule
            .is_none()
    );

    run(
        &repo,
        Action::StageIgnored {
            paths: vec!["Saved/Logs/editor.log".into()],
        },
    )
    .unwrap();
    assert_eq!(
        repo.git(&["diff", "--cached", "--name-only"]),
        "Saved/Logs/editor.log"
    );
    assert!(
        tributary_lib::actions::ignore_reason(repo.path(), "Saved/Logs/editor.log")
            .unwrap()
            .tracked
    );
}

#[cfg(unix)]
#[test]
fn says_when_a_hook_stops_a_commit_and_commits_without_it() {
    use std::os::unix::fs::PermissionsExt;
    let mut repo = TempRepo::new("hooks");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    let hook = repo.path().join(".git/hooks/pre-commit");
    std::fs::create_dir_all(hook.parent().unwrap()).unwrap();
    std::fs::write(
        &hook,
        "#!/bin/sh\necho 'lint: 2 problems in a.txt'\nexit 1\n",
    )
    .unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::write(repo.path().join("a.txt"), "changed").unwrap();
    repo.git(&["add", "a.txt"]);

    let commit = |no_verify| Action::Commit {
        message: "Change a".into(),
        amend: false,
        no_verify,
    };
    let error = run(&repo, commit(false)).unwrap_err();
    assert!(
        error.starts_with("The pre-commit hook stopped the commit."),
        "{error}"
    );
    assert!(error.contains("lint: 2 problems in a.txt"), "{error}");
    let message = run(&repo, commit(true)).unwrap();
    assert!(message.starts_with("Committed "), "{message}");
}
