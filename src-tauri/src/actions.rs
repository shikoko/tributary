//! Actions that change a repository. They run the user's own `git`, so they behave
//! exactly like git does on the command line (line endings, LFS, hooks, credentials, …).
//!
//! Every value that ends up on git's command line is checked first (commit ids must
//! be full ids of existing commits, branch and remote names must exist or be valid),
//! so nothing can be mistaken for a git option.

use std::path::{Path, PathBuf};
use std::process::Command;

use gix::ObjectId;
use gix::bstr::ByteSlice;
use serde::Deserialize;

type Error = String;

/// Something to do to the repository, as sent by the frontend.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    /// `git reset --hard <id>` on the checked-out branch.
    ResetHard { id: String },
    /// Switch to a local branch.
    CheckoutBranch { name: String },
    /// Create a local branch tracking a remote branch like `origin/feature`, and switch to it.
    CheckoutRemoteBranch { name: String },
    /// Check out a commit without a branch (detached HEAD).
    CheckoutCommit { id: String },
    /// Create a branch at a commit, and optionally switch to it.
    CreateBranch {
        name: String,
        id: String,
        checkout: bool,
    },
    /// Fetch from every remote. `background` fetches never show sign-in prompts.
    Fetch {
        #[serde(default)]
        background: bool,
    },
    /// Pull into the checked-out branch.
    Pull,
    /// Push the checked-out branch, setting its upstream if it has none.
    /// `force` uses `--force-with-lease`.
    Push { force: bool },
    /// Stash uncommitted changes, run `action`, then put the changes back.
    StashAndRetry {
        action: Box<Action>,
        #[serde(default, rename = "includeUntracked")]
        include_untracked: bool,
    },
    /// `git stash push`.
    StashPush {
        message: Option<String>,
        #[serde(default, rename = "includeUntracked")]
        include_untracked: bool,
    },
    /// Apply `stash@{index}`, which must be the stash commit `id`, and keep it.
    StashApply { index: usize, id: String },
    /// Apply `stash@{index}` and remove it from the stash list.
    StashPop { index: usize, id: String },
    /// Remove `stash@{index}` without applying it.
    StashDrop { index: usize, id: String },
    /// Stage files (`git add`).
    Stage { paths: Vec<String> },
    /// Unstage files, keeping their changes in the working tree.
    Unstage { paths: Vec<String> },
    /// Stage every change, including untracked files.
    StageAll,
    /// Unstage everything.
    UnstageAll,
    /// Commit the staged changes, or amend the last commit.
    Commit { message: String, amend: bool },
    /// `git reset --soft <id>`: move the branch, keeping all changes staged.
    ResetSoft { id: String },
    /// Delete a local branch. Without `force`, git refuses if it isn't merged.
    DeleteBranch { name: String, force: bool },
    /// Delete a branch like `origin/feature` from its remote.
    DeleteRemoteBranch { name: String },
    /// Rename a local branch.
    RenameBranch {
        name: String,
        #[serde(rename = "newName")]
        new_name: String,
    },
}

