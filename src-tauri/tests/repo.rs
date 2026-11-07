//! End-to-end tests for reading a repository. They build small repositories with
//! the `git` command line tool, which must be installed.

use std::path::{Path, PathBuf};
use std::process::Command;

use tributary_lib::actions::{self, Action, BranchTip};
use tributary_lib::repo::{
    self, FileChange, FileStatus, LoadOptions, OperationKind, RefKind, RowKind,
};

struct TempRepo {
    dir: PathBuf,
    clock: i64,
}

impl TempRepo {
    /// An empty folder, with an empty git config next to it.
    fn empty(name: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("tributary-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // An empty global config keeps the developer's own settings (signing, hooks, …) out of the tests.
        std::fs::write(dir.with_extension("gitconfig"), "").unwrap();
        TempRepo {
            dir,
            clock: 1_700_000_000,
        }
    }

    fn new(name: &str) -> Self {
        let repo = Self::empty(name);
        repo.git(&["init", "--quiet", "--initial-branch=main"]);
        repo
    }

    /// A bare repository, to use as a remote.
    fn bare(name: &str) -> Self {
        let repo = Self::empty(name);
        repo.git(&["init", "--quiet", "--bare", "--initial-branch=main"]);
        repo
    }

    /// A clone of `remote`.
    fn clone_of(name: &str, remote: &TempRepo) -> Self {
        let repo = Self::empty(name);
        repo.git(&["clone", "--quiet", remote.url(), "."]);
        repo
    }

    fn url(&self) -> &str {
        self.dir.to_str().unwrap()
    }

    fn git(&self, args: &[&str]) -> String {
        self.git_at(args, self.clock)
    }

    fn git_at(&self, args: &[&str], time: i64) -> String {
        let date = format!("@{time} +0000");
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.dir)
            .env("GIT_CONFIG_GLOBAL", self.dir.with_extension("gitconfig"))
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Test Author")
            .env("GIT_AUTHOR_EMAIL", "author@example.com")
            .env("GIT_COMMITTER_NAME", "Test Committer")
            .env("GIT_COMMITTER_EMAIL", "committer@example.com")
            .env("GIT_AUTHOR_DATE", &date)
            .env("GIT_COMMITTER_DATE", &date)
            .output()
            .expect("git must be installed to run these tests");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    /// Write `file` and commit it, returning the new commit id.
    fn commit(&mut self, file: &str, message: &str) -> String {
        self.clock += 60;
        std::fs::write(self.dir.join(file), message).unwrap();
        self.git(&["add", file]);
        self.git(&["commit", "--quiet", "-m", message]);
        self.git(&["rev-parse", "HEAD"])
    }

    fn path(&self) -> &Path {
        &self.dir
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
        let _ = std::fs::remove_file(self.dir.with_extension("gitconfig"));
    }
}

#[test]
fn reads_branches_merges_and_tags() {
    let mut repo = TempRepo::new("merge");
    let root = repo.commit("readme.md", "Initial commit");
    repo.git(&["checkout", "--quiet", "-b", "feature"]);
    let feature = repo.commit("feature.txt", "Add feature");
    repo.git(&["checkout", "--quiet", "main"]);
    let fix = repo.commit("readme.md", "Fix readme");
    repo.clock += 60;
    repo.git(&[
        "merge",
        "--quiet",
        "--no-ff",
        "feature",
        "-m",
        "Merge feature\n\nWith a body.",
    ]);
    let merge = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["tag", "-a", "v1.0", "-m", "Release 1.0"]);

    let snapshot = repo::load(repo.path(), 100, true).unwrap();
    let ids: Vec<&str> = snapshot.commits.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            merge.as_str(),
            fix.as_str(),
            feature.as_str(),
            root.as_str()
        ]
    );
    assert_eq!(snapshot.head_branch.as_deref(), Some("main"));
    assert_eq!(snapshot.head_commit.as_deref(), Some(merge.as_str()));
    assert_eq!(snapshot.lane_count, 2);
    assert!(!snapshot.truncated);

    let top = &snapshot.commits[0];
    assert_eq!(top.summary, "Merge feature");
    assert_eq!(top.author_name, "Test Author");
    assert_eq!(top.parents, vec![fix.clone(), feature.clone()]);
    let labels: Vec<(&str, RefKind, bool)> = top
        .refs
        .iter()
        .map(|r| (r.name.as_str(), r.kind, r.current))
        .collect();
    assert_eq!(
        labels,
        vec![
            ("main", RefKind::Branch, true),
            ("v1.0", RefKind::Tag, false)
        ]
    );
    assert_eq!(snapshot.commits[2].refs[0].name, "feature");
    assert!(!snapshot.commits[2].refs[0].current);
    assert_eq!(snapshot.commits[2].graph.column, 1);

    let details = repo::details(repo.path(), &merge).unwrap();
    assert_eq!(details.summary, "Merge feature");
    assert_eq!(details.body, "With a body.");
    assert_eq!(details.committer.email, "committer@example.com");
    let files: Vec<(&str, FileStatus)> = details
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.status))
        .collect();
    assert_eq!(files, vec![("feature.txt", FileStatus::Added)]);

    let details = repo::details(repo.path(), &fix).unwrap();
    let files: Vec<(&str, FileStatus)> = details
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.status))
        .collect();
    assert_eq!(files, vec![("readme.md", FileStatus::Modified)]);
}

#[test]
fn children_come_before_parents_even_with_skewed_clocks() {
    let mut repo = TempRepo::new("skew");
    repo.commit("a.txt", "First");
    let parent = repo.commit("b.txt", "Second");
    // A commit dated a day before its parent.
    std::fs::write(repo.path().join("c.txt"), "third").unwrap();
    repo.git(&["add", "c.txt"]);
    repo.git_at(&["commit", "--quiet", "-m", "Third"], repo.clock - 86_400);
    let child = repo.git(&["rev-parse", "HEAD"]);

    let snapshot = repo::load(repo.path(), 100, true).unwrap();
    let child_row = snapshot.commits.iter().position(|c| c.id == child).unwrap();
    let parent_row = snapshot
        .commits
        .iter()
        .position(|c| c.id == parent)
        .unwrap();
    assert!(child_row < parent_row);
}

