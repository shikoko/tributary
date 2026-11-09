//! Fetching, pulling, pushing and cloning, with progress, cancelling and the activity log.

mod common;

use common::{TempRepo, outcome, remote_turn, run, with_identity};
use tributary_lib::actions::{Action, CloneOptions};
use tributary_lib::error::Error;
use tributary_lib::{actions, git, repo};

#[test]
fn pushes_fetches_and_pulls() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("remote.git");
    let mut alice = TempRepo::new("alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    let first = alice.commit("a.txt", "First");

    // The first push sets the upstream.
    assert_eq!(
        run(
            &alice,
            Action::Push {
                force: false,
                no_verify: false
            }
        )
        .unwrap(),
        "Pushed main to origin"
    );
    assert_eq!(remote.git(&["rev-parse", "main"]), first);
    assert_eq!(
        alice.git(&["rev-parse", "--abbrev-ref", "main@{upstream}"]),
        "origin/main"
    );
    let snapshot = repo::load(alice.path(), 100, false).unwrap();
    let upstream = snapshot.upstream.unwrap();
    assert_eq!(upstream.name, "origin/main");
    assert_eq!(upstream.commit.as_deref(), Some(first.as_str()));
    assert_eq!(snapshot.remotes, vec!["origin".to_owned()]);

    let bob = TempRepo::clone_of("bob", &remote);
    let second = alice.commit("b.txt", "Second");
    alice.commit("c.txt", "Third");
    // The push reports the files its commits changed, not ones pushed before.
    let pushed = outcome(
        &alice,
        Action::Push {
            force: false,
            no_verify: false,
        },
    );
    assert_eq!(pushed.pushed_files, vec!["b.txt", "c.txt"]);
    alice.git(&["reset", "--quiet", "--hard", "HEAD~1"]);
    run(
        &alice,
        Action::Push {
            force: true,
            no_verify: false,
        },
    )
    .unwrap();
    assert_eq!(remote.git(&["rev-parse", "main"]), second);

    run(&bob, Action::Fetch { background: false }).unwrap();
    assert_eq!(bob.git(&["rev-parse", "origin/main"]), second);
    assert_eq!(
        bob.git(&["rev-parse", "main"]),
        first,
        "fetch leaves main alone"
    );
    assert_eq!(run(&bob, Action::Pull).unwrap(), "Pulled main");
    assert_eq!(bob.git(&["rev-parse", "main"]), second);

    // Both sides commit: the branches diverge, and pulling still works.
    let mut bob = bob;
    bob.git(&["config", "user.name", "Bob"]);
    bob.git(&["config", "user.email", "bob@example.com"]);
    let from_bob = bob.commit("bob.txt", "From Bob");
    let from_alice = alice.commit("alice.txt", "From Alice");
    run(
        &alice,
        Action::Push {
            force: false,
            no_verify: false,
        },
    )
    .unwrap();
    run(&bob, Action::Pull).unwrap();
    for id in [&from_bob, &from_alice] {
        bob.git(&["merge-base", "--is-ancestor", id, "main"]);
    }
}

#[test]
fn force_push_replaces_the_remote_branch() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("force-remote.git");
    let mut alice = TempRepo::new("force-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    alice.commit("a.txt", "First");
    alice.commit("a.txt", "Second");
    run(
        &alice,
        Action::Push {
            force: false,
            no_verify: false,
        },
    )
    .unwrap();

    // Rewrite history: replace "Second" with something else.
    alice.git(&["reset", "--quiet", "--hard", "HEAD~1"]);
    let rewritten = alice.commit("a.txt", "Second, rewritten");
    assert!(
        run(
            &alice,
            Action::Push {
                force: false,
                no_verify: false
            }
        )
        .is_err(),
        "a normal push is refused"
    );

    assert_eq!(
        run(
            &alice,
            Action::Push {
                force: true,
                no_verify: false
            }
        )
        .unwrap(),
        "Force pushed main to origin"
    );
    assert_eq!(remote.git(&["rev-parse", "main"]), rewritten);
}