/// Run `action` and return a short message saying what happened.
pub fn run(path: &Path, action: Action) -> Result<String, Error> {
    let repo = gix::discover(path)
        .map_err(|e| format!("{} is not a git repository ({e})", path.display()))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree, so this can't be done here.")?
        .to_owned();
    let git = Git::find(workdir)?;

    match action {
        Action::ResetHard { id } => {
            let id = commit_id(&repo, &id)?;
            let branch = current_branch(&repo).unwrap_or_else(|_| "HEAD".into());
            git.run(&["reset", "--hard", "--quiet", &id.to_string()])?;
            Ok(format!("Reset {branch} to {}", id.to_hex_with_len(7)))
        }
        Action::CheckoutBranch { name } => {
            require_ref(&repo, &format!("refs/heads/{name}"), &name)?;
            git.run(&["switch", "--quiet", &name])?;
            Ok(format!("Checked out {name}"))
        }
        Action::CheckoutRemoteBranch { name } => {
            require_ref(&repo, &format!("refs/remotes/{name}"), &name)?;
            let local = name
                .split_once('/')
                .map_or(name.as_str(), |(_, branch)| branch);
            git.run(&["switch", "--quiet", "--track", &name])?;
            Ok(format!("Checked out {local}, tracking {name}"))
        }
        Action::CheckoutCommit { id } => {
            let id = commit_id(&repo, &id)?;
            git.run(&["switch", "--quiet", "--detach", &id.to_string()])?;
            Ok(format!(
                "Checked out {} (detached HEAD)",
                id.to_hex_with_len(7)
            ))
        }
        Action::CreateBranch { name, id, checkout } => {
            let name = name.trim().to_owned();
            check_new_branch_name(&repo, &git, &name)?;
            let id = commit_id(&repo, &id)?.to_string();
            if checkout {
                git.run(&["switch", "--quiet", "--create", &name, &id])?;
                Ok(format!("Created and checked out {name}"))
            } else {
                git.run(&["branch", &name, &id])?;
                Ok(format!("Created {name}"))
            }
        }
        Action::Fetch { background } => {
            if repo.remote_names().is_empty() {
                return Err("This repository has no remotes to fetch from.".into());
            }
            let args = ["fetch", "--all", "--prune", "--quiet"];
            if background {
                // Nobody asked for this fetch, so never pop up a sign-in window for it.
                git.run_with_env(&args, &[("GCM_INTERACTIVE", "never")])?;
            } else {
                git.run(&args)?;
            }
            Ok("Fetched from all remotes".into())
        }
        Action::Pull => {
            let branch = current_branch(&repo)?;
            // `--no-edit`: never wait for a merge message in an editor nobody can see.
            let mut args = vec!["pull", "--no-edit", "--quiet"];
            // Without a merge-or-rebase preference, git refuses to pull a branch that has
            // diverged from its upstream. Merge then, like `git pull` used to by default.
            let config = repo.config_snapshot();
            let has_preference = [
                "pull.rebase".to_owned(),
                "pull.ff".to_owned(),
                format!("branch.{branch}.rebase"),
            ]
            .iter()
            .any(|key| config.string(key.as_str()).is_some());
            if !has_preference {
                args.push("--no-rebase");
            }
            git.run(&args)?;
            Ok(format!("Pulled {branch}"))
        }
        Action::Push { force } => {
            let branch = current_branch(&repo)?;
            let mut args = vec!["push".to_owned(), "--quiet".to_owned()];
            if force {
                args.push("--force-with-lease".into());
            }
            let remote = match push_target(&repo, &branch) {
                Some((remote, remote_branch)) => {
                    args.extend([remote.clone(), format!("HEAD:{remote_branch}")]);
                    remote
                }
                None => {
                    let remote = default_remote(&repo)?;
                    args.extend(["--set-upstream".into(), remote.clone(), "HEAD".into()]);
                    remote
                }
            };
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            git.run(&args)?;
            Ok(format!(
                "{} {branch} to {remote}",
                if force { "Force pushed" } else { "Pushed" }
            ))
        }
        Action::StashAndRetry {
            action,
            include_untracked,
        } => {
            if matches!(*action, Action::StashAndRetry { .. }) {
                return Err("Nested retries aren't supported.".into());
            }
            let before = stash_top(&git);
            let mut args = vec![
                "stash",
                "push",
                "--quiet",
                "--message",
                "Tributary: stashed to retry",
            ];
            if include_untracked {
                args.push("--include-untracked");
            }
            git.run(&args)?;
            if stash_top(&git) == before {
                // Nothing was stashed after all.
                return run(path, *action);
            }
            match run(path, *action) {
                Err(error) => match pop_stash(&git) {
                    Ok(()) => Err(error),
                    Err(_) => Err(format!(
                        "{error}\n\nYour changes couldn't be put back automatically. They're saved as stash@{{0}}."
                    )),
                },
                Ok(message) => match pop_stash(&git) {
                    Ok(()) => Ok(format!("{message}, and put your changes back")),
                    Err(conflict) => Err(format!(
                        "{message}, but your changes conflict with it. Resolve the conflicts in the marked files; \
                         your changes are also still saved as stash@{{0}}.\n\n{conflict}"
                    )),
                },
            }
        }
        Action::StashPush {
            message,
            include_untracked,
        } => {
            let before = stash_top(&git);
            let mut args = vec!["stash", "push", "--quiet"];
            if include_untracked {
                args.push("--include-untracked");
            }
            let message = message
                .map(|m| m.trim().to_owned())
                .filter(|m| !m.is_empty());
            if let Some(message) = &message {
                args.extend(["--message", message]);
            }
            git.run(&args)?;
            if stash_top(&git) == before {
                return Err("There are no changes to stash.".into());
            }
            Ok("Stashed your changes as stash@{0}".into())
        }
        Action::StashApply { index, id } => {
            let name = stash_name(&git, index, &id)?;
            git.run(&["stash", "apply", "--quiet", &name])?;
            Ok(format!("Applied {name}"))
        }
        Action::StashPop { index, id } => {
            let name = stash_name(&git, index, &id)?;
            git.run(&["stash", "pop", "--quiet", &name])?;
            Ok(format!("Applied and removed {name}"))
        }
        Action::StashDrop { index, id } => {
            let name = stash_name(&git, index, &id)?;
            git.run(&["stash", "drop", "--quiet", &name])?;
            Ok(format!("Dropped {name}"))
        }
        Action::Stage { paths } => {
            let paths = check_paths(&paths)?;
            let mut args = vec!["add", "--"];
            args.extend(&paths);
            git.run(&args)?;
            Ok(format!("Staged {}", count(paths.len(), "file")))
        }
        Action::Unstage { paths } => {
            let paths = check_paths(&paths)?;
            let mut args = if repo.head_id().is_ok() {
                vec!["restore", "--staged", "--"]
            } else {
                // Nothing is committed yet, so there's no HEAD to restore from.
                vec!["rm", "--cached", "--quiet", "-r", "--"]
            };
            args.extend(&paths);
            git.run(&args)?;
            Ok(format!("Unstaged {}", count(paths.len(), "file")))
        }
        Action::StageAll => {
            git.run(&["add", "--all"])?;
            Ok("Staged all changes".into())
        }
        Action::UnstageAll => {
            if repo.head_id().is_ok() {
                git.run(&["reset", "--quiet"])?;
            } else {
                git.run(&["rm", "--cached", "--quiet", "-r", "."])?;
            }
            Ok("Unstaged all changes".into())
        }
        Action::Commit { message, amend } => {
            let message = message.trim();
            if message.is_empty() {
                return Err("Write a commit message first.".into());
            }
            let mut args = vec!["commit", "--quiet", "--cleanup=strip", "--message", message];
            if amend {
                args.push("--amend");
            }
            git.run(&args)?;
            let id = git.run(&["rev-parse", "--short", "HEAD"])?;
            let summary = message.lines().next().unwrap_or_default();
            Ok(format!(
                "{} {}: {summary}",
                if amend { "Amended" } else { "Committed" },
                id.trim()
            ))
        }
        Action::ResetSoft { id } => {
            let id = commit_id(&repo, &id)?;
            let branch = current_branch(&repo).unwrap_or_else(|_| "HEAD".into());
            git.run(&["reset", "--soft", "--quiet", &id.to_string()])?;
            Ok(format!(
                "Moved {branch} back to {}; the changes are staged",
                id.to_hex_with_len(7)
            ))
        }
        Action::DeleteBranch { name, force } => {
            require_ref(&repo, &format!("refs/heads/{name}"), &name)?;
            if current_branch(&repo).ok().as_deref() == Some(name.as_str()) {
                return Err(format!(
                    "{name} is checked out. Check out another branch first."
                ));
            }
            git.run(&["branch", if force { "-D" } else { "-d" }, &name])?;
            Ok(format!("Deleted branch {name}"))
        }
        Action::DeleteRemoteBranch { name } => {
            require_ref(&repo, &format!("refs/remotes/{name}"), &name)?;
            let (remote, branch) = name
                .split_once('/')
                .ok_or_else(|| format!("{name} isn't a remote branch."))?;
            let is_remote = repo
                .remote_names()
                .iter()
                .any(|known| known.to_str_lossy() == remote);
            if !is_remote || branch.starts_with('-') {
                return Err(format!("{name} isn't a remote branch."));
            }
            git.run(&["push", "--quiet", remote, "--delete", branch])?;
            Ok(format!("Deleted {branch} from {remote}"))
        }
        Action::RenameBranch { name, new_name } => {
            require_ref(&repo, &format!("refs/heads/{name}"), &name)?;
            let new_name = new_name.trim();
            check_new_branch_name(&repo, &git, new_name)?;
            git.run(&["branch", "--move", &name, new_name])?;
            Ok(format!("Renamed {name} to {new_name}"))
        }
    }
}

