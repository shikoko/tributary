//! Merging, rebasing, cherry-picking and reverting, and resolving their conflicts.

mod common;

use common::{TempRepo, files, head, parents, read, run, with_identity};
use tributary_lib::actions::{Action, MergeMode, Side};
use tributary_lib::repo::{FileStatus, OperationKind};
use tributary_lib::{actions, repo};

#[test]
fn merges_branches() {
    let mut repo = TempRepo::new("merge-action");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("b.txt", "feature work");
    repo.git(&["switch", "--quiet", "main"]);
    repo.commit("c.txt", "main work");

    let message = run(
        &repo,
        Action::Merge {
            target: "feature".into(),
            mode: MergeMode::Default,
        },
    )
    .unwrap();
    assert_eq!(message, "Merged feature into main");
    assert_eq!(parents(&repo, "HEAD"), 2);
    assert!(repo.path().join("b.txt").exists());
    assert!(
        run(
            &repo,
            Action::Merge {
                target: "--abort".into(),
                mode: MergeMode::Default
            }
        )
        .is_err()
    );
    assert!(
        run(
            &repo,
            Action::Merge {
                target: "missing".into(),
                mode: MergeMode::Default
            }
        )
        .is_err()
    );
}

#[test]
fn stops_a_merge_on_conflicts_then_continues_or_aborts() {
    let mut repo = TempRepo::new("merge-conflict");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("a.txt", "feature");
    repo.git(&["switch", "--quiet", "main"]);
    let before = repo.commit("a.txt", "main");

    let error = run(
        &repo,
        Action::Merge {
            target: "feature".into(),
            mode: MergeMode::Default,
        },
    )
    .unwrap_err();
    assert!(error.contains("CONFLICT"), "{error}");
    let snapshot = repo::load(repo.path(), 100, true).unwrap();
    let operation = snapshot.operation.unwrap();
    assert_eq!(operation.kind, OperationKind::Merge);
    assert!(
        operation
            .message
            .unwrap()
            .starts_with("Merge branch 'feature'")
    );
    let unstaged = snapshot.worktree.unwrap().unstaged;
    assert_eq!(files(&unstaged), vec![("a.txt", FileStatus::Conflicted)]);

    // Resolve, stage, and finish the merge.
    std::fs::write(repo.path().join("a.txt"), "resolved").unwrap();
    run(
        &repo,
        Action::Stage {
            paths: vec!["a.txt".into()],
        },
    )
    .unwrap();
    assert_eq!(
        run(&repo, Action::ContinueOperation).unwrap(),
        "Finished the merge"
    );
    assert_eq!(parents(&repo, "HEAD"), 2);
    assert!(
        repo::load(repo.path(), 100, false)
            .unwrap()
            .operation
            .is_none()
    );

    // The same conflict again, but abort this time.
    repo.git(&["reset", "--quiet", "--hard", &before]);
    run(
        &repo,
        Action::Merge {
            target: "feature".into(),
            mode: MergeMode::Default,
        },
    )
    .unwrap_err();
    assert_eq!(
        run(&repo, Action::AbortOperation).unwrap(),
        "Aborted the merge"
    );
    assert_eq!(head(&repo), before);
    assert!(
        repo::load(repo.path(), 100, false)
            .unwrap()
            .operation
            .is_none()
    );
    assert!(
        run(&repo, Action::AbortOperation).is_err(),
        "nothing left to abort"
    );
}