#[test]
fn respects_the_commit_limit() {
    let mut repo = TempRepo::new("limit");
    for i in 0..5 {
        repo.commit("file.txt", &format!("Commit {i}"));
    }
    let snapshot = repo::load(repo.path(), 3, true).unwrap();
    assert_eq!(snapshot.commits.len(), 3);
    assert!(snapshot.truncated);
    assert_eq!(snapshot.commits[0].summary, "Commit 4");
}

#[test]
fn opens_from_a_subdirectory_and_handles_detached_head() {
    let mut repo = TempRepo::new("detached");
    let first = repo.commit("a.txt", "First");
    repo.commit("a.txt", "Second");
    repo.git(&["checkout", "--quiet", "--detach", &first]);
    std::fs::create_dir_all(repo.path().join("nested/dir")).unwrap();

    let snapshot = repo::load(&repo.path().join("nested/dir"), 100, true).unwrap();
    assert_eq!(snapshot.head_branch, None);
    let head_row = snapshot.commits.iter().find(|c| c.id == first).unwrap();
    assert!(head_row.refs.iter().any(|r| r.kind == RefKind::Head));
}

#[test]
fn reports_folders_that_are_not_repositories() {
    let dir =
        std::env::temp_dir().join(format!("tributary-test-{}-not-a-repo", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let error = repo::load(&dir, 100, true).unwrap_err();
    assert!(error.contains("is not a git repository"), "{error}");
    let _ = std::fs::remove_dir_all(&dir);
}

fn files(changes: &[FileChange]) -> Vec<(&str, FileStatus)> {
    changes
        .iter()
        .map(|f| (f.path.as_str(), f.status))
        .collect()
}

#[test]
fn shows_uncommitted_changes_and_stashes() {
    let _turn = remote_turn();
    let mut repo = TempRepo::new("worktree");
    let first = repo.commit("a.txt", "First");
    let second = repo.commit("b.txt", "Second");
    // A stash made on top of the second commit…
    std::fs::write(repo.path().join("a.txt"), "stashed change").unwrap();
    repo.clock += 60;
    repo.git(&["stash", "push", "--quiet", "-m", "Half-done idea"]);
    // …then another commit, with uncommitted changes on top of it.
    let third = repo.commit("c.txt", "Third");
    std::fs::write(repo.path().join("b.txt"), "modified").unwrap();
    std::fs::write(repo.path().join("d.txt"), "staged").unwrap();
    repo.git(&["add", "d.txt"]);
    std::fs::write(repo.path().join("e.txt"), "untracked").unwrap();

    let snapshot = repo::load(repo.path(), 100, true).unwrap();
    let kinds: Vec<RowKind> = snapshot.commits.iter().map(|c| c.kind).collect();
    assert_eq!(
        kinds,
        vec![
            RowKind::Worktree,
            RowKind::Commit,
            RowKind::Stash,
            RowKind::Commit,
            RowKind::Commit
        ]
    );

    let worktree = &snapshot.commits[0];
    assert_eq!(worktree.id, repo::WORKTREE_ID);
    assert_eq!(worktree.parents, vec![third.clone()]);
    assert!(worktree.graph.lines.iter().all(|line| line.dashed));
    let status = snapshot.worktree.as_ref().unwrap();
    assert_eq!(files(&status.staged), vec![("d.txt", FileStatus::Added)]);
    assert_eq!(
        files(&status.unstaged),
        vec![
            ("b.txt", FileStatus::Modified),
            ("e.txt", FileStatus::Untracked)
        ]
    );

    assert_eq!(snapshot.commits[1].id, third);
    let stash = &snapshot.commits[2];
    assert_eq!(stash.summary, "On main: Half-done idea");
    assert_eq!(
        stash.parents,
        vec![second.clone()],
        "only the commit the stash was made from"
    );
    assert_eq!(stash.refs.len(), 1);
    assert_eq!(
        (stash.refs[0].name.as_str(), stash.refs[0].kind),
        ("stash@{0}", RefKind::Stash)
    );
    assert!(stash.graph.lines.iter().any(|line| line.dashed));
    assert_eq!(snapshot.commits[3].id, second);
    assert_eq!(snapshot.commits[4].id, first);

    let details = repo::details(repo.path(), &stash.id).unwrap();
    assert_eq!(files(&details.files), vec![("a.txt", FileStatus::Modified)]);
}

#[test]
fn stash_details_include_untracked_files() {
    let mut repo = TempRepo::new("stash-untracked");
    repo.commit("a.txt", "First");
    std::fs::write(repo.path().join("a.txt"), "changed").unwrap();
    std::fs::write(repo.path().join("new.txt"), "new").unwrap();
    repo.git(&[
        "stash",
        "push",
        "--quiet",
        "--include-untracked",
        "-m",
        "With a new file",
    ]);

    let snapshot = repo::load(repo.path(), 100, true).unwrap();
    assert!(snapshot.worktree.is_none(), "the stash took every change");
    let stash = snapshot
        .commits
        .iter()
        .find(|c| c.kind == RowKind::Stash)
        .unwrap();
    let details = repo::details(repo.path(), &stash.id).unwrap();
    assert_eq!(
        files(&details.files),
        vec![
            ("a.txt", FileStatus::Modified),
            ("new.txt", FileStatus::Untracked)
        ]
    );
}

fn run(repo: &TempRepo, action: Action) -> Result<String, String> {
    actions::run(repo.path(), action)
}

/// Fetches, pulls and pushes can be cancelled all at once, so the tests that run them
/// take turns: cancelling in one test must not stop another test's push.
static REMOTE_TESTS: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn remote_turn() -> std::sync::MutexGuard<'static, ()> {
    REMOTE_TESTS.lock().unwrap_or_else(|e| e.into_inner())
}

#[test]
fn hard_reset_moves_the_branch_and_discards_changes() {
    let mut repo = TempRepo::new("reset");
    let first = repo.commit("a.txt", "First");
    repo.commit("a.txt", "Second");
    repo.commit("b.txt", "Third");
    std::fs::write(repo.path().join("a.txt"), "uncommitted").unwrap();
    std::fs::write(repo.path().join("untracked.txt"), "keep me").unwrap();

    let message = run(&repo, Action::ResetHard { id: first.clone() }).unwrap();

    assert_eq!(message, format!("Reset main to {}", &first[..7]));
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);
    assert_eq!(repo.git(&["branch", "--show-current"]), "main");
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "First"
    );
    assert!(!repo.path().join("b.txt").exists());
    assert!(
        repo.path().join("untracked.txt").exists(),
        "untracked files are kept"
    );
}