/// The id of the newest stash, if there is one.
fn stash_top(git: &Git) -> Option<String> {
    git.run(&["rev-parse", "--quiet", "--verify", "refs/stash"])
        .ok()
}

/// Put the newest stash back, with its staged changes staged again when possible.
fn pop_stash(git: &Git) -> Result<(), Error> {
    match git.run(&["stash", "pop", "--quiet", "--index"]) {
        Err(error) if error.contains("--index") => git.run(&["stash", "pop", "--quiet"]).map(drop),
        result => result.map(drop),
    }
}

/// `stash@{index}`, after checking that it still is the stash the user picked.
fn stash_name(git: &Git, index: usize, id: &str) -> Result<String, Error> {
    let name = format!("stash@{{{index}}}");
    let actual = git
        .run(&["rev-parse", "--quiet", "--verify", &name])
        .unwrap_or_default();
    if actual.trim() != id {
        return Err("The stash list changed. Refresh and try again.".into());
    }
    Ok(name)
}

fn check_paths(paths: &[String]) -> Result<Vec<&str>, Error> {
    if paths.is_empty() {
        return Err("No files given.".into());
    }
    Ok(paths.iter().map(String::as_str).collect())
}

fn count(n: usize, word: &str) -> String {
    format!("{n} {word}{}", if n == 1 { "" } else { "s" })
}

