//! A remote's remembered branches: a fetch that keeps the work in those the remote no longer
//! has, moving a remote to a new address, and pushing to a remote that lacks them.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{TempRepo, remote_turn, run, with_identity};
use tributary_lib::actions::{self, Action, BackupEvent, PushReason, RememberedChoice};

/// The branch names under `prefix` in `repo`.
fn refs(repo: &TempRepo, prefix: &str) -> Vec<String> {
    let listing = repo.git(&["for-each-ref", "--format=%(refname)", prefix]);
    listing
        .lines()
        .map(|line| line.trim_start_matches(prefix).to_owned())
        .collect()
}

#[test]
fn a_fetch_sets_aside_work_the_remote_no_longer_has_and_forgets_what_it_merged() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("gone-remote.git");
    let mut teammate = TempRepo::new("gone-teammate");
    with_identity(&teammate);
    teammate.git(&["remote", "add", "origin", remote.url()]);
    teammate.commit("a.txt", "First");
    teammate.git(&["push", "--quiet", "-u", "origin", "main"]);
    // merged: merged into main. squashed: its changes squashed into one commit on main.
    // abandoned: never merged.
    for name in ["merged", "squashed", "abandoned"] {
        teammate.git(&["checkout", "--quiet", "-b", name, "main"]);
        teammate.commit(&format!("{name}.txt"), &format!("Work on {name}"));
        teammate.commit(&format!("{name}-2.txt"), &format!("More on {name}"));
        teammate.git(&["push", "--quiet", "origin", name]);
    }
    let mine = TempRepo::clone_of("gone-mine", &remote);
    with_identity(&mine);

    teammate.git(&["checkout", "--quiet", "main"]);
    teammate.git(&[
        "merge",
        "--quiet",
        "--no-ff",
        "-m",
        "Merge merged",
        "merged",
    ]);
    teammate.git(&["merge", "--quiet", "--squash", "squashed"]);
    teammate.git(&["commit", "--quiet", "-m", "Squashed"]);
    teammate.git(&["push", "--quiet", "origin", "main"]);
    for name in ["merged", "squashed", "abandoned"] {
        teammate.git(&["push", "--quiet", "origin", "--delete", name]);
    }

    run(&mine, Action::Fetch { background: false }).unwrap();
    assert_eq!(refs(&mine, "refs/remotes/origin/"), vec!["HEAD", "main"]);
    assert_eq!(
        refs(&mine, "refs/tributary/gone/"),
        vec!["origin/abandoned"],
        "merged and squashed are forgotten, as their work is in main"
    );
    let set_aside = actions::set_aside_branches(mine.path()).unwrap();
    assert_eq!(set_aside.len(), 1);
    assert_eq!(
        (
            set_aside[0].remote.as_str(),
            set_aside[0].name.as_str(),
            set_aside[0].commits
        ),
        ("origin", "abandoned", 2)
    );
    assert_eq!(set_aside[0].summary, "More on abandoned");

    // Kept, it's a branch here, tracking nothing.
    let reference = set_aside[0].reference.clone();
    assert_eq!(
        run(
            &mine,
            Action::KeepRemembered {
                references: vec![reference]
            }
        )
        .unwrap(),
        "Kept a branch here, as abandoned"
    );
    assert_eq!(
        mine.git(&["log", "-1", "--format=%s", "abandoned"]),
        "More on abandoned"
    );
    assert!(refs(&mine, "refs/tributary/gone/").is_empty());
    assert!(actions::set_aside_branches(mine.path()).unwrap().is_empty());

    // Another one, forgotten: it's in Restore.
    teammate.git(&["checkout", "--quiet", "-b", "dropped", "main"]);
    teammate.commit("dropped.txt", "Dropped work");
    teammate.git(&["push", "--quiet", "origin", "dropped"]);
    run(&mine, Action::Fetch { background: true }).unwrap();
    teammate.git(&["push", "--quiet", "origin", "--delete", "dropped"]);
    run(&mine, Action::Fetch { background: true }).unwrap();
    let set_aside = actions::set_aside_branches(mine.path()).unwrap();
    assert_eq!(set_aside.len(), 1, "a background fetch sets aside too");
    assert_eq!(
        run(
            &mine,
            Action::ForgetRemembered {
                references: vec![set_aside[0].reference.clone()]
            }
        )
        .unwrap(),
        "Forgot origin/dropped (kept in Restore)"
    );
    assert!(refs(&mine, "refs/tributary/gone/").is_empty());
    assert!(
        actions::backups(mine.path())
            .unwrap()
            .iter()
            .any(|backup| backup.event == BackupEvent::DeletedFromRemote
                && backup.name == "origin/dropped")
    );
}