#[test]
fn actions_only_accept_full_ids_of_existing_commits() {
    let mut repo = TempRepo::new("invalid-ids");
    repo.commit("a.txt", "First");
    let missing = "0123456789012345678901234567890123456789";
    for id in ["--hard", "HEAD~1", "main", missing] {
        assert!(
            run(&repo, Action::ResetHard { id: id.into() }).is_err(),
            "{id}"
        );
        assert!(
            run(&repo, Action::CheckoutCommit { id: id.into() }).is_err(),
            "{id}"
        );
    }
}

#[test]
fn checks_out_branches_and_commits() {
    let mut repo = TempRepo::new("checkout");
    let first = repo.commit("a.txt", "First");
    let second = repo.commit("a.txt", "Second");

    let message = run(
        &repo,
        Action::CreateBranch {
            name: "feature".into(),
            id: first.clone(),
            checkout: false,
        },
    )
    .unwrap();
    assert_eq!(message, "Created feature");
    assert_eq!(repo.git(&["branch", "--show-current"]), "main");
    assert_eq!(repo.git(&["rev-parse", "feature"]), first);

    run(
        &repo,
        Action::CheckoutBranch {
            name: "feature".into(),
        },
    )
    .unwrap();
    assert_eq!(repo.git(&["branch", "--show-current"]), "feature");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);

    let message = run(&repo, Action::CheckoutCommit { id: second.clone() }).unwrap();
    assert_eq!(
        message,
        format!("Checked out {} (detached HEAD)", &second[..7])
    );
    assert_eq!(repo.git(&["branch", "--show-current"]), "");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), second);

    let message = run(
        &repo,
        Action::CreateBranch {
            name: " topic ".into(),
            id: first.clone(),
            checkout: true,
        },
    )
    .unwrap();
    assert_eq!(message, "Created and checked out topic");
    assert_eq!(repo.git(&["branch", "--show-current"]), "topic");
}

#[test]
fn rejects_bad_branch_names() {
    let mut repo = TempRepo::new("branch-names");
    let id = repo.commit("a.txt", "First");
    for name in ["", "-x", "has space", "two..dots", "main"] {
        let action = Action::CreateBranch {
            name: name.into(),
            id: id.clone(),
            checkout: false,
        };
        assert!(run(&repo, action).is_err(), "{name:?} should be rejected");
    }
    for name in ["--orphan", "missing"] {
        assert!(run(&repo, Action::CheckoutBranch { name: name.into() }).is_err());
        assert!(run(&repo, Action::CheckoutRemoteBranch { name: name.into() }).is_err());
    }
}