/// The full id of an existing commit, from its full hex id.
fn commit_id(repo: &gix::Repository, id: &str) -> Result<ObjectId, Error> {
    let oid = ObjectId::from_hex(id.as_bytes()).map_err(|_| format!("Invalid commit id {id}"))?;
    repo.find_commit(oid)
        .map_err(|e| format!("Could not find commit {id}: {e}"))?;
    Ok(oid)
}

fn require_ref(repo: &gix::Repository, full_name: &str, name: &str) -> Result<(), Error> {
    if name.starts_with('-') || repo.try_find_reference(full_name).ok().flatten().is_none() {
        return Err(format!("There is no branch called {name}."));
    }
    Ok(())
}

/// The short name of the checked-out branch.
fn current_branch(repo: &gix::Repository) -> Result<String, Error> {
    repo.head_name()
        .ok()
        .flatten()
        .and_then(|name| {
            name.as_bstr()
                .to_str()
                .ok()?
                .strip_prefix("refs/heads/")
                .map(str::to_owned)
        })
        .ok_or_else(|| "Check out a branch first: HEAD is detached.".into())
}

fn check_new_branch_name(repo: &gix::Repository, git: &Git, name: &str) -> Result<(), Error> {
    if name.is_empty() {
        return Err("Enter a name for the new branch.".into());
    }
    if name.starts_with('-') || git.run(&["check-ref-format", "--branch", name]).is_err() {
        return Err(format!(
            "\"{name}\" isn't a valid branch name. Avoid spaces and characters like ~ ^ : ? * [ \\."
        ));
    }
    if repo
        .try_find_reference(format!("refs/heads/{name}").as_str())
        .ok()
        .flatten()
        .is_some()
    {
        return Err(format!("A branch called {name} already exists."));
    }
    Ok(())
}