#[test]
fn checks_out_remote_branches_as_tracking_branches() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("tracking-remote.git");
    let mut alice = TempRepo::new("tracking-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    alice.commit("a.txt", "First");
    alice.git(&["push", "--quiet", "origin", "main"]);
    alice.git(&["switch", "--quiet", "--create", "feature"]);
    let feature = alice.commit("b.txt", "Feature");
    alice.git(&["push", "--quiet", "origin", "feature"]);

    let bob = TempRepo::clone_of("tracking-bob", &remote);
    let message = run(
        &bob,
        Action::CheckoutRemoteBranch {
            name: "origin/feature".into(),
        },
    )
    .unwrap();
    assert_eq!(message, "Checked out feature, tracking origin/feature");
    assert_eq!(bob.git(&["branch", "--show-current"]), "feature");
    assert_eq!(bob.git(&["rev-parse", "HEAD"]), feature);
    assert_eq!(
        bob.git(&["rev-parse", "--abbrev-ref", "feature@{upstream}"]),
        "origin/feature"
    );

    // Behind: checking out origin/feature again brings feature up to date.
    let newer = alice.commit("c.txt", "More feature");
    alice.git(&["push", "--quiet", "origin", "feature"]);
    bob.git(&["fetch", "--quiet", "origin"]);
    bob.git(&["switch", "--quiet", "main"]);
    let message = run(
        &bob,
        Action::CheckoutRemoteBranch {
            name: "origin/feature".into(),
        },
    );
    assert_eq!(
        message.as_deref(),
        Ok("Checked out feature and brought it up to date with origin/feature (1 commit)")
    );
    assert_eq!(bob.git(&["branch", "--show-current"]), "feature");
    assert_eq!(bob.git(&["rev-parse", "HEAD"]), newer);

    // Already checked out and behind: a fast-forward, like pulling without fetching.
    let newest = alice.commit("d.txt", "Even more");
    alice.git(&["push", "--quiet", "origin", "feature"]);
    bob.git(&["fetch", "--quiet", "origin"]);
    assert!(
        run(
            &bob,
            Action::CheckoutRemoteBranch {
                name: "origin/feature".into()
            }
        )
        .is_ok()
    );
    assert_eq!(bob.git(&["rev-parse", "HEAD"]), newest);

    // Both changed: checked out, but left as it is.
    let mut bob = bob;
    let mine = bob.commit("bob.txt", "Bob's own");
    alice.commit("e.txt", "Alice's own");
    alice.git(&["push", "--quiet", "origin", "feature"]);
    bob.git(&["fetch", "--quiet", "origin"]);
    bob.git(&["switch", "--quiet", "main"]);
    let message = run(
        &bob,
        Action::CheckoutRemoteBranch {
            name: "origin/feature".into(),
        },
    )
    .unwrap_or_default();
    assert!(message.contains("both changed"), "{message}");
    assert_eq!(bob.git(&["rev-parse", "HEAD"]), mine);
}

#[test]
fn pull_and_push_need_a_branch() {
    let _turn = remote_turn();
    let mut repo = TempRepo::new("detached-actions");
    let id = repo.commit("a.txt", "First");
    repo.git(&["switch", "--quiet", "--detach", &id]);
    assert!(run(&repo, Action::Pull).unwrap_err().contains("detached"));
    assert!(
        run(
            &repo,
            Action::Push {
                force: false,
                no_verify: false
            }
        )
        .unwrap_err()
        .contains("detached")
    );
    assert!(
        run(&repo, Action::Fetch { background: false })
            .unwrap_err()
            .contains("no remotes")
    );
}

#[test]
fn reports_progress_and_remembers_upstreams() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("progress-remote.git");
    let mut alice = TempRepo::new("progress-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    for i in 0..30 {
        alice.commit(&format!("file{i}.txt"), &format!("Commit {i}"));
    }
    let phases = std::cell::RefCell::new(Vec::new());
    actions::run_with_progress(
        alice.path(),
        Action::Push {
            force: false,
            no_verify: false,
        },
        &|progress| phases.borrow_mut().push(progress.phase),
    )
    .unwrap();
    assert_eq!(
        phases.borrow().first().map(String::as_str),
        Some("Connecting")
    );

    let snapshot = repo::load(alice.path(), 100, false).unwrap();
    let main = snapshot.commits[0]
        .refs
        .iter()
        .find(|r| r.name == "main")
        .unwrap();
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
}

#[cfg(unix)]
#[test]
fn cancels_a_slow_fetch() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("slow-remote.git");
    let mut alice = TempRepo::new("slow-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    alice.commit("a.txt", "First");
    alice.git(&["push", "--quiet", "origin", "main"]);
    // Make the remote take a long time to answer.
    alice.git(&[
        "config",
        "remote.origin.uploadpack",
        "sleep 20; git-upload-pack",
    ]);

    let path = alice.path().to_owned();
    let started = std::time::Instant::now();
    let fetch =
        std::thread::spawn(move || actions::run(&path, Action::Fetch { background: false }));
    std::thread::sleep(std::time::Duration::from_millis(500));
    assert!(git::cancel(), "a fetch was running");
    let result = fetch.join().unwrap();
    assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
    assert!(
        started.elapsed().as_secs() < 5,
        "cancelling doesn't wait for the remote"
    );
    assert!(!git::cancel(), "nothing left to cancel");
}