#[test]
fn rebases_and_handles_conflicts() {
    let mut repo = TempRepo::new("rebase");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("b.txt", "feature work");
    repo.git(&["switch", "--quiet", "main"]);
    let main = repo.commit("c.txt", "main work");
    repo.git(&["switch", "--quiet", "feature"]);

    assert_eq!(
        run(
            &repo,
            Action::Rebase {
                onto: "main".into()
            }
        )
        .unwrap(),
        "Rebased feature onto main"
    );
    assert_eq!(repo.git(&["rev-parse", "HEAD~1"]), main);

    // A conflicting commit: abort puts everything back, skip leaves the commit out.
    repo.commit("c.txt", "feature changes c too");
    repo.git(&["switch", "--quiet", "main"]);
    let main = repo.commit("c.txt", "main changes c");
    repo.git(&["switch", "--quiet", "feature"]);
    let before = head(&repo);
    run(
        &repo,
        Action::Rebase {
            onto: "main".into(),
        },
    )
    .unwrap_err();
    let snapshot = repo::load(repo.path(), 100, false).unwrap();
    let operation = snapshot.operation.unwrap();
    assert_eq!(operation.kind, OperationKind::Rebase);
    assert_eq!(operation.branch.as_deref(), Some("feature"));
    run(&repo, Action::AbortOperation).unwrap();
    assert_eq!(head(&repo), before);

    run(
        &repo,
        Action::Rebase {
            onto: "main".into(),
        },
    )
    .unwrap_err();
    run(&repo, Action::SkipCommit).unwrap();
    assert!(
        repo::load(repo.path(), 100, false)
            .unwrap()
            .operation
            .is_none()
    );
    assert_eq!(
        repo.git(&["rev-parse", "HEAD~1"]),
        main,
        "the other commit was kept"
    );
}

#[test]
fn cherry_picks_and_reverts() {
    let mut repo = TempRepo::new("pick-revert");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    let picked = repo.commit("b.txt", "Add b");
    repo.git(&["switch", "--quiet", "main"]);

    let message = run(&repo, Action::CherryPick { id: picked.clone() }).unwrap();
    assert_eq!(message, format!("Cherry-picked {} onto main", &picked[..7]));
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Add b");
    assert!(repo.path().join("b.txt").exists());

    let added = head(&repo);
    run(&repo, Action::Revert { id: added }).unwrap();
    assert!(
        repo.git(&["log", "-1", "--format=%s"])
            .starts_with("Revert \"Add b\"")
    );
    assert!(!repo.path().join("b.txt").exists());

    // Reverting a merge commit works too (against its first parent).
    repo.git(&["merge", "--quiet", "--no-ff", "--no-edit", "feature"]);
    let merge = head(&repo);
    run(&repo, Action::Revert { id: merge }).unwrap();
    assert!(!repo.path().join("b.txt").exists());
}

