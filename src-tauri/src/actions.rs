//! Actions that change a repository. They run the user's own `git`, so they behave
//! exactly like git does on the command line (line endings, LFS, filters, …).

use std::path::{Path, PathBuf};
use std::process::Command;

use gix::ObjectId;

type Error = String;

/// `git reset --hard <id>`: move the checked-out branch (or a detached HEAD) to `id`,
/// and make the index and working tree match it. Untracked files are kept.
pub fn reset_hard(path: &Path, id: &str) -> Result<(), Error> {
    // Only accept a full commit id, so nothing else can end up on git's command line.
    let oid = ObjectId::from_hex(id.as_bytes()).map_err(|_| format!("Invalid commit id {id}"))?;
    let repo = gix::discover(path)
        .map_err(|e| format!("{} is not a git repository ({e})", path.display()))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree, so it can't be reset.")?
        .to_owned();
    repo.find_commit(oid)
        .map_err(|e| format!("Could not find commit {id}: {e}"))?;

    run_git(&workdir, &["reset", "--hard", "--quiet", &oid.to_string()])
}

fn run_git(workdir: &Path, args: &[&str]) -> Result<(), Error> {
    let git = find_git().ok_or(
        "Resetting needs git, which wasn't found. Install it from https://git-scm.com and try again.",
    )?;
    let mut command = Command::new(git);
    command
        .arg("-C")
        .arg(workdir)
        .args(args)
        // Never wait for input that nobody can give.
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Don't flash a console window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|e| format!("Could not run git: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();
        Err(if message.is_empty() {
            format!("git {} failed ({})", args.join(" "), output.status)
        } else {
            message.to_owned()
        })
    }
}

/// The `git` executable. Apps started from the macOS Finder don't get the shell's
/// `PATH`, so common install locations are tried as well.
fn find_git() -> Option<PathBuf> {
    let works = |candidate: &Path| {
        let mut command = Command::new(candidate);
        command.arg("--version");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        command.output().is_ok_and(|output| output.status.success())
    };
    let candidates = [
        "git",
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
        "/usr/bin/git",
    ];
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|candidate| works(candidate))
}