#[test]
fn clones_and_creates_repositories() {
    let _turn = remote_turn();
    let mut source = TempRepo::new("clone-source");
    source.commit("a.txt", "First");
    let parent = TempRepo::empty("clone-parent");

    let cloned = actions::clone_repository(
        source.url(),
        parent.path(),
        "copy",
        &CloneOptions::default(),
        &|_| {},
    )
    .unwrap();
    assert_eq!(cloned, parent.path().join("copy"));
    let snapshot = repo::load(&cloned, 100, false).unwrap();
    assert_eq!(snapshot.commits.len(), 1);
    assert_eq!(snapshot.remotes, vec!["origin"]);

    let again = actions::clone_repository(
        source.url(),
        parent.path(),
        "copy",
        &CloneOptions::default(),
        &|_| {},
    );
    assert!(again.unwrap_err().to_string().contains("already exists"));
    let missing = actions::clone_repository(
        "/no/such/repo.git",
        parent.path(),
        "broken",
        &CloneOptions::default(),
        &|_| {},
    );
    assert!(missing.is_err());
    assert!(
        !parent.path().join("broken").exists(),
        "a failed clone leaves nothing behind"
    );
    for name in ["", "a/b", ".."] {
        assert!(
            actions::clone_repository(
                source.url(),
                parent.path(),
                name,
                &CloneOptions::default(),
                &|_| {}
            )
            .is_err()
        );
    }
    assert!(
        actions::clone_repository(
            "--upload-pack=x",
            parent.path(),
            "x",
            &CloneOptions::default(),
            &|_| {}
        )
        .is_err()
    );

    let fresh = parent.path().join("fresh");
    std::fs::create_dir(&fresh).unwrap();
    actions::init_repository(&fresh).unwrap();
    assert!(fresh.join(".git").is_dir());
    assert!(repo::load(&fresh, 100, true).unwrap().commits.is_empty());
    assert!(
        actions::init_repository(&fresh)
            .unwrap_err()
            .to_string()
            .contains("already")
    );
}

#[cfg(unix)]
#[test]
fn passes_on_the_pull_request_link_the_remote_suggests() {
    use std::os::unix::fs::PermissionsExt;
    let _turn = remote_turn();
    let remote = TempRepo::bare("pr-remote.git");
    let hook = remote.path().join("hooks/post-receive");
    std::fs::write(
        &hook,
        "#!/bin/sh\necho 'Create a pull request for feature by visiting:'\necho '     https://github.com/owner/repo/pull/new/feature'\n",
    )
    .unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut repo = TempRepo::new("pr");
    repo.git(&["remote", "add", "origin", remote.url()]);
    repo.commit("a.txt", "First");
    repo.git(&["switch", "--quiet", "--create", "feature"]);

    let outcome = actions::run_with_progress(
        repo.path(),
        Action::Push {
            force: false,
            no_verify: false,
        },
        &|_| {},
    )
    .unwrap();
    assert_eq!(
        outcome.pull_request.as_deref(),
        Some("https://github.com/owner/repo/pull/new/feature")
    );
}

#[test]
fn logs_the_git_commands_it_runs() {
    let mut repo = TempRepo::new("activity");
    with_identity(&repo);
    repo.commit("a.txt", "First");
    std::fs::write(repo.path().join("b.txt"), "b").unwrap();
    run(&repo, Action::StageAll).unwrap();
    assert!(
        run(
            &repo,
            Action::CheckoutBranch {
                name: "nope".into()
            }
        )
        .is_err()
    );

    let folder = repo.path().display().to_string();
    let mine: Vec<_> = git::activity()
        .into_iter()
        .filter(|entry| entry.folder == folder)
        .collect();
    assert_eq!(
        mine.len(),
        1,
        "the failed checkout never reached git: {mine:?}"
    );
    assert_eq!(mine[0].args, vec!["add", "--all"]);
    assert!(mine[0].success);
    assert!(!mine[0].background);
}