#[test]
fn cherry_picks_and_reverts_several_commits() {
    let mut repo = TempRepo::new("multi-pick");
    with_identity(&repo);
    repo.commit("base.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    let one = repo.commit("notes.txt", "one");
    let two = repo.commit("notes.txt", "one\ntwo");
    repo.git(&["switch", "--quiet", "main"]);

    let message = run(
        &repo,
        Action::CherryPickMany {
            ids: vec![one.clone(), two.clone()],
        },
    )
    .unwrap();
    assert_eq!(message, "Cherry-picked 2 commits onto main");
    assert_eq!(read(&repo, "notes.txt"), "one\ntwo");
    // In order: the second one builds on the first. (git joins a two-line subject.)
    assert_eq!(repo.git(&["log", "-2", "--format=%s"]), "one two\none");

    let picked_two = head(&repo);
    let picked_one = repo.git(&["rev-parse", "HEAD~1"]);
    run(
        &repo,
        Action::RevertMany {
            ids: vec![picked_two, picked_one],
        },
    )
    .unwrap();
    assert!(!repo.path().join("notes.txt").exists());

    let twice = run(
        &repo,
        Action::CherryPickMany {
            ids: vec![one.clone(), one],
        },
    );
    assert!(twice.unwrap_err().contains("twice"));
}

#[test]
fn rewrites_history_interactively() {
    use actions::{RebaseStep, StepAction};
    let mut repo = TempRepo::new("interactive");
    with_identity(&repo);
    let base = repo.commit("base.txt", "base");
    let a = repo.commit("a.txt", "Add a");
    let b = repo.commit("b.txt", "Add b");
    let c = repo.commit("c.txt", "Add c");
    let d = repo.commit("d.txt", "Add d");
    let e = repo.commit("e.txt", "Add e");
    let f = repo.commit("f.txt", "Add f");
    let step = |id: &str, action: StepAction| RebaseStep {
        id: id.to_owned(),
        action,
        message: None,
    };

    let missing = run(
        &repo,
        Action::InteractiveRebase {
            onto: base.clone(),
            steps: vec![step(&a, StepAction::Pick)],
        },
    );
    assert!(missing.unwrap_err().contains("changed"));
    let squash_first = run(
        &repo,
        Action::InteractiveRebase {
            onto: d.clone(),
            steps: vec![step(&e, StepAction::Squash), step(&f, StepAction::Pick)],
        },
    );
    assert!(squash_first.unwrap_err().contains("oldest"));

    let steps = vec![
        step(&b, StepAction::Pick),
        step(&a, StepAction::Pick),
        RebaseStep {
            id: c.clone(),
            action: StepAction::Reword,
            message: Some("Add c, reworded\n\nWith a body.".into()),
        },
        step(&d, StepAction::Fixup),
        step(&e, StepAction::Squash),
        step(&f, StepAction::Drop),
    ];
    let message = run(
        &repo,
        Action::InteractiveRebase {
            onto: base.clone(),
            steps,
        },
    )
    .unwrap();
    assert_eq!(message, "Rewrote main's history");
    assert_eq!(
        repo.git(&["log", "--format=%s", &format!("{base}..HEAD")]),
        "Add c, reworded\nAdd a\nAdd b"
    );
    let combined = repo.git(&["log", "-1", "--format=%B"]);
    assert!(combined.contains("With a body."), "{combined}");
    assert!(
        combined.contains("Add e"),
        "squash keeps both messages: {combined}"
    );
    assert!(
        !combined.contains("Add d"),
        "fixup drops its message: {combined}"
    );
    assert!(!combined.contains('#'), "no comment lines: {combined}");
    for file in ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"] {
        assert!(repo.path().join(file).exists(), "{file}");
    }
    assert!(!repo.path().join("f.txt").exists(), "dropped");
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
    assert!(
        !repo.path().join(".git/tributary-rebase").exists(),
        "cleaned up"
    );

    // History with merges is left alone.
    repo.git(&["switch", "--quiet", "--create", "side"]);
    let side = repo.commit("side.txt", "side");
    repo.git(&["switch", "--quiet", "main"]);
    repo.commit("main.txt", "main");
    repo.git(&["merge", "--quiet", "--no-edit", "side"]);
    let ids = repo.git(&["rev-list", &format!("{base}..HEAD")]);
    let steps = ids
        .lines()
        .rev()
        .map(|id| step(id, StepAction::Pick))
        .collect();
    let merges = run(&repo, Action::InteractiveRebase { onto: base, steps });
    assert!(merges.unwrap_err().contains("merges"), "{side}");
}