#[test]
fn pushes_fetches_and_pulls() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("remote.git");
    let mut alice = TempRepo::new("alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    let first = alice.commit("a.txt", "First");

    // The first push sets the upstream.
    assert_eq!(
        run(&alice, Action::Push { force: false }).unwrap(),
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
    run(&alice, Action::Push { force: false }).unwrap();
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
    run(&alice, Action::Push { force: false }).unwrap();
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
    run(&alice, Action::Push { force: false }).unwrap();

    // Rewrite history: replace "Second" with something else.
    alice.git(&["reset", "--quiet", "--hard", "HEAD~1"]);
    let rewritten = alice.commit("a.txt", "Second, rewritten");
    assert!(
        run(&alice, Action::Push { force: false }).is_err(),
        "a normal push is refused"
    );

    assert_eq!(
        run(&alice, Action::Push { force: true }).unwrap(),
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
}

#[test]
fn pull_and_push_need_a_branch() {
    let _turn = remote_turn();
    let mut repo = TempRepo::new("detached-actions");
    let id = repo.commit("a.txt", "First");
    repo.git(&["switch", "--quiet", "--detach", &id]);
    assert!(run(&repo, Action::Pull).unwrap_err().contains("detached"));
    assert!(
        run(&repo, Action::Push { force: false })
            .unwrap_err()
            .contains("detached")
    );
    assert!(
        run(&repo, Action::Fetch { background: false })
            .unwrap_err()
            .contains("no remotes")
    );
}

fn stash_count(repo: &TempRepo) -> usize {
    repo.git(&["stash", "list"]).lines().count()
}

fn read(repo: &TempRepo, file: &str) -> String {
    std::fs::read_to_string(repo.path().join(file)).unwrap()
}

#[test]
fn stashes_apply_pop_and_drop() {
    let mut repo = TempRepo::new("stash-actions");
    repo.commit("a.txt", "committed");
    std::fs::write(repo.path().join("a.txt"), "changed").unwrap();

    let message = run(
        &repo,
        Action::StashPush {
            message: Some("Half done".into()),
            include_untracked: false,
        },
    )
    .unwrap();
    assert_eq!(message, "Stashed your changes as stash@{0}");
    assert_eq!(read(&repo, "a.txt"), "committed");
    assert!(repo.git(&["stash", "list"]).contains("Half done"));
    let nothing = run(
        &repo,
        Action::StashPush {
            message: None,
            include_untracked: false,
        },
    )
    .unwrap_err();
    assert!(nothing.contains("no changes"), "{nothing}");

    let id = repo.git(&["rev-parse", "stash@{0}"]);
    run(
        &repo,
        Action::StashApply {
            index: 0,
            id: id.clone(),
        },
    )
    .unwrap();
    assert_eq!(read(&repo, "a.txt"), "changed");
    assert_eq!(stash_count(&repo), 1, "apply keeps the stash");

    repo.git(&["checkout", "--", "a.txt"]);
    run(
        &repo,
        Action::StashPop {
            index: 0,
            id: id.clone(),
        },
    )
    .unwrap();
    assert_eq!(read(&repo, "a.txt"), "changed");
    assert_eq!(stash_count(&repo), 0, "pop removes the stash");

    run(
        &repo,
        Action::StashPush {
            message: None,
            include_untracked: false,
        },
    )
    .unwrap();
    let wrong = "0123456789012345678901234567890123456789".to_owned();
    assert!(
        run(
            &repo,
            Action::StashDrop {
                index: 0,
                id: wrong
            }
        )
        .is_err()
    );
    let id = repo.git(&["rev-parse", "stash@{0}"]);
    run(&repo, Action::StashDrop { index: 0, id }).unwrap();
    assert_eq!(stash_count(&repo), 0);
}

#[test]
fn stash_and_retry_puts_changes_back() {
    let mut repo = TempRepo::new("stash-retry");
    repo.commit("a.txt", "one\ntwo\nthree\nfour\nfive\n");
    repo.git(&["branch", "old"]);
    repo.commit("a.txt", "ONE\ntwo\nthree\nfour\nfive\n");
    // An uncommitted edit to a file that differs between the branches.
    std::fs::write(repo.path().join("a.txt"), "ONE\ntwo\nthree\nfour\nFIVE\n").unwrap();

    let refused = run(&repo, Action::CheckoutBranch { name: "old".into() }).unwrap_err();
    assert!(refused.contains("would be overwritten"), "{refused}");

    let message = run(
        &repo,
        Action::StashAndRetry {
            action: Box::new(Action::CheckoutBranch { name: "old".into() }),
            include_untracked: false,
        },
    )
    .unwrap();
    assert_eq!(message, "Checked out old, and put your changes back");
    assert_eq!(repo.git(&["branch", "--show-current"]), "old");
    assert_eq!(read(&repo, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
    assert_eq!(stash_count(&repo), 0);
}

#[test]
fn stash_and_retry_keeps_the_stash_when_changes_conflict() {
    let mut repo = TempRepo::new("stash-retry-conflict");
    repo.commit("a.txt", "one");
    repo.git(&["branch", "old"]);
    repo.commit("a.txt", "two");
    std::fs::write(repo.path().join("a.txt"), "three").unwrap();

    let error = run(
        &repo,
        Action::StashAndRetry {
            action: Box::new(Action::CheckoutBranch { name: "old".into() }),
            include_untracked: false,
        },
    )
    .unwrap_err();
    assert!(error.contains("stash@{0}"), "{error}");
    assert_eq!(repo.git(&["branch", "--show-current"]), "old");
    assert_eq!(stash_count(&repo), 1, "the changes are still saved");
}

#[test]
fn stages_unstages_commits_and_undoes() {
    let mut repo = TempRepo::new("commit");
    let first = repo.commit("a.txt", "first");
    std::fs::write(repo.path().join("a.txt"), "changed").unwrap();
    std::fs::write(repo.path().join("b.txt"), "new").unwrap();
    let staged = |repo: &TempRepo| repo.git(&["diff", "--cached", "--name-only"]);

    run(
        &repo,
        Action::Stage {
            paths: vec!["a.txt".into()],
        },
    )
    .unwrap();
    assert_eq!(staged(&repo), "a.txt");
    run(
        &repo,
        Action::Unstage {
            paths: vec!["a.txt".into()],
        },
    )
    .unwrap();
    assert_eq!(staged(&repo), "");
    run(&repo, Action::StageAll).unwrap();
    assert_eq!(staged(&repo), "a.txt\nb.txt");
    run(&repo, Action::UnstageAll).unwrap();
    assert_eq!(staged(&repo), "");
    assert!(run(&repo, Action::Stage { paths: vec![] }).is_err());

    run(&repo, Action::StageAll).unwrap();
    assert!(
        run(
            &repo,
            Action::Commit {
                message: "  ".into(),
                amend: false
            }
        )
        .is_err()
    );
    let message = run(
        &repo,
        Action::Commit {
            message: "Second\n\nWith a body.".into(),
            amend: false,
        },
    )
    .unwrap();
    assert!(
        message.starts_with("Committed ") && message.ends_with(": Second"),
        "{message}"
    );
    assert_eq!(
        repo.git(&["log", "-1", "--format=%s|%b"]),
        "Second|With a body."
    );

    let message = run(
        &repo,
        Action::Commit {
            message: "Second, amended".into(),
            amend: true,
        },
    )
    .unwrap();
    assert!(message.starts_with("Amended "), "{message}");
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]), "2");
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Second, amended");

    // Undo: the commit goes away, its changes stay staged.
    run(&repo, Action::ResetSoft { id: first.clone() }).unwrap();
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);
    assert_eq!(staged(&repo), "a.txt\nb.txt");
}

#[test]
fn unstages_before_the_first_commit() {
    let repo = TempRepo::new("unborn");
    std::fs::write(repo.path().join("a.txt"), "new").unwrap();
    run(
        &repo,
        Action::Stage {
            paths: vec!["a.txt".into()],
        },
    )
    .unwrap();
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "a.txt");
    run(
        &repo,
        Action::Unstage {
            paths: vec!["a.txt".into()],
        },
    )
    .unwrap();
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
    run(&repo, Action::StageAll).unwrap();
    run(&repo, Action::UnstageAll).unwrap();
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
}

#[test]
fn deletes_and_renames_branches() {
    let mut repo = TempRepo::new("branch-admin");
    repo.commit("a.txt", "first");
    repo.git(&["branch", "merged"]);
    repo.git(&["switch", "--quiet", "--create", "unmerged"]);
    repo.commit("b.txt", "only here");
    repo.git(&["switch", "--quiet", "main"]);

    assert_eq!(
        run(
            &repo,
            Action::DeleteBranch {
                name: "merged".into(),
                force: false
            }
        )
        .unwrap(),
        "Deleted branch merged"
    );
    let refused = run(
        &repo,
        Action::DeleteBranch {
            name: "unmerged".into(),
            force: false,
        },
    )
    .unwrap_err();
    assert!(refused.contains("not fully merged"), "{refused}");
    run(
        &repo,
        Action::DeleteBranch {
            name: "unmerged".into(),
            force: true,
        },
    )
    .unwrap();
    assert!(repo.git(&["branch", "--list", "unmerged"]).is_empty());
    assert!(
        run(
            &repo,
            Action::DeleteBranch {
                name: "main".into(),
                force: true
            }
        )
        .is_err()
    );

    repo.git(&["branch", "old-name"]);
    assert_eq!(
        run(
            &repo,
            Action::RenameBranch {
                name: "old-name".into(),
                new_name: "new-name".into()
            }
        )
        .unwrap(),
        "Renamed old-name to new-name"
    );
    assert!(
        repo.git(&["branch", "--list", "new-name"])
            .contains("new-name")
    );
    assert!(
        run(
            &repo,
            Action::RenameBranch {
                name: "new-name".into(),
                new_name: "main".into()
            }
        )
        .is_err()
    );
    assert!(
        run(
            &repo,
            Action::RenameBranch {
                name: "new-name".into(),
                new_name: "bad name".into()
            }
        )
        .is_err()
    );
}