#[test]
fn clones_only_recent_history_or_some_folders() {
    let _turn = remote_turn();
    let mut source = TempRepo::new("partial-source");
    std::fs::create_dir_all(source.path().join("art")).unwrap();
    std::fs::create_dir_all(source.path().join("code")).unwrap();
    source.commit("art/hero.txt", "Draw the hero");
    source.commit("code/main.txt", "Write the main loop");
    source.commit("readme.txt", "Explain it all");
    // Shallow and partial clones need a URL: a plain path makes a local copy instead.
    let url = format!("file://{}", source.url());
    let parent = TempRepo::empty("partial-parent");

    let recent = CloneOptions {
        depth: Some(1),
        ..CloneOptions::default()
    };
    let shallow =
        actions::clone_repository(&url, parent.path(), "recent", &recent, &|_| {}).unwrap();
    let snapshot = repo::load(&shallow, 100, true).unwrap();
    assert_eq!(snapshot.commits.len(), 1, "only the latest commit");
    assert!(shallow.join("art/hero.txt").exists());

    let some = CloneOptions {
        folders: vec!["code/".into(), " code ".into()],
        ..CloneOptions::default()
    };
    let sparse = actions::clone_repository(&url, parent.path(), "code", &some, &|_| {}).unwrap();
    assert!(sparse.join("code/main.txt").exists());
    assert!(
        sparse.join("readme.txt").exists(),
        "files at the top come along"
    );
    assert!(
        !sparse.join("art/hero.txt").exists(),
        "other folders stay out"
    );
    assert_eq!(repo::load(&sparse, 100, true).unwrap().commits.len(), 3);

    let outside = CloneOptions {
        folders: vec!["../elsewhere".into()],
        ..CloneOptions::default()
    };
    assert!(actions::clone_repository(&url, parent.path(), "bad", &outside, &|_| {}).is_err());
    let nothing = CloneOptions {
        depth: Some(0),
        ..CloneOptions::default()
    };
    assert!(actions::clone_repository(&url, parent.path(), "none", &nothing, &|_| {}).is_err());
    assert!(!parent.path().join("bad").exists() && !parent.path().join("none").exists());
}

#[test]
fn sums_up_who_committed_where_lately() {
    let _turn = remote_turn();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let remote = TempRepo::bare("team-remote.git");
    let alice = TempRepo::new("team-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    std::fs::write(alice.path().join("a.txt"), "a\n").unwrap();
    alice.git(&["add", "a.txt"]);
    alice.git_at(&["commit", "-qm", "Start"], now - 3600 * 5);
    alice.git(&["push", "-q", "-u", "origin", "main"]);

    let bob = TempRepo::clone_of("team-bob", &remote);
    bob.git(&["switch", "-q", "-c", "feature/export"]);
    for (index, file) in ["export.txt", "zip.txt"].iter().enumerate() {
        std::fs::write(bob.path().join(file), "x\n").unwrap();
        bob.git(&["add", file]);
        bob.git_at(&["commit", "-qm", file], now - 3600 * (3 - index as i64));
    }
    bob.git(&["push", "-q", "origin", "feature/export"]);
    // An old branch doesn't count.
    bob.git(&["switch", "-q", "-c", "old", "main"]);
    std::fs::write(bob.path().join("old.txt"), "x\n").unwrap();
    bob.git(&["add", "old.txt"]);
    bob.git_at(&["commit", "-qm", "Long ago"], now - 3600 * 24 * 90);
    bob.git(&["push", "-q", "origin", "old"]);

    alice.git(&["fetch", "-q", "origin"]);
    let team = tributary_lib::actions::team_activity(alice.path(), 30).unwrap();
    assert_eq!(team.main, "origin/main");
    assert_eq!(team.main_commits, 1);
    let names: Vec<&str> = team.branches.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, ["origin/feature/export"]);
    let export = &team.branches[0];
    assert_eq!((export.ahead, export.behind, export.files), (2, 0, 2));
    assert_eq!(export.people.len(), 1);
    assert_eq!(export.people[0].commits, 2);
    // Both test identities committed: the clone's commits and alice's.
    assert!(!team.people.is_empty());
    let total: usize = team.people.iter().map(|p| p.commits).sum();
    assert_eq!(total, 3);
    // Each commit's time, the newest first.
    let times: usize = team.people.iter().map(|p| p.times.len()).sum();
    assert_eq!(times, 3);
    assert!(team.people.iter().all(|p| p.times.windows(2).all(|w| w[0] >= w[1])));
    assert_eq!(export.times.len(), 2);
    assert_eq!(team.days, 30);
}