#[test]
fn resolves_conflicts_by_keeping_one_side() {
    let mut repo = TempRepo::new("resolve");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    // An asset both sides changed, and a file main deleted while the feature changed it.
    std::fs::write(repo.path().join("hero.uasset"), [0u8, 1, 2, 3]).unwrap();
    std::fs::write(repo.path().join("gone.txt"), "base").unwrap();
    repo.git(&["add", "."]);
    repo.git(&["commit", "--quiet", "-m", "Assets"]);
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    std::fs::write(repo.path().join("a.txt"), "feature").unwrap();
    std::fs::write(repo.path().join("hero.uasset"), [0u8, 9, 9, 9]).unwrap();
    std::fs::write(repo.path().join("gone.txt"), "feature edit").unwrap();
    repo.git(&["commit", "--quiet", "-am", "Feature edits"]);
    repo.git(&["switch", "--quiet", "main"]);
    std::fs::write(repo.path().join("a.txt"), "main").unwrap();
    std::fs::write(repo.path().join("hero.uasset"), [0u8, 5, 5, 5]).unwrap();
    repo.git(&["rm", "--quiet", "gone.txt"]);
    repo.git(&["commit", "--quiet", "-am", "Main edits"]);

    run(
        &repo,
        Action::Merge {
            target: "feature".into(),
            mode: MergeMode::Default,
        },
    )
    .unwrap_err();
    let operation = repo::load(repo.path(), 100, false)
        .unwrap()
        .operation
        .unwrap();
    assert_eq!(operation.mine.as_deref(), Some("main"));
    assert_eq!(operation.theirs.as_deref(), Some("feature"));
    // Including the file main deleted, which git leaves in the working tree.
    let status = repo::load(repo.path(), 100, true)
        .unwrap()
        .worktree
        .unwrap();
    assert_eq!(
        files(&status.unstaged),
        vec![
            ("a.txt", FileStatus::Conflicted),
            ("gone.txt", FileStatus::Conflicted),
            ("hero.uasset", FileStatus::Conflicted)
        ]
    );

    let resolve = |paths: &[&str], keep| {
        run(
            &repo,
            Action::ResolveConflicts {
                paths: paths.iter().map(|path| (*path).to_owned()).collect(),
                keep,
            },
        )
    };
    assert_eq!(
        resolve(&["hero.uasset"], Side::Mine).unwrap(),
        "Kept your version of hero.uasset"
    );
    assert_eq!(
        std::fs::read(repo.path().join("hero.uasset")).unwrap(),
        [0u8, 5, 5, 5]
    );
    assert_eq!(
        resolve(&["a.txt"], Side::Theirs).unwrap(),
        "Took their version of a.txt"
    );
    assert_eq!(read(&repo, "a.txt"), "feature");
    // Main deleted gone.txt, so keeping main's version deletes it.
    resolve(&["gone.txt"], Side::Mine).unwrap();
    assert!(!repo.path().join("gone.txt").exists());

    let status = repo::load(repo.path(), 100, true)
        .unwrap()
        .worktree
        .unwrap();
    assert!(
        status
            .unstaged
            .iter()
            .all(|file| file.status != FileStatus::Conflicted),
        "{status:?}"
    );
    assert_eq!(
        resolve(&["a.txt"], Side::Mine).unwrap_err(),
        "a.txt has no conflicts left."
    );

    // Undo puts the conflicts back, deleted file included.
    run(
        &repo,
        Action::RecreateConflicts {
            paths: vec!["a.txt".into(), "hero.uasset".into(), "gone.txt".into()],
        },
    )
    .unwrap();
    let status = repo::load(repo.path(), 100, true)
        .unwrap()
        .worktree
        .unwrap();
    let conflicted: Vec<_> = status
        .unstaged
        .iter()
        .filter(|file| file.status == FileStatus::Conflicted)
        .map(|file| file.path.as_str())
        .collect();
    assert_eq!(conflicted, vec!["a.txt", "gone.txt", "hero.uasset"]);
    assert!(read(&repo, "a.txt").contains("<<<<<<<"));
    resolve(&["a.txt", "hero.uasset", "gone.txt"], Side::Theirs).unwrap();
    assert_eq!(read(&repo, "gone.txt"), "feature edit");
    run(&repo, Action::ContinueOperation).unwrap();
    assert_eq!(parents(&repo, "HEAD"), 2);
}

#[test]
fn keeping_your_version_during_a_rebase_keeps_the_rebased_branch() {
    let mut repo = TempRepo::new("resolve-rebase");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("a.txt", "feature");
    repo.git(&["switch", "--quiet", "main"]);
    let main = repo.commit("a.txt", "main");
    repo.git(&["switch", "--quiet", "feature"]);

    run(
        &repo,
        Action::Rebase {
            onto: "main".into(),
        },
    )
    .unwrap_err();
    let operation = repo::load(repo.path(), 100, false)
        .unwrap()
        .operation
        .unwrap();
    assert_eq!(operation.mine.as_deref(), Some("feature"));
    assert_eq!(operation.theirs.as_deref(), Some("main"));

    // git calls the feature's side "theirs" while rebasing; "yours" is still the feature.
    run(
        &repo,
        Action::ResolveConflicts {
            paths: vec!["a.txt".into()],
            keep: Side::Mine,
        },
    )
    .unwrap();
    assert_eq!(read(&repo, "a.txt"), "feature");
    run(&repo, Action::ContinueOperation).unwrap();
    assert_eq!(repo.git(&["rev-parse", "HEAD^"]), main);
    assert_eq!(repo.git(&["show", "HEAD:a.txt"]), "feature");
}

