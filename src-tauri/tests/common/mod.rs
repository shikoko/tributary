//! Helpers shared by the integration tests: throwaway repositories built with the `git`
//! command line tool (which must be installed), and small checks.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]
// Each test file uses some of these.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

use tributary_lib::actions::{self, Action};
use tributary_lib::repo::{FileChange, FileStatus, LoadOptions};

pub struct TempRepo {
    dir: PathBuf,
    pub clock: i64,
}

/// The app's own git (the code under test) runs with this process's environment, so
/// unlike the tests' own git it would read this computer's git config: Git for Windows'
/// system config turns on `core.autocrlf` and `pull.ff=only`, and a developer's own may
/// sign commits or rebase on pull. Give it no system config, and a global one with
/// nothing but Git LFS set up (as `git lfs install` does), where it's installed.
fn keep_this_computers_git_config_out() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let global = Path::new(env!("CARGO_TARGET_TMPDIR")).join("tributary-tests.gitconfig");
        let lfs = "[filter \"lfs\"]\n\
                   \tclean = git-lfs clean -- %f\n\
                   \tsmudge = git-lfs smudge -- %f\n\
                   \tprocess = git-lfs filter-process\n\
                   \trequired = true\n";
        std::fs::write(&global, if lfs_installed() { lfs } else { "" }).unwrap();
        // SAFETY: this runs once, as the first test repository is made (tests make theirs
        // before running the app's code on it). Other tests' threads may be running, but
        // they read the environment only through Rust's own `Command` and `env::var`,
        // which take the same lock as `set_var`: nothing here reads it through C.
        #[allow(unsafe_code)]
        unsafe {
            std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
            std::env::set_var("GIT_CONFIG_GLOBAL", &global);
        }
    });
}

impl TempRepo {
    /// An empty folder, with an empty git config next to it.
    pub fn empty(name: &str) -> Self {
        keep_this_computers_git_config_out();
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

    pub fn new(name: &str) -> Self {
        let repo = Self::empty(name);
        repo.git(&["init", "--quiet", "--initial-branch=main"]);
        repo
    }

    /// A bare repository, to use as a remote.
    pub fn bare(name: &str) -> Self {
        let repo = Self::empty(name);
        repo.git(&["init", "--quiet", "--bare", "--initial-branch=main"]);
        repo
    }

    /// A clone of `remote`.
    pub fn clone_of(name: &str, remote: &TempRepo) -> Self {
        let repo = Self::empty(name);
        repo.git(&["clone", "--quiet", remote.url(), "."]);
        repo
    }

    pub fn url(&self) -> &str {
        self.dir.to_str().unwrap()
    }

    pub fn git(&self, args: &[&str]) -> String {
        self.git_at(args, self.clock)
    }

    pub fn git_at(&self, args: &[&str], time: i64) -> String {
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
    pub fn commit(&mut self, file: &str, message: &str) -> String {
        self.clock += 60;
        std::fs::write(self.dir.join(file), message).unwrap();
        self.git(&["add", file]);
        self.git(&["commit", "--quiet", "-m", message]);
        self.git(&["rev-parse", "HEAD"])
    }

    pub fn path(&self) -> &Path {
        &self.dir
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
        let _ = std::fs::remove_file(self.dir.with_extension("gitconfig"));
    }
}

pub fn files(changes: &[FileChange]) -> Vec<(&str, FileStatus)> {
    changes
        .iter()
        .map(|f| (f.path.as_str(), f.status))
        .collect()
}

/// Run an action, with its error as the message the app would show.
pub fn run(repo: &TempRepo, action: Action) -> Result<String, String> {
    actions::run(repo.path(), action).map_err(|e| e.to_string())
}

/// Fetches, pulls and pushes can be cancelled all at once, so the tests that run them
/// take turns: cancelling in one test must not stop another test's push.
pub static REMOTE_TESTS: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn remote_turn() -> std::sync::MutexGuard<'static, ()> {
    REMOTE_TESTS.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn stash_count(repo: &TempRepo) -> usize {
    repo.git(&["stash", "list"]).lines().count()
}

pub fn read(repo: &TempRepo, file: &str) -> String {
    std::fs::read_to_string(repo.path().join(file)).unwrap()
}

/// Commits made by git itself (merges, rebases, …) need a name to commit under.
pub fn with_identity(repo: &TempRepo) {
    repo.git(&["config", "user.name", "Test Committer"]);
    repo.git(&["config", "user.email", "committer@example.com"]);
}

pub fn head(repo: &TempRepo) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

pub fn parents(repo: &TempRepo, rev: &str) -> usize {
    repo.git(&["rev-list", "--parents", "-n", "1", rev])
        .split_whitespace()
        .count()
        - 1
}

pub fn options(limit: usize) -> LoadOptions {
    LoadOptions {
        limit,
        ..LoadOptions::default()
    }
}

pub fn outcome(repo: &TempRepo, action: Action) -> actions::Outcome {
    actions::run_with_progress(repo.path(), action, &|_| {}).unwrap()
}

/// Whether names that differ only in capitals are one file in `dir`, as on Windows and
/// (usually) macOS: there, `Maps` and `maps` can't both be made.
pub fn ignores_case(dir: &Path) -> bool {
    let probe = dir.join("case-probe");
    std::fs::write(&probe, "").unwrap();
    let same = dir.join("CASE-PROBE").exists();
    std::fs::remove_file(&probe).unwrap();
    same
}

pub fn lfs_installed() -> bool {
    Command::new("git")
        .args(["lfs", "version"])
        .output()
        .is_ok_and(|output| output.status.success())
}