/// Where the checked-out `branch` pushes to: its remote and the remote branch it
/// tracks, from the branch's configuration.
fn push_target(repo: &gix::Repository, branch: &str) -> Option<(String, String)> {
    let remote = repo
        .branch_remote_name(branch, gix::remote::Direction::Push)?
        .as_bstr()
        .to_str()
        .ok()?
        .to_owned();
    let full_name: gix::refs::FullName = format!("refs/heads/{branch}").try_into().ok()?;
    let merge = repo
        .branch_remote_ref_name(full_name.as_ref(), gix::remote::Direction::Fetch)?
        .ok()?;
    let merge = merge.as_bstr().to_str().ok()?.to_owned();
    (!remote.starts_with('-') && merge.starts_with("refs/")).then_some((remote, merge))
}

/// The remote to push a branch without an upstream to: the configured default,
/// `origin`, or the only remote there is.
fn default_remote(repo: &gix::Repository) -> Result<String, Error> {
    let names: Vec<String> = repo
        .remote_names()
        .iter()
        .map(|name| name.to_str_lossy().into_owned())
        .collect();
    let configured = repo
        .remote_default_name(gix::remote::Direction::Push)
        .map(|name| name.to_str_lossy().into_owned());
    let remote = configured
        .filter(|name| names.contains(name))
        .or_else(|| names.iter().find(|name| *name == "origin").cloned())
        .or_else(|| (names.len() == 1).then(|| names[0].clone()))
        .ok_or_else(|| {
            if names.is_empty() {
                "This repository has no remote to push to.".to_owned()
            } else {
                format!(
                    "This branch has no upstream and there are several remotes ({}). Push it once with git to choose one.",
                    names.join(", ")
                )
            }
        })?;
    if remote.starts_with('-') {
        return Err(format!("Unsupported remote name {remote}"));
    }
    Ok(remote)
}

/// The `git` executable, run inside one working tree.
struct Git {
    executable: PathBuf,
    workdir: PathBuf,
}

impl Git {
    /// Apps started from the macOS Finder don't get the shell's `PATH`, so common
    /// install locations are tried as well.
    fn find(workdir: PathBuf) -> Result<Self, Error> {
        let candidates = [
            "git",
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/usr/bin/git",
        ];
        let executable = candidates
            .iter()
            .map(PathBuf::from)
            .find(|candidate| {
                command(candidate)
                    .arg("--version")
                    .output()
                    .is_ok_and(|output| output.status.success())
            })
            .ok_or("This needs git, which wasn't found. Install it from https://git-scm.com and try again.")?;
        Ok(Git {
            executable,
            workdir,
        })
    }

    /// Run git with `args`, returning its output, or its error message.
    fn run(&self, args: &[&str]) -> Result<String, Error> {
        self.run_with_env(args, &[])
    }

    fn run_with_env(&self, args: &[&str], env: &[(&str, &str)]) -> Result<String, Error> {
        let output = command(&self.executable)
            .arg("-C")
            .arg(&self.workdir)
            .args(args)
            .envs(env.iter().copied())
            // Nobody can answer a prompt or edit a message here: fail or accept the default.
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_MERGE_AUTOEDIT", "no")
            .output()
            .map_err(|e| format!("Could not run git: {e}"))?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();
        if message.contains("terminal prompts disabled")
            || message.contains("could not read Username")
        {
            return Err(format!(
                "Git needs your credentials for this remote. Sign in once with git in a terminal \
                 (or set up a credential helper), then try again.\n\n{message}"
            ));
        }
        Err(if message.is_empty() {
            format!("git {} failed ({})", args.join(" "), output.status)
        } else {
            message.to_owned()
        })
    }
}

fn command(executable: &Path) -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut command = Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Don't flash a console window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}