#[test]
fn counts_ahead_and_behind_over_the_whole_history() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("track-remote.git");
    let mut alice = TempRepo::new("track-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    alice.commit("a.txt", "start");
    alice.git(&["push", "-q", "-u", "origin", "main"]);
    let mut bob = TempRepo::clone_of("track-bob", &remote);
    for n in 0..5 {
        bob.commit("b.txt", &format!("bob {n}"));
    }
    bob.git(&["push", "-q", "origin", "main"]);
    // Newer than bob's, so it's among the commits loaded.
    alice.clock = bob.clock + 100;
    alice.commit("c.txt", "alice's own");
    alice.git(&["fetch", "-q", "origin"]);

    // Only two commits loaded: git still counts all five.
    let snapshot = tributary_lib::repo::load(alice.path(), 2, false).unwrap();
    let main = snapshot
        .commits
        .iter()
        .flat_map(|commit| &commit.refs)
        .find(|label| label.name == "main")
        .expect("main is loaded");
    assert_eq!((main.ahead, main.behind), (Some(1), Some(5)));
}

#[test]
fn adds_renames_repoints_and_removes_remotes() {
    let _turn = remote_turn();
    let mut repo = TempRepo::new("remotes");
    repo.commit("a.txt", "a");
    let origin = TempRepo::bare("remotes-origin");
    let added = run(
        &repo,
        Action::AddRemote {
            name: "origin".into(),
            url: origin.url().into(),
        },
    )
    .unwrap();
    assert_eq!(added, "Added the remote origin");
    assert!(
        run(
            &repo,
            Action::AddRemote {
                name: "origin".into(),
                url: "x".into()
            }
        )
        .unwrap_err()
        .contains("already")
    );
    assert!(
        run(
            &repo,
            Action::AddRemote {
                name: "bad name".into(),
                url: "x".into()
            }
        )
        .unwrap_err()
        .contains("can't be")
    );
    assert!(
        run(
            &repo,
            Action::AddRemote {
                name: "up".into(),
                url: "--upload-pack=evil".into()
            }
        )
        .unwrap_err()
        .contains("isn't")
    );

    // A token in an address stays out of the list (and the activity log).
    run(
        &repo,
        Action::AddRemote {
            name: "fork".into(),
            url: "https://maya:ghp_secret@github.com/maya/app.git".into(),
        },
    )
    .unwrap();
    let list = actions::remotes(repo.path()).unwrap();
    let fork = list.iter().find(|remote| remote.name == "fork").unwrap();
    assert_eq!(fork.url, "https://github.com/maya/app.git");
    assert!(fork.has_credentials);
    let logged: Vec<String> = git::activity()
        .into_iter()
        .flat_map(|entry| entry.args)
        .collect();
    assert!(
        !logged.iter().any(|arg| arg.contains("ghp_secret")),
        "{logged:?}"
    );

    run(
        &repo,
        Action::Push {
            force: false,
            no_verify: false,
        },
    )
    .unwrap();
    assert!(repo.git(&["branch", "-r"]).contains("origin/main"));
    run(
        &repo,
        Action::RenameRemote {
            from: "origin".into(),
            to: "upstream".into(),
        },
    )
    .unwrap();
    assert!(repo.git(&["branch", "-r"]).contains("upstream/main"));
    assert_eq!(repo.git(&["config", "branch.main.remote"]), "upstream");

    run(
        &repo,
        Action::SetRemoteUrl {
            name: "upstream".into(),
            url: "https://example.com/push.git".into(),
            push: true,
        },
    )
    .unwrap();
    let upstream = actions::remotes(repo.path())
        .unwrap()
        .into_iter()
        .find(|r| r.name == "upstream")
        .unwrap();
    assert_eq!(
        upstream.push_url.as_deref(),
        Some("https://example.com/push.git")
    );
    run(
        &repo,
        Action::SetRemoteUrl {
            name: "upstream".into(),
            url: String::new(),
            push: true,
        },
    )
    .unwrap();
    let upstream = actions::remotes(repo.path())
        .unwrap()
        .into_iter()
        .find(|r| r.name == "upstream")
        .unwrap();
    assert_eq!(upstream.push_url, None);

    run(
        &repo,
        Action::RemoveRemote {
            name: "fork".into(),
        },
    )
    .unwrap();
    run(
        &repo,
        Action::RemoveRemote {
            name: "upstream".into(),
        },
    )
    .unwrap();
    assert!(actions::remotes(repo.path()).unwrap().is_empty());
    assert_eq!(repo.git(&["branch", "-r"]), "");
}
