//! Noticing changes made outside the app.

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use common::TempRepo;
use tributary_lib::watch::{Watching, stop, watch};

/// Wait up to two seconds for `count` to reach `at_least`.
fn reaches(count: &AtomicUsize, at_least: usize) -> bool {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if count.load(Ordering::SeqCst) >= at_least {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}

#[test]
fn reports_changes_but_not_ignored_files() {
    let mut repo = TempRepo::new("watch");
    std::fs::write(repo.path().join(".gitignore"), "Saved/\n").unwrap();
    std::fs::create_dir_all(repo.path().join("Saved")).unwrap();
    repo.commit("notes.txt", "first");

    let state = Watching::default();
    let changes = Arc::new(AtomicUsize::new(0));
    let counter = changes.clone();
    watch(&state, repo.path(), move || {
        counter.fetch_add(1, Ordering::SeqCst);
    })
    .unwrap();
    // Give the watches a moment to start.
    std::thread::sleep(Duration::from_millis(200));

    // Build output: nothing to report.
    std::fs::write(repo.path().join("Saved/cache.bin"), "x").unwrap();
    std::thread::sleep(Duration::from_millis(900));
    assert_eq!(
        changes.load(Ordering::SeqCst),
        0,
        "an ignored file was reported"
    );

    // An edit: reported once, however many writes it took.
    for n in 0..5 {
        std::fs::write(repo.path().join("notes.txt"), format!("edit {n}")).unwrap();
    }
    assert!(reaches(&changes, 1), "the edit wasn't reported");
    std::thread::sleep(Duration::from_millis(600));
    // Once, gathered; twice at most if a slow machine stalls between the writes for longer
    // than the quiet time (as build servers do).
    let reports = changes.load(Ordering::SeqCst);
    assert!(
        reports <= 2,
        "one burst, reported {reports} times: the writes weren't gathered"
    );

    // A file in a folder made after watching started.
    std::fs::create_dir_all(repo.path().join("src/levels")).unwrap();
    std::thread::sleep(Duration::from_millis(600));
    let before = changes.load(Ordering::SeqCst);
    std::fs::write(repo.path().join("src/levels/one.txt"), "x").unwrap();
    assert!(
        reaches(&changes, before + 1),
        "a change in a new folder wasn't reported"
    );

    stop(&state);
    std::thread::sleep(Duration::from_millis(100));
    let after = changes.load(Ordering::SeqCst);
    std::fs::write(repo.path().join("notes.txt"), "after stopping").unwrap();
    std::thread::sleep(Duration::from_millis(900));
    assert_eq!(
        changes.load(Ordering::SeqCst),
        after,
        "reported after stopping"
    );
}
