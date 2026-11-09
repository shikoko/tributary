//! Local history: snapshots of uncommitted work, to put files back as they were.

#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{TempRepo, read, with_identity};
use tributary_lib::actions::{self, Action};

#[test]
fn keeps_snapshots_of_uncommitted_work_to_restore() {
    let mut repo = TempRepo::new("history");
    with_identity(&repo);
    repo.commit("level.txt", "Tavern");
    repo.commit("notes.txt", "Lamps");
    let write = |file: &str, text: &str| std::fs::write(repo.path().join(file), text).unwrap();

    // Nothing changed: nothing to keep.
    assert!(
        actions::take_snapshot(repo.path(), 1000, 7)
            .unwrap()
            .is_none()
    );

    write("level.txt", "Tavern with a fireplace");
    write("sketch.txt", "Stool, three legs");
    // Too big to keep a copy of every few minutes.
    write("bake.bin", &"x".repeat(5000));
    // What's staged stays as it is.
    write("notes.txt", "Lamps and candles");
    repo.git(&["add", "notes.txt"]);
    let staged = repo.git(&["diff", "--cached", "--name-status"]);

    let first = actions::take_snapshot(repo.path(), 1000, 7)
        .unwrap()
        .unwrap();
    let mut files: Vec<(&str, &str)> = first
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.change))
        .collect();
    files.sort();
    assert_eq!(
        files,
        vec![
            ("level.txt", "modified"),
            ("notes.txt", "modified"),
            ("sketch.txt", "added")
        ]
    );
    assert_eq!(repo.git(&["diff", "--cached", "--name-status"]), staged);
    assert_eq!(repo.git(&["stash", "list"]), "");
    // Nothing new since: no second copy.
    assert!(
        actions::take_snapshot(repo.path(), 1000, 7)
            .unwrap()
            .is_none()
    );

    write("level.txt", "Tavern, fireplace gone wrong");
    std::fs::remove_file(repo.path().join("sketch.txt")).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    let second = actions::take_snapshot(repo.path(), 1000, 7)
        .unwrap()
        .unwrap();
    let history = actions::local_history(repo.path()).unwrap();
    assert_eq!(
        history.iter().map(|s| &s.reference).collect::<Vec<_>>(),
        vec![&second.reference, &first.reference]
    );

    // Put the level back as the first snapshot had it, and the sketch that's gone since.
    let restored = actions::run_with_progress(
        repo.path(),
        Action::RestoreFromHistory {
            reference: first.reference.clone(),
            paths: vec!["level.txt".into(), "sketch.txt".into()],
        },
        &|_| {},
    )
    .unwrap();
    assert_eq!(restored.message, "Restored 2 files from the local history");
    assert_eq!(read(&repo, "level.txt"), "Tavern with a fireplace");
    assert_eq!(read(&repo, "sketch.txt"), "Stool, three legs");
    assert_eq!(read(&repo, "notes.txt"), "Lamps and candles");

    // Undo: as they were just before.
    actions::run(
        repo.path(),
        Action::RestoreFromHistory {
            reference: restored.backup.unwrap(),
            paths: vec!["level.txt".into()],
        },
    )
    .unwrap();
    assert_eq!(read(&repo, "level.txt"), "Tavern, fireplace gone wrong");

    // Kept for a while, then forgotten.
    write("level.txt", "Tavern, again");
    actions::take_snapshot(repo.path(), 1000, 0)
        .unwrap()
        .unwrap();
    assert_eq!(actions::local_history(repo.path()).unwrap().len(), 1);
}
