//! Submodules: whether each is at the commit the repository records, updating them,
//! and what a submodule's change shows.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{TempRepo, files, run};
use tributary_lib::actions::{
    Action, DiffSource, Submodule, SubmoduleState, file_diff, submodules,
};
use tributary_lib::repo::{self, FileStatus};

/// An app with a library as a submodule at `vendor/lib`, and the library's first commit.
/// `name` keeps each test's folders apart.
fn app_with_library(name: &str) -> (TempRepo, TempRepo, String) {
    let mut library = TempRepo::new(&format!("{name}-library"));
    let first = library.commit("lib.txt", "one\n");
    let mut app = TempRepo::new(&format!("{name}-app"));
    app.commit("app.txt", "app\n");
    // Submodules from a local folder need this since git 2.38.
    app.git(&[
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "--quiet",
        library.url(),
        "vendor/lib",
    ]);
    app.git(&["commit", "--quiet", "-m", "Add the library"]);
    (library, app, first)
}

fn only(app: &TempRepo) -> Submodule {
    let mut list = submodules(app.path()).unwrap();
    assert_eq!(list.len(), 1);
    list.remove(0)
}

/// Commit a change inside the submodule, returning its id.
fn commit_inside(app: &TempRepo, text: &str) -> String {
    std::fs::write(app.path().join("vendor/lib/lib.txt"), text).unwrap();
    app.git(&["-C", "vendor/lib", "commit", "--quiet", "-am", text.trim()]);
    app.git(&["-C", "vendor/lib", "rev-parse", "HEAD"])
}

#[test]
fn tells_where_each_submodule_is() {
    let (_library, app, first) = app_with_library("submodule-states");
    let library = only(&app);
    assert_eq!(library.path, "vendor/lib");
    assert_eq!(library.state, SubmoduleState::UpToDate);
    assert_eq!(library.recorded.as_deref(), Some(first.as_str()));
    assert!(!library.changed);

    // New commits in the submodule, not recorded yet.
    let second = commit_inside(&app, "two\n");
    let library = only(&app);
    assert_eq!((library.state, library.ahead), (SubmoduleState::Ahead, 1));
    assert_eq!(library.current.as_deref(), Some(second.as_str()));

    // Recorded, then left behind (as a pull that moved it would).
    app.git(&["add", "vendor/lib"]);
    app.git(&[
        "commit",
        "--quiet",
        "-m",
        "Use the library's second version",
    ]);
    assert_eq!(only(&app).state, SubmoduleState::UpToDate);
    app.git(&["-C", "vendor/lib", "checkout", "--quiet", &first]);
    let library = only(&app);
    assert_eq!((library.state, library.behind), (SubmoduleState::Behind, 1));

    // Changes of its own.
    std::fs::write(app.path().join("vendor/lib/lib.txt"), "edited\n").unwrap();
    assert!(only(&app).changed);

    // Not set up.
    app.git(&["submodule", "deinit", "--quiet", "--force", "vendor/lib"]);
    assert_eq!(only(&app).state, SubmoduleState::NotSetUp);
}

#[test]
fn lists_a_submodule_with_new_commits_among_the_changes() {
    let (_library, app, _first) = app_with_library("submodule-status");
    commit_inside(&app, "two\n");
    // Reading the status can refresh the index in the background afterwards, so nothing
    // runs git here after it.
    let snapshot = repo::load(app.path(), 100, true).unwrap();
    let unstaged = snapshot.worktree.unwrap().unstaged;
    assert_eq!(files(&unstaged), vec![("vendor/lib", FileStatus::Modified)]);
}

#[test]
fn updates_submodules_to_the_recorded_commit() {
    let (_library, app, first) = app_with_library("submodule-update");
    let second = commit_inside(&app, "two\n");
    app.git(&["add", "vendor/lib"]);
    app.git(&[
        "commit",
        "--quiet",
        "-m",
        "Use the library's second version",
    ]);
    app.git(&["-C", "vendor/lib", "checkout", "--quiet", &first]);

    let message = run(&app, Action::UpdateSubmodules { paths: Vec::new() }).unwrap();
    assert_eq!(message, "Updated the submodules");
    let library = only(&app);
    assert_eq!(library.state, SubmoduleState::UpToDate);
    assert_eq!(library.current.as_deref(), Some(second.as_str()));

    // One that isn't set up gets set up (from the copy git kept).
    app.git(&["submodule", "deinit", "--quiet", "--force", "vendor/lib"]);
    let message = run(
        &app,
        Action::UpdateSubmodules {
            paths: vec!["vendor/lib".into()],
        },
    )
    .unwrap();
    assert_eq!(message, "Updated lib");
    assert_eq!(only(&app).state, SubmoduleState::UpToDate);
}

#[test]
fn shows_a_submodule_change_as_its_commits() {
    let (_library, app, first) = app_with_library("submodule-diff");
    let added = app.git(&["rev-parse", "HEAD"]);
    let diff = file_diff(
        app.path(),
        DiffSource::Commit { id: added },
        "vendor/lib",
        None,
        false,
    )
    .unwrap();
    let change = diff.submodule.unwrap();
    assert_eq!((change.before, change.after), (None, Some(first.clone())));
    assert!(diff.hunks.is_empty());

    commit_inside(&app, "two\n");
    let third = commit_inside(&app, "three\n");
    let diff = file_diff(app.path(), DiffSource::Unstaged, "vendor/lib", None, false).unwrap();
    let change = diff.submodule.unwrap();
    assert_eq!(change.after.as_deref(), Some(third.as_str()));
    let summaries: Vec<&str> = change.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, ["three", "two"]);
    assert!(!change.rewound && !change.dirty);

    // Moved back, with changes of its own.
    app.git(&["add", "vendor/lib"]);
    app.git(&["-C", "vendor/lib", "checkout", "--quiet", &first]);
    std::fs::write(app.path().join("vendor/lib/lib.txt"), "edited\n").unwrap();
    let diff = file_diff(app.path(), DiffSource::Unstaged, "vendor/lib", None, false).unwrap();
    let change = diff.submodule.unwrap();
    assert!(change.rewound && change.dirty);
    assert_eq!(change.commits.len(), 2);
}