#[test]
fn deletes_remote_branches_and_fetches_in_the_background() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("delete-remote.git");
    let mut alice = TempRepo::new("delete-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    alice.commit("a.txt", "First");
    alice.git(&["push", "--quiet", "origin", "main", "main:feature"]);
    run(&alice, Action::Fetch { background: true }).unwrap();
    assert!(
        !alice
            .git(&["branch", "--remotes", "--list", "origin/feature"])
            .is_empty()
    );

    assert_eq!(
        run(
            &alice,
            Action::DeleteRemoteBranch {
                name: "origin/feature".into()
            }
        )
        .unwrap(),
        "Deleted feature from origin"
    );
    assert!(remote.git(&["branch", "--list", "feature"]).is_empty());
    assert!(
        alice
            .git(&["branch", "--remotes", "--list", "origin/feature"])
            .is_empty()
    );
    assert!(
        run(
            &alice,
            Action::DeleteRemoteBranch {
                name: "origin/missing".into()
            }
        )
        .is_err()
    );
    assert!(
        run(
            &alice,
            Action::DeleteRemoteBranch {
                name: "main".into()
            }
        )
        .is_err()
    );
}

/// Commits made by git itself (merges, rebases, …) need a name to commit under.
fn with_identity(repo: &TempRepo) {
    repo.git(&["config", "user.name", "Test Committer"]);
    repo.git(&["config", "user.email", "committer@example.com"]);
}

fn head(repo: &TempRepo) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

