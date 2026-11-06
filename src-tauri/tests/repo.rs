//! End-to-end tests for reading a repository. They build small repositories with
//! the `git` command line tool, which must be installed.

use std::path::{Path, PathBuf};
use std::process::Command;

use tributary_lib::repo::{self, FileChange, FileStatus, RefKind, RowKind};

struct TempRepo {
    dir: PathBuf,
    clock: i64,
}

impl TempRepo {
    fn new(name: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("tributary-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // An empty global config keeps the developer's own settings (signing, hooks, …) out of the tests.
        std::fs::write(dir.join(".test-gitconfig"), "").unwrap();
        let repo = TempRepo {
            dir,
            clock: 1_700_000_000,
        };
        repo.git(&["init", "--quiet", "--initial-branch=main"]);
        std::fs::write(repo.dir.join(".git/info/exclude"), ".test-gitconfig\n").unwrap();
        repo
    }

    fn git(&self, args: &[&str]) -> String {
        self.git_at(args, self.clock)
    }

    fn git_at(&self, args: &[&str], time: i64) -> String {
        let date = format!("@{time} +0000");
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.dir)
            .env("GIT_CONFIG_GLOBAL", self.dir.join(".test-gitconfig"))
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
