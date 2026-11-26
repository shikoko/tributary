//! A branch whose remote branch was rebased elsewhere while it still has the old commits:
//! which of them that version has, taking it in their place (and undoing that), and putting
//! a commit it hasn't got on top of it.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{TempRepo, failure, outcome, remote_turn, run, with_identity};
use tributary_lib::actions::{self, Action, BackupEvent};
use tributary_lib::repo::{self, Rebased, RefKind};

/// A remote whose `rooms` branch (three commits off main) `mine` has; then main moves on
/// elsewhere, and rooms is rebased onto it there and force-pushed, and `mine` fetches.
fn rebased_elsewhere(name: &str) -> (TempRepo, TempRepo, TempRepo) {
    let remote = TempRepo::bare(&format!("{name}-remote.git"));
    let mut elsewhere = TempRepo::new(&format!("{name}-elsewhere"));
    with_identity(&elsewhere);
    elsewhere.git(&["remote", "add", "origin", remote.url()]);
    elsewhere.commit("a.txt", "First");
    elsewhere.git(&["push", "--quiet", "-u", "origin", "main"]);
    elsewhere.git(&["checkout", "--quiet", "-b", "rooms"]);
    for room in ["hall", "stairs", "landing"] {
        elsewhere.commit(&format!("{room}.txt"), &format!("Add the {room}"));
    }
    elsewhere.git(&["push", "--quiet", "-u", "origin", "rooms"]);
    let mine = TempRepo::clone_of(&format!("{name}-mine"), &remote);
    with_identity(&mine);
    mine.git(&["branch", "--quiet", "--track", "rooms", "origin/rooms"]);

    elsewhere.git(&["checkout", "--quiet", "main"]);
    elsewhere.commit("kitchen.txt", "Furnish the kitchen");
    elsewhere.git(&["push", "--quiet", "origin", "main"]);
    elsewhere.git(&["checkout", "--quiet", "rooms"]);
    elsewhere.git(&["rebase", "--quiet", "main"]);
    elsewhere.git(&["push", "--quiet", "--force", "origin", "rooms"]);
    mine.git(&["fetch", "--quiet", "origin"]);
    (remote, elsewhere, mine)
}

/// What the graph's label for local branch `name` says about its upstream being rebased.
fn label_rebased(repo: &TempRepo, name: &str) -> Option<Rebased> {
    let snapshot = repo::load(repo.path(), 100, false).unwrap();
    snapshot
        .commits
        .iter()
        .flat_map(|commit| &commit.refs)
        .find(|label| label.kind == RefKind::Branch && label.name == name)
        .expect("the branch is labelled")
        .rebased
}

#[test]
fn a_branch_rebased_elsewhere_finds_its_commits_there_and_takes_that_version_with_undo() {
    let _turn = remote_turn();
    let (_remote, _elsewhere, mine) = rebased_elsewhere("rebased-take");
    let old = mine.git(&["rev-parse", "rooms"]);
    let new = mine.git(&["rev-parse", "origin/rooms"]);
    assert_eq!(
        label_rebased(&mine, "rooms"),
        Some(Rebased {
            in_upstream: 3,
            only_here: 0
        })
    );

    let found = actions::rebased_upstream(mine.path(), "rooms")
        .unwrap()
        .expect("rebased with its commits");
    assert_eq!(
        (
            found.upstream.as_str(),
            found.from.as_str(),
            found.to.as_str()
        ),
        ("origin/rooms", old.as_str(), new.as_str())
    );
    assert!(!found.current);
    let summaries: Vec<&str> = found.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(
        summaries,
        ["Add the hall", "Add the stairs", "Add the landing"]
    );
    assert!(
        found
            .commits
            .iter()
            .all(|commit| commit.now.is_some() && !commit.changed)
    );

    let done = outcome(
        &mine,
        Action::TakeUpstream {
            branch: "rooms".into(),
            from: old.clone(),
            to: new.clone(),
            keep: vec![],
            checkout: false,
        },
    );
    assert_eq!(done.message, "rooms now matches origin/rooms");
    assert_eq!(mine.git(&["rev-parse", "rooms"]), new);
    assert_eq!(
        mine.git(&["branch", "--show-current"]),
        "main",
        "not checked out"
    );
    assert!(
        actions::backups(mine.path())
            .unwrap()
            .iter()
            .any(|backup| backup.name == "rooms"
                && backup.event == BackupEvent::Reset
                && backup.id == old),
        "its own version is kept in Restore"
    );
    // Level with its upstream now: nothing to take.
    assert_eq!(
        actions::rebased_upstream(mine.path(), "rooms").unwrap(),
        None
    );
    assert_eq!(label_rebased(&mine, "rooms"), None);

    let undo = done.undo.expect("it can be undone");
    assert_eq!(
        undo,
        Action::MoveBranch {
            branch: "rooms".into(),
            from: new.clone(),
            to: old.clone()
        }
    );
    run(&mine, undo).unwrap();
    assert_eq!(mine.git(&["rev-parse", "rooms"]), old);

    // Asked again after it moved, it's left alone.
    mine.git(&["branch", "--force", "rooms", "main"]);
    let (message, _) = failure(
        &mine,
        Action::TakeUpstream {
            branch: "rooms".into(),
            from: old,
            to: new,
            keep: vec![],
            checkout: false,
        },
    );
    assert_eq!(message, "rooms has changed since: look at it again.");
}