/// The repository from the zip: cloned from `old` (main here, feature-a and feature-b only
/// remembered), with an empty `new` to move to.
fn copied_repository(name: &str) -> (TempRepo, TempRepo, TempRepo) {
    let old = TempRepo::bare(&format!("{name}-old.git"));
    let new = TempRepo::bare(&format!("{name}-new.git"));
    let mut seed = TempRepo::new(&format!("{name}-seed"));
    with_identity(&seed);
    seed.git(&["remote", "add", "origin", old.url()]);
    seed.commit("a.txt", "First");
    seed.git(&["push", "--quiet", "-u", "origin", "main"]);
    for branch in ["feature-a", "feature-b"] {
        seed.git(&["checkout", "--quiet", "-b", branch, "main"]);
        seed.commit(&format!("{branch}.txt"), &format!("Work on {branch}"));
        seed.git(&["push", "--quiet", "origin", branch]);
    }
    seed.git(&["tag", "v1", "main"]);
    seed.git(&["push", "--quiet", "origin", "v1"]);
    let copy = TempRepo::clone_of(&format!("{name}-copy"), &old);
    with_identity(&copy);
    (copy, old, new)
}

#[test]
fn moving_a_remote_to_an_empty_one_copies_the_branches_it_remembers() {
    let _turn = remote_turn();
    let (copy, _old, new) = copied_repository("move-copy");

    let check = actions::move_check(copy.path(), "origin".into(), new.url().into()).unwrap();
    assert!(check.reached);
    let at_risk: Vec<&str> = check
        .missing
        .iter()
        .map(|branch| branch.name.as_str())
        .collect();
    let mut at_risk = at_risk;
    at_risk.sort();
    assert_eq!(
        at_risk,
        vec!["feature-a", "feature-b"],
        "main is pushed from the branch here, so it's not among them"
    );
    assert_eq!(check.local, vec!["main".to_string()]);

    let message = run(
        &copy,
        Action::MoveRemote {
            name: "origin".into(),
            url: new.url().into(),
            then: RememberedChoice::Copy,
            branches: vec!["feature-a".into(), "feature-b".into()],
            local: check.local.clone(),
        },
    )
    .unwrap();
    assert!(message.starts_with("Moved origin to "), "{message}");
    assert!(
        message.ends_with(", and copied 3 branches there"),
        "{message}"
    );
    assert_eq!(copy.git(&["remote", "get-url", "origin"]), new.url());
    assert_eq!(
        new.git(&["for-each-ref", "--format=%(refname)"]),
        "refs/heads/feature-a\nrefs/heads/feature-b\nrefs/heads/main\nrefs/tags/v1"
    );
    // A fetch from the new address now has nothing to set aside.
    run(&copy, Action::Fetch { background: false }).unwrap();
    assert!(actions::set_aside_branches(copy.path()).unwrap().is_empty());
    assert_eq!(
        refs(&copy, "refs/remotes/origin/").len(),
        4,
        "HEAD, main and the two features"
    );
}

#[test]
fn moving_a_remote_can_keep_its_remembered_branches_here_instead() {
    let _turn = remote_turn();
    let (copy, _old, new) = copied_repository("move-keep");
    let message = run(
        &copy,
        Action::MoveRemote {
            name: "origin".into(),
            url: new.url().into(),
            then: RememberedChoice::Keep,
            branches: vec!["feature-a".into(), "feature-b".into()],
            local: vec!["main".into()],
        },
    )
    .unwrap();
    assert!(
        message.ends_with("Kept branches here, as feature-a and feature-b"),
        "{message}"
    );
    assert_eq!(
        copy.git(&["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"]),
        "feature-a\nfeature-b\nmain"
    );
    assert_eq!(new.git(&["for-each-ref"]), "", "nothing was pushed");
}

#[test]
fn push_branches_asks_the_remote_and_offers_the_branches_only_remembered() {
    let _turn = remote_turn();
    let (copy, _old, new) = copied_repository("push-remembered");
    // Pointed at the new one outside Tributary, before any fetch.
    copy.git(&["remote", "set-url", "origin", new.url()]);

    let found = actions::branches_to_push(copy.path(), None).unwrap();
    assert!(
        found.checked && found.fresh,
        "the empty remote has none of the remembered ones"
    );
    let mut listed: Vec<(&str, PushReason)> = found
        .branches
        .iter()
        .map(|branch| (branch.name.as_str(), branch.reason))
        .collect();
    listed.sort_by_key(|(name, _)| *name);
    assert_eq!(
        listed,
        vec![
            ("feature-a", PushReason::Remembered),
            ("feature-b", PushReason::Remembered),
            ("main", PushReason::Missing),
        ]
    );

    assert_eq!(
        run(
            &copy,
            Action::PushBranches {
                names: vec!["main".into()],
                remote: "origin".into(),
                remembered: vec!["feature-a".into(), "feature-b".into()],
            },
        )
        .unwrap(),
        "Pushed 3 branches to origin"
    );
    assert_eq!(
        new.git(&["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"]),
        "feature-a\nfeature-b\nmain"
    );
    let found = actions::branches_to_push(copy.path(), None).unwrap();
    assert!(found.branches.is_empty(), "{:?}", found.branches);
}