#[test]
fn merges_with_a_merge_commit_or_squashed() {
    let mut repo = TempRepo::new("merge-modes");
    with_identity(&repo);
    let base = repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("b.txt", "Add the menu");
    repo.commit("c.txt", "Add prices");
    repo.git(&["switch", "--quiet", "main"]);

    // main could fast-forward, but gets a merge commit.
    run(
        &repo,
        Action::Merge {
            target: "feature".into(),
            mode: MergeMode::NoFastForward,
        },
    )
    .unwrap();
    assert_eq!(parents(&repo, "HEAD"), 2);

    repo.git(&["reset", "--quiet", "--hard", &base]);
    let message = run(
        &repo,
        Action::Merge {
            target: "feature".into(),
            mode: MergeMode::Squash,
        },
    )
    .unwrap();
    assert!(
        message.starts_with("Squashed feature into main"),
        "{message}"
    );
    assert_eq!(head(&repo), base, "nothing is committed yet");
    let status = repo::load(repo.path(), 100, true)
        .unwrap()
        .worktree
        .unwrap();
    assert_eq!(
        files(&status.staged),
        vec![("b.txt", FileStatus::Added), ("c.txt", FileStatus::Added)]
    );
    let prepared = std::fs::read_to_string(repo.path().join(".git/SQUASH_MSG")).unwrap();
    assert_eq!(
        prepared,
        "Squash merge feature\n\n- Add the menu\n- Add prices\n"
    );
    let snapshot = repo::load(repo.path(), 100, false).unwrap();
    assert_eq!(
        snapshot.squash_message.as_deref(),
        Some("Squash merge feature\n\n- Add the menu\n- Add prices")
    );
}

#[test]
fn resolves_a_conflict_with_text_worked_out_in_the_app() {
    let mut repo = TempRepo::new("merge-text");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("a.txt", "feature");
    repo.git(&["switch", "--quiet", "main"]);
    repo.commit("a.txt", "main");
    assert!(
        run(
            &repo,
            Action::Merge {
                target: "feature".into(),
                mode: MergeMode::Default,
            },
        )
        .is_err()
    );

    let conflict = actions::conflict_text(repo.path(), "a.txt").unwrap();
    let text = conflict.text.expect("a text file");
    assert!(
        text.contains("<<<<<<< HEAD") && text.contains(">>>>>>> feature"),
        "{text}"
    );

    // Still with markers: refused.
    assert!(
        run(
            &repo,
            Action::ResolveWithText {
                file: "a.txt".into(),
                text: text.clone(),
            },
        )
        .is_err()
    );
    let message = run(
        &repo,
        Action::ResolveWithText {
            file: "a.txt".into(),
            text: "main and feature, together\n".into(),
        },
    )
    .unwrap();
    assert_eq!(message, "Resolved the conflicts in a.txt");
    assert_eq!(read(&repo, "a.txt"), "main and feature, together\n");
    assert!(repo.git(&["ls-files", "--unmerged"]).is_empty());
    // Not conflicted any more: nothing to resolve.
    assert!(
        run(
            &repo,
            Action::ResolveWithText {
                file: "a.txt".into(),
                text: "again\n".into(),
            },
        )
        .is_err()
    );

    // Undo: the conflict comes back.
    run(
        &repo,
        Action::RecreateConflicts {
            paths: vec!["a.txt".into()],
        },
    )
    .unwrap();
    assert!(read(&repo, "a.txt").contains("<<<<<<<"));
}

