//! Files you're working on that other branches also changed since yours split off.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::TempRepo;
use tributary_lib::actions;

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// Each overlap as (file, can't be merged, uncommitted, the branches that changed it).
fn summary(overlaps: &[actions::Overlap]) -> Vec<(&str, bool, bool, Vec<&str>)> {
    overlaps
        .iter()
        .map(|o| {
            let branches = o.elsewhere.iter().map(|c| c.branch.as_str()).collect();
            (o.path.as_str(), o.unmergeable, o.uncommitted, branches)
        })
        .collect()
}

#[test]
fn finds_files_also_changed_on_other_recent_branches() {
    let remote = TempRepo::bare("elsewhere-remote");
    let mut repo = TempRepo::new("elsewhere");
    repo.clock = now() - 5 * 24 * 3600;
    std::fs::write(repo.path().join(".gitattributes"), "*.uasset binary\n").unwrap();
    repo.git(&["add", ".gitattributes"]);
    repo.commit("Hero.uasset", "Hero v1");
    repo.commit("shared.txt", "Shared v1");
    repo.commit("notes.txt", "Notes v1");
    repo.commit("readme.txt", "Readme v1");

    // A teammate's branch changes the hero, the shared file and the readme.
    repo.git(&["switch", "--quiet", "-c", "art/hero-v2"]);
    repo.commit("Hero.uasset", "Hero v2");
    repo.commit("shared.txt", "Shared, their way");
    repo.commit("readme.txt", "Readme, their way");
    // An old branch that changed the hero long ago is left out.
    repo.git(&["switch", "--quiet", "-c", "old-hero", "main"]);
    let then = now() - 90 * 24 * 3600;
    std::fs::write(repo.path().join("Hero.uasset"), "Ancient hero").unwrap();
    repo.git_at(&["commit", "--quiet", "-am", "Ancient hero"], then);
    // A branch that's already merged has nothing new.
    repo.git(&["switch", "--quiet", "main"]);
    repo.git(&["branch", "merged"]);

    // Main moves on: someone's readme change, already pushed. It isn't yours.
    repo.commit("readme.txt", "Readme, main's way");
    repo.git(&["remote", "add", "origin", remote.url()]);
    repo.git(&["push", "--quiet", "origin", "main"]);
    repo.git(&["remote", "set-head", "origin", "main"]);
    // Yours: a commit to the shared file that isn't pushed, and the hero being edited.
    repo.commit("shared.txt", "Shared, my way");
    std::fs::write(repo.path().join("Hero.uasset"), "Hero, my edit").unwrap();
    std::fs::write(repo.path().join("notes.txt"), "Notes, my edit").unwrap();

    let changed = vec!["Hero.uasset".to_owned(), "notes.txt".to_owned()];
    let overlaps = actions::changed_elsewhere(repo.path(), &changed).unwrap();
    assert_eq!(
        summary(&overlaps),
        vec![
            ("Hero.uasset", true, true, vec!["art/hero-v2"]),
            ("shared.txt", false, false, vec!["art/hero-v2"]),
        ]
    );
    let hero = &overlaps[0].elsewhere[0];
    assert_eq!(hero.summary, "Hero v2");
    assert_eq!(hero.author, "Test Author");

    // On a branch of your own, its commits are yours, wherever they are pushed.
    repo.git(&["stash", "--quiet"]);
    repo.git(&["switch", "--quiet", "-c", "my/feature", "origin/main"]);
    repo.commit("readme.txt", "Readme, my way");
    repo.git(&["push", "--quiet", "origin", "my/feature"]);
    let overlaps = actions::changed_elsewhere(repo.path(), &[]).unwrap();
    let readme: Vec<_> = summary(&overlaps)
        .into_iter()
        .filter(|(file, ..)| *file == "readme.txt")
        .collect();
    assert_eq!(
        readme,
        vec![("readme.txt", false, false, vec!["art/hero-v2"])]
    );

    // Nothing in common: nothing to report.
    let quiet = TempRepo::new("elsewhere-quiet");
    assert!(
        actions::changed_elsewhere(quiet.path(), &[])
            .unwrap()
            .is_empty()
    );
}
