//! Linked working trees: adding them for existing and new branches, listing them from
//! any of them, and removing and pruning them.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{TempRepo, run};
use tributary_lib::actions::Action;
use tributary_lib::repo;

fn add(
    repo: &TempRepo,
    path: &std::path::Path,
    branch: &str,
    start: Option<&str>,
) -> Result<String, String> {
    run(
        repo,
        Action::AddWorktree {
            path: path.display().to_string(),
            branch: branch.into(),
            create: start.is_some(),
            start: start.map(Into::into),
        },
    )
}

#[test]
fn adds_lists_and_removes_worktrees() {
    let mut main = TempRepo::new("worktrees-main");
    let first = main.commit("a.txt", "First");
    main.git(&["branch", "feat"]);
    let place = TempRepo::empty("worktrees-place");
    let feat = place.path().join("feat");
    let fix = place.path().join("fix");

    assert_eq!(
        add(&main, &feat, "feat", None).unwrap(),
        "Checked out feat in a new worktree"
    );
    assert!(feat.join("a.txt").exists());
    let err = add(&main, &place.path().join("again"), "main", None).unwrap_err();
    assert!(err.contains("already checked out"), "{err}");
    assert!(add(&main, &place.path().join("nope"), "missing", None).is_err());
    assert_eq!(
        add(&main, &fix, "fix", Some(&first)).unwrap(),
        "Made the branch fix in a new worktree"
    );
    assert!(
        add(&main, &fix, "other", Some(&first))
            .unwrap_err()
            .contains("isn't empty")
    );

    let list = repo::worktrees(main.path()).unwrap();
    let names: Vec<_> = list
        .iter()
        .map(|w| (w.branch.as_deref(), w.main, w.current))
        .collect();
    assert_eq!(
        names,
        vec![
            (Some("main"), true, true),
            (Some("feat"), false, false),
            (Some("fix"), false, false)
        ]
    );
    // Seen from a linked one, that one is current.
    let from_feat = repo::worktrees(&feat).unwrap();
    assert!(
        from_feat
            .iter()
            .find(|w| w.branch.as_deref() == Some("feat"))
            .unwrap()
            .current
    );
    assert!(!from_feat[0].current);

    // Uncommitted changes keep it, unless forced.
    std::fs::write(feat.join("a.txt"), "changed").unwrap();
    let remove = |force| Action::RemoveWorktree {
        path: feat.display().to_string(),
        force,
    };
    assert!(
        run(&main, remove(false))
            .unwrap_err()
            .contains("uncommitted changes")
    );
    assert_eq!(
        run(&main, remove(true)).unwrap(),
        "Removed the worktree of feat"
    );
    assert!(!feat.exists());
    let main_path = main.path().display().to_string();
    assert!(
        run(
            &main,
            Action::RemoveWorktree {
                path: main_path,
                force: true
            }
        )
        .is_err()
    );

    // A worktree whose folder was deleted by hand is pruned.
    std::fs::remove_dir_all(&fix).unwrap();
    assert!(
        repo::worktrees(main.path())
            .unwrap()
            .iter()
            .any(|w| w.prunable)
    );
    run(&main, Action::PruneWorktrees).unwrap();
    assert_eq!(repo::worktrees(main.path()).unwrap().len(), 1);
}