/// A repository whose main is only remembered from `old`, with all its commits on develop,
/// the branch here: as a repository moved by hand often is. With an empty `new` to move to.
fn develop_here(name: &str) -> (TempRepo, TempRepo, TempRepo) {
    let old = TempRepo::bare(&format!("{name}-old.git"));
    let new = TempRepo::bare(&format!("{name}-new.git"));
    let mut seed = TempRepo::new(&format!("{name}-seed"));
    with_identity(&seed);
    seed.git(&["remote", "add", "origin", old.url()]);
    seed.commit("a.txt", "First");
    seed.git(&["push", "--quiet", "-u", "origin", "main"]);
    seed.git(&["checkout", "--quiet", "-b", "develop"]);
    seed.commit("b.txt", "Develop work");
    seed.git(&["push", "--quiet", "-u", "origin", "develop"]);
    let copy = TempRepo::clone_of(&format!("{name}-copy"), &old);
    with_identity(&copy);
    copy.git(&["checkout", "--quiet", "develop"]);
    copy.git(&["branch", "--quiet", "-D", "main"]);
    (copy, old, new)
}

#[test]
fn moving_a_remote_copies_a_branch_with_no_commits_of_its_own_too() {
    let _turn = remote_turn();
    let (copy, _old, new) = develop_here("move-main");

    let check = actions::move_check(copy.path(), "origin".into(), new.url().into()).unwrap();
    let missing: Vec<(&str, u32)> = check
        .missing
        .iter()
        .map(|branch| (branch.name.as_str(), branch.commits))
        .collect();
    assert_eq!(
        missing,
        vec![("main", 0)],
        "main has nothing develop doesn't, but it's asked about"
    );
    assert_eq!(check.local, vec!["develop".to_string()]);

    let message = run(
        &copy,
        Action::MoveRemote {
            name: "origin".into(),
            url: new.url().into(),
            then: RememberedChoice::Copy,
            branches: vec!["main".into()],
            local: check.local.clone(),
        },
    )
    .unwrap();
    assert!(
        message.ends_with(", and copied 2 branches there"),
        "{message}"
    );
    assert_eq!(
        new.git(&["for-each-ref", "--format=%(refname)"]),
        "refs/heads/develop\nrefs/heads/main"
    );
    // Moved here, so the next fetch has nothing to ask.
    run(&copy, Action::Fetch { background: false }).unwrap();
    assert!(actions::set_aside_branches(copy.path()).unwrap().is_empty());
}

#[test]
fn a_fetch_after_the_address_changed_elsewhere_keeps_every_branch_the_new_one_lacks() {
    let _turn = remote_turn();
    let (copy, old, new) = develop_here("moved-elsewhere");
    // A fetch from the old address: it's remembered as where the branches came from.
    run(&copy, Action::Fetch { background: false }).unwrap();
    // develop pushed to the new address, outside Tributary, after pointing origin there.
    copy.git(&["remote", "set-url", "origin", new.url()]);
    copy.git(&["push", "--quiet", "origin", "develop"]);

    let message = run(&copy, Action::Fetch { background: false }).unwrap();
    assert!(
        message.ends_with("The remote's new address doesn't have a branch the old one had"),
        "{message}"
    );
    let kept = actions::set_aside_branches(copy.path()).unwrap();
    let kept: Vec<(&str, u32, bool)> = kept
        .iter()
        .map(|branch| (branch.name.as_str(), branch.commits, branch.moved))
        .collect();
    assert_eq!(
        kept,
        vec![("main", 0, true)],
        "kept with no commits of its own"
    );
    assert_eq!(
        run(
            &copy,
            Action::KeepRemembered {
                references: vec!["refs/tributary/moved/origin/main".into()],
            },
        )
        .unwrap(),
        "Kept a branch here, as main"
    );
    assert_eq!(
        copy.git(&["rev-parse", "main"]),
        old.git(&["rev-parse", "main"])
    );
    assert!(actions::set_aside_branches(copy.path()).unwrap().is_empty());

    // Pointed at the same address, a branch deleted there with nothing of its own is
    // forgotten, as before.
    copy.git(&["push", "--quiet", "origin", "main", "main:topic"]);
    run(&copy, Action::Fetch { background: false }).unwrap();
    copy.git(&["push", "--quiet", "origin", "--delete", "topic"]);
    run(&copy, Action::Fetch { background: false }).unwrap();
    assert!(actions::set_aside_branches(copy.path()).unwrap().is_empty());
    assert_eq!(
        refs(&copy, "refs/remotes/origin/"),
        vec!["HEAD", "develop", "main"]
    );
}

#[test]
fn a_fetch_from_an_empty_new_address_keeps_every_branch() {
    let _turn = remote_turn();
    // Copied with its .git folder and pointed at a new, empty repository before Tributary
    // ever fetched it: no address is remembered, but the new one has none of the branches.
    let (copy, _old, new) = develop_here("moved-empty");
    copy.git(&["remote", "set-url", "origin", new.url()]);
    run(&copy, Action::Fetch { background: false }).unwrap();
    let kept: Vec<String> = actions::set_aside_branches(copy.path())
        .unwrap()
        .into_iter()
        .map(|branch| branch.name)
        .collect();
    // develop is the branch here, which Push branches offers; main is kept aside.
    assert_eq!(kept, vec!["main".to_string()]);
}