fn parents(repo: &TempRepo, rev: &str) -> usize {
    repo.git(&["rev-list", "--parents", "-n", "1", rev])
        .split_whitespace()
        .count()
        - 1
}

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
                target: "--abort".into()
            }
        )
        .is_err()
    );
    assert!(
        run(
            &repo,
            Action::Merge {
                target: "missing".into()
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
fn loads_only_the_checked_out_branch() {
    let mut repo = TempRepo::new("first-parent");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("b.txt", "feature work");
    repo.git(&["switch", "--quiet", "--create", "unrelated", "main"]);
    repo.commit("d.txt", "elsewhere");
    repo.git(&["switch", "--quiet", "main"]);
    repo.commit("c.txt", "main work");
    repo.git(&["merge", "--quiet", "--no-ff", "--no-edit", "feature"]);

    let all = repo::load(repo.path(), 100, false).unwrap();
    assert_eq!(all.commits.len(), 5);
    let options = LoadOptions {
        limit: 100,
        include_status: false,
        first_parent: true,
        ..LoadOptions::default()
    };
    let own = repo::load_with(repo.path(), options).unwrap();
    let summaries: Vec<&str> = own.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(
        summaries,
        vec!["Merge branch 'feature'", "main work", "base"]
    );
    assert!(own.first_parent);
    assert_eq!(own.lane_count, 1, "a straight line");
    assert_eq!(
        own.commits[0].parents.len(),
        2,
        "the merge still knows both parents"
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
    actions::run_with_progress(alice.path(), Action::Push { force: false }, &|progress| {
        phases.borrow_mut().push(progress.phase)
    })
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

/// Git LFS uploads its files before git's own push, and says nothing about it unless it's
/// writing to a terminal. The push reports those uploads too. Skipped without Git LFS.
#[test]
fn reports_git_lfs_uploads_while_pushing() {
    let installed = Command::new("git")
        .args(["lfs", "version"])
        .output()
        .is_ok_and(|output| output.status.success());
    if !installed {
        eprintln!("Git LFS isn't installed: skipped");
        return;
    }
    let _turn = remote_turn();
    let remote = TempRepo::bare("lfs-remote.git");
    let alice = TempRepo::new("lfs-alice");
    alice.git(&["lfs", "install", "--local"]);
    alice.git(&["lfs", "track", "*.bin"]);
    alice.git(&["remote", "add", "origin", remote.url()]);
    std::fs::write(alice.path().join("video.bin"), vec![7u8; 3_000_000]).unwrap();
    alice.git(&["add", ".gitattributes", "video.bin"]);
    alice.git(&["commit", "--quiet", "-m", "Add a video"]);

    let reports = std::cell::RefCell::new(Vec::new());
    actions::run_with_progress(alice.path(), Action::Push { force: false }, &|progress| {
        reports.borrow_mut().push(progress)
    })
    .unwrap();
    let reports = reports.into_inner();
    let uploads: Vec<_> = reports
        .iter()
        .filter(|progress| progress.phase == "Uploading LFS files")
        .collect();
    assert!(!uploads.is_empty(), "no LFS progress in {reports:?}");
    assert_eq!(uploads.last().unwrap().percent, Some(100));
    assert_eq!(
        uploads.last().unwrap().detail.as_deref(),
        Some("1 of 1 files")
    );
    assert!(
        remote.path().join("lfs/objects").is_dir(),
        "the file reached the remote"
    );
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
    assert!(actions::cancel(), "a fetch was running");
    let result = fetch.join().unwrap();
    assert_eq!(result.unwrap_err(), "Cancelled.");
    assert!(
        started.elapsed().as_secs() < 5,
        "cancelling doesn't wait for the remote"
    );
    assert!(!actions::cancel(), "nothing left to cancel");
}

fn options(limit: usize) -> LoadOptions {
    LoadOptions {
        limit,
        ..LoadOptions::default()
    }
}

#[test]
fn hides_and_solos_branches() {
    let mut repo = TempRepo::new("hide");
    repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("b.txt", "feature work");
    repo.git(&["tag", "v1"]);
    repo.git(&["switch", "--quiet", "--create", "old", "main"]);
    repo.commit("c.txt", "old work");
    repo.git(&["switch", "--quiet", "main"]);
    repo.commit("d.txt", "main work");

    let summaries = |snapshot: &repo::RepoSnapshot| -> Vec<String> {
        snapshot.commits.iter().map(|c| c.summary.clone()).collect()
    };
    let labels = |snapshot: &repo::RepoSnapshot| -> Vec<String> {
        let mut names: Vec<String> = snapshot
            .commits
            .iter()
            .flat_map(|c| c.refs.iter().map(|r| r.name.clone()))
            .collect();
        names.sort();
        names
    };

    let hidden = repo::load_with(
        repo.path(),
        LoadOptions {
            hidden: vec!["refs/heads/old".into(), "refs/heads/main".into()],
            ..options(100)
        },
    )
    .unwrap();
    assert!(!summaries(&hidden).contains(&"old work".to_owned()));
    assert_eq!(
        labels(&hidden),
        vec!["feature", "main", "v1"],
        "the checked-out branch stays"
    );
    assert_eq!(hidden.hidden_refs.len(), 1);
    assert_eq!(hidden.hidden_refs[0].name, "old");
    assert_eq!(hidden.hidden_refs[0].kind, RefKind::Branch);

    let solo = repo::load_with(
        repo.path(),
        LoadOptions {
            solo: vec!["refs/heads/feature".into()],
            ..options(100)
        },
    )
    .unwrap();
    assert_eq!(
        summaries(&solo),
        vec!["main work", "feature work", "base"],
        "the soloed branch and the checked-out one"
    );
    assert_eq!(labels(&solo), vec!["feature", "main"]);
    let hidden_names: Vec<&str> = solo.hidden_refs.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(hidden_names, vec!["old", "v1"]);
}

#[test]
fn reports_commit_times_identity_links_and_fetch_time() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("links-remote.git");
    let mut repo = TempRepo::new("links");
    with_identity(&repo);
    repo.git(&["remote", "add", "origin", remote.url()]);
    repo.commit("a.txt", "First");
    repo.git(&["push", "--quiet", "origin", "main"]);

    let before = repo::load(repo.path(), 100, false).unwrap();
    assert_eq!(before.last_fetched, None);
    assert!(
        before.web_remotes.is_empty(),
        "a local path has no web page"
    );
    let user = before.user.as_ref().unwrap();
    assert_eq!(user.email.as_deref(), Some("committer@example.com"));
    assert_eq!(before.commits[0].commit_time, before.commits[0].time);

    run(&repo, Action::Fetch { background: false }).unwrap();
    repo.git(&[
        "remote",
        "set-url",
        "origin",
        "git@github.com:owner/repo.git",
    ]);
    let after = repo::load(repo.path(), 100, false).unwrap();
    assert!(after.last_fetched.is_some());
    assert_eq!(after.web_remotes.len(), 1);
    assert_eq!(after.web_remotes[0].name, "origin");
    assert_eq!(after.web_remotes[0].url, "https://github.com/owner/repo");
}

#[test]
fn creates_pushes_deletes_and_restores_tags() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("tags-remote.git");
    let mut repo = TempRepo::new("tags");
    with_identity(&repo);
    repo.git(&["remote", "add", "origin", remote.url()]);
    let first = repo.commit("a.txt", "First");
    let second = repo.commit("b.txt", "Second");

    run(
        &repo,
        Action::CreateTag {
            name: "v1".into(),
            id: first.clone(),
            message: None,
        },
    )
    .unwrap();
    run(
        &repo,
        Action::CreateTag {
            name: "v2".into(),
            id: second.clone(),
            message: Some("Release two".into()),
        },
    )
    .unwrap();
    assert_eq!(repo.git(&["rev-parse", "v1^{commit}"]), first);
    assert_eq!(repo.git(&["cat-file", "-t", "v2"]), "tag");
    for (name, error) in [
        ("v1", "already exists"),
        ("bad name", "isn't a valid"),
        ("-x", "isn't a valid"),
    ] {
        let result = run(
            &repo,
            Action::CreateTag {
                name: name.into(),
                id: first.clone(),
                message: None,
            },
        );
        assert!(result.unwrap_err().contains(error), "{name}");
    }

    let snapshot = repo::load(repo.path(), 100, false).unwrap();
    let v2 = snapshot.commits[0]
        .refs
        .iter()
        .find(|r| r.name == "v2")
        .unwrap();
    let tag_object = v2
        .target
        .clone()
        .expect("annotated tags know their tag object");
    assert_eq!(tag_object, repo.git(&["rev-parse", "v2"]));
    let v1 = snapshot.commits[1]
        .refs
        .iter()
        .find(|r| r.name == "v1")
        .unwrap();
    assert_eq!(v1.target, None);

    run(
        &repo,
        Action::PushTag {
            name: "v2".into(),
            remote: None,
        },
    )
    .unwrap();
    assert_eq!(remote.git(&["tag", "--list"]), "v2");
    run(
        &repo,
        Action::DeleteRemoteTag {
            name: "v2".into(),
            remote: "origin".into(),
        },
    )
    .unwrap();
    assert_eq!(remote.git(&["tag", "--list"]), "");

    run(&repo, Action::DeleteTag { name: "v2".into() }).unwrap();
    assert!(run(&repo, Action::DeleteTag { name: "v2".into() }).is_err());
    run(
        &repo,
        Action::RestoreTag {
            name: "v2".into(),
            id: tag_object.clone(),
        },
    )
    .unwrap();
    assert_eq!(
        repo.git(&["rev-parse", "v2"]),
        tag_object,
        "the same annotated tag is back"
    );
    assert_eq!(
        repo.git(&["tag", "--list", "--format=%(contents:subject)", "v2"]),
        "Release two"
    );
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
fn clones_and_creates_repositories() {
    let _turn = remote_turn();
    let mut source = TempRepo::new("clone-source");
    source.commit("a.txt", "First");
    let parent = TempRepo::empty("clone-parent");

    let cloned = actions::clone_repository(source.url(), parent.path(), "copy", &|_| {}).unwrap();
    assert_eq!(cloned, parent.path().join("copy"));
    let snapshot = repo::load(&cloned, 100, false).unwrap();
    assert_eq!(snapshot.commits.len(), 1);
    assert_eq!(snapshot.remotes, vec!["origin"]);

    let again = actions::clone_repository(source.url(), parent.path(), "copy", &|_| {});
    assert!(again.unwrap_err().contains("already exists"));
    let missing = actions::clone_repository("/no/such/repo.git", parent.path(), "broken", &|_| {});
    assert!(missing.is_err());
    assert!(
        !parent.path().join("broken").exists(),
        "a failed clone leaves nothing behind"
    );
    for name in ["", "a/b", ".."] {
        assert!(actions::clone_repository(source.url(), parent.path(), name, &|_| {}).is_err());
    }
    assert!(actions::clone_repository("--upload-pack=x", parent.path(), "x", &|_| {}).is_err());

    let fresh = parent.path().join("fresh");
    std::fs::create_dir(&fresh).unwrap();
    actions::init_repository(&fresh).unwrap();
    assert!(fresh.join(".git").is_dir());
    assert!(repo::load(&fresh, 100, true).unwrap().commits.is_empty());
    assert!(
        actions::init_repository(&fresh)
            .unwrap_err()
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

    let outcome =
        actions::run_with_progress(repo.path(), Action::Push { force: false }, &|_| {}).unwrap();
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
    let mine: Vec<_> = actions::activity()
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

/// Pruning offers local branches whose remote branch is gone or that are merged, never
/// the checked-out branch or long-lived ones, deletes only what still points where it did,
/// and can put them all back, upstreams included.
#[test]
fn prunes_gone_and_merged_branches_and_restores_them() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("prune-remote.git");
    let mut alice = TempRepo::new("prune-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    alice.commit("a.txt", "First");
    alice.git(&["push", "--quiet", "-u", "origin", "main"]);

    // Merged, then deleted on the remote: a merged pull request.
    alice.git(&["switch", "--quiet", "-c", "feat/merged"]);
    alice.commit("merged.txt", "Merged work");
    alice.git(&["push", "--quiet", "-u", "origin", "feat/merged"]);
    // Pushed, then deleted on the remote without being merged here: a squash merge.
    alice.git(&["switch", "--quiet", "-c", "feat/squashed", "main"]);
    alice.commit("squashed.txt", "Squashed work");
    alice.git(&["push", "--quiet", "-u", "origin", "feat/squashed"]);
    // Merged locally, never pushed.
    alice.git(&["switch", "--quiet", "-c", "feat/local", "main"]);
    alice.commit("local.txt", "Local work");
    // Still being worked on.
    alice.git(&["switch", "--quiet", "-c", "feat/active", "main"]);
    alice.commit("active.txt", "Active work");
    alice.git(&["push", "--quiet", "-u", "origin", "feat/active"]);
    alice.git(&["switch", "--quiet", "main"]);
    alice.git(&["merge", "--quiet", "--no-edit", "feat/merged"]);
    alice.git(&["merge", "--quiet", "--no-edit", "feat/local"]);
    alice.git(&["branch", "develop"]);
    alice.git(&["push", "--quiet", "origin", "main"]);
    remote.git(&["branch", "-D", "feat/merged", "feat/squashed"]);
    alice.git(&["fetch", "--quiet", "--prune"]);

    let snapshot = repo::load(alice.path(), 100, false).unwrap();
    assert_eq!(snapshot.gone_branches, ["feat/merged", "feat/squashed"]);

    let info = actions::prune_candidates(alice.path()).unwrap();
    assert_eq!(info.base.as_deref(), Some("origin/main"));
    let found: Vec<(&str, bool, bool, u32)> = info
        .candidates
        .iter()
        .map(|c| (c.name.as_str(), c.gone, c.merged, c.unmerged))
        .collect();
    assert_eq!(
        found,
        [
            ("feat/squashed", true, false, 1),
            ("feat/merged", true, true, 0),
            ("feat/local", false, true, 0),
        ],
        "gone first, newest first; not main, develop or feat/active"
    );
    let squashed = &info.candidates[0];
    assert_eq!(squashed.upstream.as_deref(), Some("origin/feat/squashed"));
    assert_eq!(squashed.remote.as_deref(), Some("origin"));
    assert_eq!(squashed.merge.as_deref(), Some("refs/heads/feat/squashed"));

    let tips: Vec<BranchTip> = info
        .candidates
        .iter()
        .map(|c| BranchTip {
            name: c.name.clone(),
            id: c.id.clone(),
            remote: c.remote.clone(),
            merge: c.merge.clone(),
        })
        .collect();
    // A branch that moved since it was listed is left alone; the others still go.
    let mut stale = tips.clone();
    stale[2].id = alice.git(&["rev-parse", "main~1"]);
    let message = run(&alice, Action::DeleteBranches { branches: stale }).unwrap();
    assert_eq!(
        message,
        "Deleted 2 branches. Couldn't delete feat/local (it has new commits since)"
    );
    let left = alice.git(&["branch", "--format=%(refname:short)"]);
    assert_eq!(
        left.lines().collect::<Vec<_>>(),
        ["develop", "feat/active", "feat/local", "main"]
    );

    assert_eq!(
        run(
            &alice,
            Action::RestoreBranches {
                branches: tips[..2].to_vec()
            }
        )
        .unwrap(),
        "Restored 2 branches"
    );
    assert_eq!(alice.git(&["rev-parse", "feat/squashed"]), squashed.id);
    assert_eq!(
        alice.git(&["config", "branch.feat/squashed.remote"]),
        "origin"
    );
    assert_eq!(
        alice.git(&["config", "branch.feat/squashed.merge"]),
        "refs/heads/feat/squashed"
    );
    // Undoing the whole prune skips the branch that was never deleted.
    assert_eq!(
        run(
            &alice,
            Action::RestoreBranches {
                branches: tips.clone()
            }
        )
        .unwrap(),
        "Nothing to restore: the branches are all there"
    );
    // Restoring over a branch that has since moved is refused.
    alice.git(&["branch", "--force", "feat/local", "main~1"]);
    assert!(
        run(
            &alice,
            Action::RestoreBranches {
                branches: tips[2..].to_vec()
            }
        )
        .is_err()
    );
}

fn restore(repo: &TempRepo, reference: &str) -> Result<String, String> {
    run(
        repo,
        Action::RestoreBackup {
            reference: reference.into(),
        },
    )
}

fn find_backup(repo: &TempRepo, event: &str) -> actions::Backup {
    actions::backups(repo.path())
        .unwrap()
        .into_iter()
        .find(|b| b.event == event)
        .unwrap_or_else(|| panic!("no {event} backup"))
}

/// Deleting, resetting, rebasing and force-pushing keep a backup of where the branch was
/// (out of the graph), which can be put back without overwriting anything; deleting says
/// what would be lost; deleting from the remote can be undone.
#[test]
fn keeps_backups_of_changed_branches_and_restores_them() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("backup-remote.git");
    let mut alice = TempRepo::new("backup-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    let first = alice.commit("a.txt", "First");
    alice.git(&["push", "--quiet", "-u", "origin", "main"]);
    alice.git(&["switch", "--quiet", "-c", "feat/x"]);
    let x = alice.commit("x.txt", "X work");
    alice.git(&["switch", "--quiet", "main"]);

    // What deleting would lose: feat/x's own commit; nothing for main, which is on origin.
    let lost = actions::lost_commits(alice.path(), "refs/heads/feat/x").unwrap();
    assert_eq!(lost.count, 1);
    assert_eq!(
        (
            lost.commits[0].id.as_str(),
            lost.commits[0].summary.as_str()
        ),
        (x.as_str(), "X work")
    );
    assert_eq!(
        actions::lost_commits(alice.path(), "refs/heads/main")
            .unwrap()
            .count,
        0
    );

    // Deleting keeps a backup, which isn't drawn in the graph and can be restored.
    run(
        &alice,
        Action::DeleteBranch {
            name: "feat/x".into(),
            force: true,
        },
    )
    .unwrap();
    let snapshot = repo::load(alice.path(), 100, false).unwrap();
    assert!(
        snapshot.commits.iter().all(|c| c.id != x),
        "backups stay out of the graph"
    );
    let backups = actions::backups(alice.path()).unwrap();
    assert_eq!(backups.len(), 1);
    let deleted = &backups[0];
    assert_eq!(
        (
            deleted.event.as_str(),
            deleted.name.as_str(),
            deleted.remote,
            deleted.id.as_str()
        ),
        ("deleted", "feat/x", false, x.as_str())
    );
    assert_eq!(
        (deleted.summary.as_str(), deleted.current.as_deref()),
        ("X work", None)
    );
    assert_eq!(
        restore(&alice, &deleted.reference).unwrap(),
        "Restored feat/x"
    );
    assert_eq!(alice.git(&["rev-parse", "feat/x"]), x);
    assert_eq!(
        restore(&alice, &deleted.reference).unwrap(),
        "feat/x is already there, as it was"
    );

    // A hard reset keeps the old tip; restoring puts it beside the moved branch.
    let second = alice.commit("b.txt", "Second");
    run(&alice, Action::ResetHard { id: first.clone() }).unwrap();
    let reset = find_backup(&alice, "reset");
    assert_eq!(
        (
            reset.name.as_str(),
            reset.id.as_str(),
            reset.current.as_deref()
        ),
        ("main", second.as_str(), Some(first.as_str()))
    );
    assert_eq!(
        restore(&alice, &reset.reference).unwrap(),
        "main has changed since, so its earlier version is now the branch main-restored"
    );
    assert_eq!(alice.git(&["rev-parse", "main-restored"]), second);

    // A force push keeps what it replaced on the remote.
    alice.git(&["push", "--quiet", "origin", "main-restored:main"]);
    alice.git(&["fetch", "--quiet"]);
    run(&alice, Action::Push { force: true }).unwrap();
    assert_eq!(remote.git(&["rev-parse", "main"]), first);
    let pushed = find_backup(&alice, "forcePushed");
    assert_eq!(
        (pushed.name.as_str(), pushed.remote, pushed.id.as_str()),
        ("origin/main", true, second.as_str())
    );
    assert_eq!(
        restore(&alice, &pushed.reference).unwrap(),
        "The earlier version of origin/main is now the local branch main-before-force-push"
    );
    assert_eq!(alice.git(&["rev-parse", "main-before-force-push"]), second);

    // A rebase keeps the branch's old tip.
    alice.git(&["switch", "--quiet", "-c", "feat/y"]);
    let y = alice.commit("y.txt", "Y work");
    alice.git(&["switch", "--quiet", "main"]);
    alice.commit("c.txt", "Third");
    alice.git(&["switch", "--quiet", "feat/y"]);
    run(
        &alice,
        Action::Rebase {
            onto: "main".into(),
        },
    )
    .unwrap();
    let rebased = find_backup(&alice, "rebased");
    assert_eq!(
        (rebased.name.as_str(), rebased.id.as_str()),
        ("feat/y", y.as_str())
    );

    // Deleting from the remote: undo pushes it back, and so does its backup.
    alice.git(&["push", "--quiet", "origin", "feat/x"]);
    alice.git(&["fetch", "--quiet"]);
    assert_eq!(
        actions::lost_commits(alice.path(), "refs/remotes/origin/feat/x")
            .unwrap()
            .count,
        0,
        "feat/x is still a local branch"
    );
    run(
        &alice,
        Action::DeleteRemoteBranch {
            name: "origin/feat/x".into(),
        },
    )
    .unwrap();
    assert_eq!(
        run(
            &alice,
            Action::RestoreRemoteBranch {
                name: "origin/feat/x".into(),
                id: x.clone()
            }
        )
        .unwrap(),
        "Pushed feat/x back to origin"
    );
    assert_eq!(remote.git(&["rev-parse", "feat/x"]), x);
    run(
        &alice,
        Action::DeleteRemoteBranch {
            name: "origin/feat/x".into(),
        },
    )
    .unwrap();
    let from_remote = find_backup(&alice, "deletedFromRemote");
    assert_eq!(
        restore(&alice, &from_remote.reference).unwrap(),
        "Pushed feat/x back to origin"
    );
    assert_eq!(remote.git(&["rev-parse", "feat/x"]), x);

    // Backups can be removed.
    let count = actions::backups(alice.path()).unwrap().len();
    run(
        &alice,
        Action::RemoveBackup {
            reference: from_remote.reference,
        },
    )
    .unwrap();
    assert_eq!(actions::backups(alice.path()).unwrap().len(), count - 1);
}