#[test]
fn fixes_up_an_earlier_commit_with_the_staged_changes() {
    let mut repo = TempRepo::new("fixup");
    with_identity(&repo);
    let root = repo.commit("base.txt", "base");
    let a = repo.commit("a.txt", "Add a");
    repo.commit("b.txt", "Add b");

    let nothing = run(&repo, Action::FixupInto { id: a.clone() });
    assert!(nothing.unwrap_err().contains("Stage"));

    // The fix for a, staged; an unrelated edit to b, not staged.
    std::fs::write(repo.path().join("a.txt"), "a, fixed\n").unwrap();
    std::fs::write(repo.path().join("b.txt"), "b, still working on it\n").unwrap();
    repo.git(&["add", "a.txt"]);
    let message = run(&repo, Action::FixupInto { id: a.clone() }).unwrap();
    assert_eq!(
        message,
        format!("Fixed up {} with your staged changes", &a[..7])
    );
    assert_eq!(
        repo.git(&["log", "--format=%s", &format!("{root}..HEAD")]),
        "Add b\nAdd a",
        "no fixup commit left"
    );
    assert_eq!(repo.git(&["show", "HEAD~1:a.txt"]), "a, fixed");
    assert_eq!(read(&repo, "b.txt"), "b, still working on it\n");
    assert_eq!(repo.git(&["status", "--porcelain"]), "M b.txt");

    // The very first commit can be fixed up too.
    std::fs::write(repo.path().join("base.txt"), "base, fixed\n").unwrap();
    repo.git(&["add", "base.txt"]);
    run(&repo, Action::FixupInto { id: root }).unwrap();
    assert_eq!(repo.git(&["show", "HEAD~2:base.txt"]), "base, fixed");
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]), "3");

    // Not on the checked-out branch: refused.
    repo.git(&["switch", "--quiet", "--create", "side"]);
    let side = repo.commit("side.txt", "side");
    repo.git(&["switch", "--quiet", "main"]);
    repo.git(&["add", "b.txt"]);
    let elsewhere = run(&repo, Action::FixupInto { id: side });
    assert!(elsewhere.unwrap_err().contains("isn't part of"));
}

#[test]
fn bisects_to_the_first_bad_commit() {
    use actions::Verdict;
    let mut repo = TempRepo::new("bisect");
    with_identity(&repo);
    let mut ids = Vec::new();
    for n in 0..9 {
        let state = if n >= 5 { "broken" } else { "ok" };
        std::fs::write(repo.path().join("state.txt"), state).unwrap();
        repo.git(&["add", "state.txt"]);
        ids.push(repo.commit(&format!("file{n}.txt"), &format!("Step {n}")));
    }
    let first_bad = ids[5].clone();

    let backwards = run(
        &repo,
        Action::BisectStart {
            bad: ids[0].clone(),
            good: ids[8].clone(),
        },
    );
    assert!(backwards.unwrap_err().contains("before the bad one"));

    let started = run(
        &repo,
        Action::BisectStart {
            bad: ids[8].clone(),
            good: ids[0].clone(),
        },
    )
    .unwrap();
    assert!(started.starts_with("Bisecting"), "{started}");
    let mut steps = 0;
    let found = loop {
        let snapshot = repo::load(repo.path(), 100, false).unwrap();
        let bisect = snapshot.bisect.expect("bisecting");
        assert_eq!(bisect.start.as_deref(), Some("main"));
        assert!(
            snapshot.operation.is_none(),
            "a bisect isn't an operation to continue or abort"
        );
        if let Some(found) = bisect.found {
            break found;
        }
        let verdict = if read(&repo, "state.txt") == "broken" {
            Verdict::Bad
        } else {
            Verdict::Good
        };
        run(&repo, Action::BisectMark { verdict, id: None }).unwrap();
        steps += 1;
        assert!(steps < 6, "too many steps");
    };
    assert_eq!(found, first_bad);
    assert!(steps <= 4, "{steps} steps for 8 commits");

    let stopped = run(&repo, Action::BisectReset).unwrap();
    assert_eq!(stopped, "Stopped bisecting, back on main");
    let snapshot = repo::load(repo.path(), 100, false).unwrap();
    assert!(snapshot.bisect.is_none());
    assert_eq!(snapshot.head_branch.as_deref(), Some("main"));
}
