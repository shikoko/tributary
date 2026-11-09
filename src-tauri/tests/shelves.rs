//! Shelves: unfinished work shared through the remote without a branch.

#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{TempRepo, read, remote_turn, run, with_identity};
use tributary_lib::actions::{self, Action};

#[test]
fn shelves_work_for_a_teammate_to_open() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("shelf-remote.git");
    let mut alice = TempRepo::new("shelf-alice");
    with_identity(&alice);
    alice.git(&["remote", "add", "origin", remote.url()]);
    alice.commit("sign.txt", "Open at noon");
    alice.commit("menu.txt", "Ale");
    alice.git(&["push", "--quiet", "-u", "origin", "main"]);
    let bob = TempRepo::clone_of("shelf-bob", &remote);
    bob.git(&["config", "user.name", "Bob"]);
    bob.git(&["config", "user.email", "bob@example.com"]);

    // Alice's unfinished work: a change, a new file and a deleted one.
    std::fs::write(alice.path().join("sign.txt"), "Open at noon till late").unwrap();
    std::fs::write(alice.path().join("hours.txt"), "Every day").unwrap();
    std::fs::remove_file(alice.path().join("menu.txt")).unwrap();
    // Something staged stays staged: the shelf is made without touching it.
    std::fs::write(alice.path().join("notes.txt"), "Ask about the lamps").unwrap();
    alice.git(&["add", "notes.txt"]);
    let before = alice.git(&["status", "--porcelain"]);

    // Nothing to say what it's for.
    let shelve = |description: &str, keep: bool, paths: Vec<String>| Action::Shelve {
        paths,
        description: description.into(),
        keep,
    };
    assert!(run(&alice, shelve("  ", true, vec![])).is_err());

    // Kept in her copy: nothing changes here.
    let kept = run(
        &alice,
        shelve(
            "Opening hours",
            true,
            vec!["sign.txt".into(), "hours.txt".into(), "menu.txt".into()],
        ),
    )
    .unwrap();
    assert_eq!(kept, "Shelved 3 files as “Opening hours”");
    assert_eq!(alice.git(&["status", "--porcelain"]), before);

    let shelves = actions::shelves(bob.path(), true).unwrap();
    assert_eq!(shelves.len(), 1);
    let shelf = &shelves[0];
    assert_eq!(shelf.description, "Opening hours");
    // Whoever git says Alice is (its environment can set that, before her settings).
    assert_eq!(format!("{} <{}>", shelf.author, shelf.email), ident(&alice));
    assert_eq!(shelf.branch.as_deref(), Some("main"));
    assert_eq!(shelf.mine, ident(&bob) == ident(&alice));
    assert_eq!(
        shelf.base.as_deref(),
        Some(alice.git(&["rev-parse", "HEAD"]).as_str())
    );
    let mut files: Vec<(&str, &str)> = shelf
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.change))
        .collect();
    files.sort();
    assert_eq!(
        files,
        vec![
            ("hours.txt", "added"),
            ("menu.txt", "deleted"),
            ("sign.txt", "modified")
        ]
    );
    assert!(actions::shelves(alice.path(), false).unwrap()[0].mine);

    // Bob opens it: the files as Alice shelved them, not staged.
    let opened = run(
        &bob,
        Action::OpenShelf {
            reference: shelf.reference.clone(),
        },
    )
    .unwrap();
    assert_eq!(opened, "Opened the shelf: 3 files");
    assert_eq!(read(&bob, "sign.txt"), "Open at noon till late");
    assert_eq!(read(&bob, "hours.txt"), "Every day");
    assert!(!bob.path().join("menu.txt").exists());
    assert_eq!(bob.git(&["diff", "--cached", "--name-only"]), "");

    // Again, over his own changes to them: refused, as a checkout would be.
    let refused = run(
        &bob,
        Action::OpenShelf {
            reference: shelf.reference.clone(),
        },
    )
    .unwrap_err();
    assert!(refused.contains("would be overwritten"), "{refused}");
    assert!(refused.contains("sign.txt"), "{refused}");

    // Shelved and taken out of her copy: her other changes stay, and Undo can put them back.
    let taken = actions::run_with_progress(
        alice.path(),
        shelve("Just the sign", false, vec!["sign.txt".into()]),
        &|_| {},
    )
    .unwrap();
    assert_eq!(
        taken.message,
        "Shelved 1 file as “Just the sign”, and took them out of your copy"
    );
    assert_eq!(read(&alice, "sign.txt"), "Open at noon");
    assert!(alice.path().join("hours.txt").exists());
    assert!(taken.backup.is_some());

    // Deleting one deletes it on the remote too.
    run(
        &bob,
        Action::DeleteShelf {
            reference: shelf.reference.clone(),
        },
    )
    .unwrap();
    let left = actions::shelves(alice.path(), true).unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].description, "Just the sign");
}

/// "Name <email>", as git would author a commit in `repo` (as the app's git runs).
fn ident(repo: &TempRepo) -> String {
    let output = std::process::Command::new("git")
        .args(["var", "GIT_AUTHOR_IDENT"])
        .current_dir(repo.path())
        .output()
        .unwrap();
    let ident = String::from_utf8(output.stdout).unwrap();
    ident[..ident.find('>').unwrap() + 1].to_owned()
}

#[test]
fn needs_a_remote_and_changes() {
    let mut repo = TempRepo::new("shelf-alone");
    with_identity(&repo);
    repo.commit("a.txt", "A");
    std::fs::write(repo.path().join("a.txt"), "B").unwrap();
    let error = run(
        &repo,
        Action::Shelve {
            paths: vec![],
            description: "Mine".into(),
            keep: true,
        },
    )
    .unwrap_err();
    assert!(error.contains("has none"), "{error}");
    assert!(actions::shelves(repo.path(), true).unwrap().is_empty());
}