#[test]
fn a_commit_made_since_goes_on_top_of_the_rebased_version_checked_out_or_not() {
    let _turn = remote_turn();
    let (_remote, _elsewhere, mut mine) = rebased_elsewhere("rebased-keep");
    mine.git(&["checkout", "--quiet", "rooms"]);
    let bath = mine.commit("bath.txt", "Add the bath");
    // A change staged and not committed yet, which taking it leaves staged.
    std::fs::write(mine.path().join("cellar.txt"), "Barrels").unwrap();
    mine.git(&["add", "cellar.txt"]);
    let old = mine.git(&["rev-parse", "rooms"]);
    let new = mine.git(&["rev-parse", "origin/rooms"]);
    assert_eq!(
        label_rebased(&mine, "rooms"),
        Some(Rebased {
            in_upstream: 3,
            only_here: 1
        })
    );
    let found = actions::rebased_upstream(mine.path(), "rooms")
        .unwrap()
        .unwrap();
    assert!(found.current);
    let only_here: Vec<&str> = found
        .commits
        .iter()
        .filter(|commit| commit.now.is_none())
        .map(|commit| commit.id.as_str())
        .collect();
    assert_eq!(only_here, [bath.as_str()]);

    // Checked out: it's moved there, and the commit is cherry-picked on top.
    let take = Action::TakeUpstream {
        branch: "rooms".into(),
        from: old.clone(),
        to: new.clone(),
        keep: vec![bath.clone()],
        checkout: true,
    };
    let done = outcome(&mine, take);
    assert_eq!(
        done.message,
        "rooms is now origin/rooms with 1 commit of yours on top"
    );
    assert_eq!(mine.git(&["rev-parse", "rooms^"]), new);
    assert_eq!(
        mine.git(&["log", "-1", "--format=%s", "rooms"]),
        "Add the bath"
    );
    assert!(mine.path().join("bath.txt").exists());
    assert_eq!(
        mine.git(&["diff", "--cached", "--name-only"]),
        "cellar.txt",
        "the staged change isn't staged any more"
    );
    run(&mine, done.undo.unwrap()).unwrap();
    assert_eq!(mine.git(&["rev-parse", "rooms"]), old);

    // Not checked out: the same, without touching the working tree.
    mine.git(&["checkout", "--quiet", "main"]);
    let done = outcome(
        &mine,
        Action::TakeUpstream {
            branch: "rooms".into(),
            from: old.clone(),
            to: new.clone(),
            keep: vec![bath],
            checkout: false,
        },
    );
    assert_eq!(mine.git(&["rev-parse", "rooms^"]), new);
    assert_eq!(
        mine.git(&["log", "-1", "--format=%s", "rooms"]),
        "Add the bath"
    );
    assert_eq!(mine.git(&["branch", "--show-current"]), "main");
    assert!(!mine.path().join("bath.txt").exists());
    // Only the bath is left to push.
    assert_eq!(
        mine.git(&["rev-list", "--count", "origin/rooms..rooms"]),
        "1"
    );
    run(&mine, done.undo.unwrap()).unwrap();
    assert_eq!(mine.git(&["rev-parse", "rooms"]), old);
}

#[test]
fn a_branch_that_has_only_fallen_behind_is_not_rebased() {
    let _turn = remote_turn();
    let (_remote, elsewhere, mine) = rebased_elsewhere("rebased-behind");
    // Level with what was fetched, then the remote branch gets a commit more.
    mine.git(&["branch", "--force", "rooms", "origin/rooms"]);
    let mut elsewhere = elsewhere;
    elsewhere.commit("cellar.txt", "Stock the cellar");
    elsewhere.git(&["push", "--quiet", "origin", "rooms"]);
    mine.git(&["fetch", "--quiet", "origin"]);
    assert_eq!(
        actions::rebased_upstream(mine.path(), "rooms").unwrap(),
        None
    );
    assert_eq!(label_rebased(&mine, "rooms"), None);
}
