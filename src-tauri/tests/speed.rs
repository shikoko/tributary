//! git's speed-ups for big repositories. Background maintenance isn't tried: it changes
//! the global git config and the computer's scheduler.

mod common;

use common::{TempRepo, run, with_identity};
use tributary_lib::actions::{self, Action, SpeedUp};

#[test]
fn turns_speed_ups_on_and_off() {
    let mut repo = TempRepo::new("speed");
    with_identity(&repo);
    repo.commit("a.txt", "a");
    repo.commit("b.txt", "b");
    let settings = actions::speed_settings(repo.path()).unwrap_or_default();
    assert_eq!(settings.files, 2);
    assert!(!settings.big);
    assert!(!settings.untracked_cache && !settings.commit_graph);
    assert!(!settings.git_version.is_empty());

    for which in [SpeedUp::UntrackedCache, SpeedUp::CommitGraph] {
        assert!(run(&repo, Action::SetSpeedUp { which, on: true }).is_ok());
    }
    let settings = actions::speed_settings(repo.path()).unwrap_or_default();
    assert!(settings.untracked_cache && settings.commit_graph);
    assert!(
        repo.path().join(".git/objects/info/commit-graph").exists()
            || repo.path().join(".git/objects/info/commit-graphs").exists()
    );

    for which in [SpeedUp::UntrackedCache, SpeedUp::CommitGraph] {
        assert!(run(&repo, Action::SetSpeedUp { which, on: false }).is_ok());
    }
    let settings = actions::speed_settings(repo.path()).unwrap_or_default();
    assert!(!settings.untracked_cache && !settings.commit_graph);
    if settings.file_watcher.is_none() {
        assert!(
            run(
                &repo,
                Action::SetSpeedUp {
                    which: SpeedUp::FileWatcher,
                    on: true
                }
            )
            .is_err()
        );
    }
}
