//! Actions that change a repository. They run the user's own `git`, so they behave
//! exactly like git does on the command line (line endings, LFS, hooks, credentials, …).
//!
//! Every value that ends up on git's command line is checked first (commit ids must
//! be full ids of existing commits, branch and remote names must exist or be valid),
//! so nothing can be mistaken for a git option.

use std::collections::VecDeque;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use gix::ObjectId;
use gix::bstr::ByteSlice;
use serde::{Deserialize, Serialize};

use crate::links;

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
    /// Merge a branch, tag or commit into the checked-out branch.
    Merge { target: String },
    /// Rebase the checked-out branch onto a branch, tag or commit.
    Rebase { onto: String },
    /// Apply the changes of a commit on top of the checked-out branch.
    CherryPick { id: String },
    /// Make a new commit that undoes a commit.
    Revert { id: String },
    /// Carry on with a merge, rebase, cherry-pick or revert after resolving conflicts.
    ContinueOperation,
    /// Leave out the commit a rebase, cherry-pick or revert stopped at.
    SkipCommit,
    /// Give up on a merge, rebase, cherry-pick or revert, going back to how things were.
    AbortOperation,
    /// Cherry-pick several commits, in the order given (oldest first).
    CherryPickMany { ids: Vec<String> },
    /// Revert several commits, in the order given (newest first).
    RevertMany { ids: Vec<String> },
    /// Rewrite the commits after `onto` on the checked-out branch: reorder, reword,
    /// squash, fix up or drop them. `steps` lists every one of those commits, oldest first.
    InteractiveRebase {
        onto: String,
        steps: Vec<RebaseStep>,
    },
    /// Create a tag on a commit: annotated when there is a message, lightweight otherwise.
    CreateTag {
        name: String,
        id: String,
        message: Option<String>,
    },
    /// Delete a local tag.
    DeleteTag { name: String },
    /// Put back a deleted tag, pointing at a commit or tag object `id`.
    RestoreTag { name: String, id: String },
    /// Push a tag to a remote (the default remote when none is given).
    PushTag {
        name: String,
        remote: Option<String>,
    },
    /// Delete a tag from a remote.
    DeleteRemoteTag { name: String, remote: String },
}

/// One commit in an interactive rebase.
#[derive(Debug, Deserialize)]
pub struct RebaseStep {
    pub id: String,
    pub action: StepAction,
    /// The new message, for [`StepAction::Reword`].
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StepAction {
    Pick,
    /// Keep the commit with a new message.
    Reword,
    /// Combine with the commit before it, keeping both messages.
    Squash,
    /// Combine with the commit before it, keeping only that commit's message.
    Fixup,
    Drop,
}

/// What an action did.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    /// A short message for the user.
    pub message: String,
    /// After pushing a new branch: the page the remote suggested for opening a pull request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<String>,
}

/// A git command Tributary ran, for the activity log.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: u64,
    /// When it started, in milliseconds since the Unix epoch.
    pub started: u64,
    pub duration_ms: u64,
    /// The folder it ran in.
    pub folder: String,
    /// Everything after `git`.
    pub args: Vec<String>,
    pub success: bool,
    /// What git printed, shortened when it's long.
    pub output: String,
    /// Run by Tributary on its own, like the fetch every few minutes.
    pub background: bool,
}

const LOG_SIZE: usize = 300;
const LOG_OUTPUT: usize = 8_000;
static LOG: Mutex<VecDeque<LogEntry>> = Mutex::new(VecDeque::new());
type Listener = Box<dyn Fn(&LogEntry) + Send + Sync>;
static LISTENER: OnceLock<Listener> = OnceLock::new();

/// The most recent git commands, oldest first.
pub fn activity() -> Vec<LogEntry> {
    LOG.lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .cloned()
        .collect()
}

/// Call `listener` after every git command (for the app to update its activity log).
pub fn on_activity(listener: impl Fn(&LogEntry) + Send + Sync + 'static) {
    let _ = LISTENER.set(Box::new(listener));
}

/// Read-only helpers that would only clutter the log.
const UNLOGGED: [&str; 4] = ["rev-parse", "rev-list", "check-ref-format", "merge-base"];

fn record(
    git: &Git,
    args: &[&str],
    started: SystemTime,
    took: Instant,
    success: bool,
    output: &str,
) {
    if args.first().is_some_and(|first| UNLOGGED.contains(first)) {
        return;
    }
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let output = output.trim();
    let output = match output.char_indices().nth(LOG_OUTPUT) {
        Some((cut, _)) => format!("{}\n…", &output[..cut]),
        None => output.to_owned(),
    };
    let entry = LogEntry {
        id: NEXT.fetch_add(1, Ordering::SeqCst),
        started: started
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        duration_ms: took.elapsed().as_millis() as u64,
        folder: git.workdir.display().to_string(),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        success,
        output,
        background: git.background,
    };
    {
        let mut log = LOG.lock().unwrap_or_else(|e| e.into_inner());
        if log.len() == LOG_SIZE {
            log.pop_front();
        }
        log.push_back(entry.clone());
    }
    if let Some(listener) = LISTENER.get() {
        listener(&entry);
    }
}

/// How far a fetch, pull or push has got.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Progress {
    /// Like "Receiving objects".
    pub phase: String,
    /// None until git reports a percentage.
    pub percent: Option<u8>,
}

/// A fetch, pull or push that is running, so it can be cancelled.
struct Running {
    id: u64,
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

static RUNNING: Mutex<Vec<Running>> = Mutex::new(Vec::new());
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Stop every fetch, pull or push that is running. Returns false if there are none.
pub fn cancel() -> bool {
    let running = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    for run in running.iter() {
        run.cancelled.store(true, Ordering::SeqCst);
        let _ = run.child.lock().unwrap_or_else(|e| e.into_inner()).kill();
    }
    !running.is_empty()
}

/// "Receiving objects:  45% (450/1000)" → ("Receiving objects", 45).
pub fn parse_progress(line: &str) -> Option<(String, u8)> {
    let line = line.trim();
    let line = line.strip_prefix("remote:").unwrap_or(line).trim();
    let (phase, rest) = line.split_once(':')?;
    if phase.is_empty() || !phase.chars().all(|c| c.is_ascii_alphabetic() || c == ' ') {
        return None;
    }
    let rest = rest.trim_start();
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() || !rest[digits.len()..].starts_with('%') {
        return None;
    }
    Some((phase.trim().to_owned(), digits.parse::<u8>().ok()?.min(100)))
}

/// Progress chatter that doesn't belong in an error message, like "remote: Total 3 (delta 0)".
fn is_progress_noise(line: &str) -> bool {
    let line = line.trim();
    let line = line.strip_prefix("remote:").unwrap_or(line).trim();
    if line.starts_with("Total ") || parse_progress(line).is_some() {
        return true;
    }
    // "Enumerating objects: 5, done."
    line.split_once(':').is_some_and(|(phase, rest)| {
        !phase.is_empty()
            && phase.chars().all(|c| c.is_ascii_alphabetic() || c == ' ')
            && rest.trim_start().starts_with(|c: char| c.is_ascii_digit())
    })
}

/// Run `action` and return a short message saying what happened.
pub fn run(path: &Path, action: Action) -> Result<String, Error> {
    run_with_progress(path, action, &|_| {}).map(|outcome| outcome.message)
}

/// Like [`run`], reporting how far a fetch, pull or push has got.
pub fn run_with_progress(
    path: &Path,
    action: Action,
    on_progress: &dyn Fn(Progress),
) -> Result<Outcome, Error> {
    let mut pull_request = None;
    let message = perform(path, action, on_progress, &mut pull_request)?;
    Ok(Outcome {
        message,
        pull_request,
    })
}

fn perform(
    path: &Path,
    action: Action,
    on_progress: &dyn Fn(Progress),
    pull_request: &mut Option<String>,
) -> Result<String, Error> {
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
            if background {
                // Nobody asked for this fetch, so never pop up a sign-in window for it.
                let git = Git {
                    background: true,
                    ..git
                };
                git.run_with_env(
                    &["fetch", "--all", "--prune", "--quiet"],
                    &[("GCM_INTERACTIVE", "never")],
                )?;
            } else {
                git.run_progress(&["fetch", "--all", "--prune", "--progress"], on_progress)?;
            }
            Ok("Fetched from all remotes".into())
        }
        Action::Pull => {
            let branch = current_branch(&repo)?;
            // `--no-edit`: never wait for a merge message in an editor nobody can see.
            let mut args = vec!["pull", "--no-edit", "--progress"];
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
            git.run_progress(&args, on_progress)?;
            Ok(format!("Pulled {branch}"))
        }
        Action::Push { force } => {
            let branch = current_branch(&repo)?;
            let mut args = vec!["push".to_owned(), "--progress".to_owned()];
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
            let output = git.run_progress(&args, on_progress)?;
            *pull_request = links::pull_request_url(&output.messages);
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
                return perform(path, *action, on_progress, pull_request);
            }
            match perform(path, *action, on_progress, pull_request) {
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
        Action::Merge { target } => {
            let branch = current_branch(&repo)?;
            let target = revision_name(&repo, &target)?;
            git.run(&["merge", "--no-edit", &target])?;
            Ok(format!("Merged {} into {branch}", short(&target)))
        }
        Action::Rebase { onto } => {
            let branch = current_branch(&repo)?;
            let onto = revision_name(&repo, &onto)?;
            git.run(&["rebase", &onto])?;
            Ok(format!("Rebased {branch} onto {}", short(&onto)))
        }
        Action::CherryPick { id } => {
            let id = commit_id(&repo, &id)?;
            let branch = current_branch(&repo).unwrap_or_else(|_| "HEAD".into());
            let mut args = vec!["cherry-pick".to_owned()];
            // A merge commit needs to know which parent its changes are relative to.
            if is_merge(&repo, id) {
                args.extend(["-m".into(), "1".into()]);
            }
            args.push(id.to_string());
            git.run(&args.iter().map(String::as_str).collect::<Vec<_>>())?;
            Ok(format!(
                "Cherry-picked {} onto {branch}",
                id.to_hex_with_len(7)
            ))
        }
        Action::Revert { id } => {
            let id = commit_id(&repo, &id)?;
            let mut args = vec!["revert".to_owned(), "--no-edit".to_owned()];
            if is_merge(&repo, id) {
                args.extend(["-m".into(), "1".into()]);
            }
            args.push(id.to_string());
            git.run(&args.iter().map(String::as_str).collect::<Vec<_>>())?;
            Ok(format!("Reverted {}", id.to_hex_with_len(7)))
        }
        Action::ContinueOperation => {
            let operation = in_progress(&repo)?;
            if operation == "merge" {
                git.run(&["commit", "--no-edit", "--quiet"])?;
            } else {
                git.run(&[operation, "--continue"])?;
            }
            Ok(format!("Finished the {operation}"))
        }
        Action::SkipCommit => {
            let operation = in_progress(&repo)?;
            if operation == "merge" {
                return Err("A merge can't skip commits. Abort it instead.".into());
            }
            git.run(&[operation, "--skip"])?;
            Ok(format!(
                "Skipped the commit and carried on with the {operation}"
            ))
        }
        Action::AbortOperation => {
            let operation = in_progress(&repo)?;
            git.run(&[operation, "--abort"])?;
            Ok(format!("Aborted the {operation}"))
        }
        Action::CherryPickMany { ids } => {
            let ids = commit_ids(&repo, &ids)?;
            if ids.iter().any(|&id| is_merge(&repo, id)) {
                return Err("Merge commits can only be cherry-picked one at a time.".into());
            }
            let branch = current_branch(&repo).unwrap_or_else(|_| "HEAD".into());
            let mut args = vec!["cherry-pick".to_owned()];
            args.extend(ids.iter().map(ToString::to_string));
            git.run(&args.iter().map(String::as_str).collect::<Vec<_>>())?;
            Ok(format!(
                "Cherry-picked {} onto {branch}",
                count(ids.len(), "commit")
            ))
        }
        Action::RevertMany { ids } => {
            let ids = commit_ids(&repo, &ids)?;
            if ids.iter().any(|&id| is_merge(&repo, id)) {
                return Err("Merge commits can only be reverted one at a time.".into());
            }
            let mut args = vec!["revert".to_owned(), "--no-edit".to_owned()];
            args.extend(ids.iter().map(ToString::to_string));
            git.run(&args.iter().map(String::as_str).collect::<Vec<_>>())?;
            Ok(format!("Reverted {}", count(ids.len(), "commit")))
        }
        Action::InteractiveRebase { onto, steps } => interactive_rebase(&repo, &git, &onto, &steps),
        Action::CreateTag { name, id, message } => {
            let name = name.trim().to_owned();
            check_new_tag_name(&repo, &git, &name)?;
            let id = commit_id(&repo, &id)?.to_string();
            let message = message
                .map(|m| m.trim().to_owned())
                .filter(|m| !m.is_empty());
            match &message {
                Some(message) => {
                    git.run(&["tag", "--annotate", "--message", message, &name, &id])?
                }
                None => git.run(&["tag", &name, &id])?,
            };
            Ok(format!("Created tag {name}"))
        }
        Action::DeleteTag { name } => {
            require_tag(&repo, &name)?;
            git.run(&["tag", "--delete", &name])?;
            Ok(format!("Deleted tag {name}"))
        }
        Action::RestoreTag { name, id } => {
            check_new_tag_name(&repo, &git, &name)?;
            let oid = ObjectId::from_hex(id.as_bytes()).map_err(|_| format!("Invalid id {id}"))?;
            repo.find_object(oid)
                .map_err(|e| format!("Could not find {id}: {e}"))?;
            git.run(&["tag", &name, &oid.to_string()])?;
            Ok(format!("Restored tag {name}"))
        }
        Action::PushTag { name, remote } => {
            require_tag(&repo, &name)?;
            let remote = match remote {
                Some(remote) => known_remote(&repo, &remote)?,
                None => default_remote(&repo)?,
            };
            let refspec = format!("refs/tags/{name}:refs/tags/{name}");
            git.run_progress(&["push", "--progress", &remote, &refspec], on_progress)?;
            Ok(format!("Pushed tag {name} to {remote}"))
        }
        Action::DeleteRemoteTag { name, remote } => {
            let remote = known_remote(&repo, &remote)?;
            if name.starts_with('-')
                || git
                    .run(&["check-ref-format", &format!("refs/tags/{name}")])
                    .is_err()
            {
                return Err(format!("There's no tag called {name}."));
            }
            git.run(&[
                "push",
                "--quiet",
                &remote,
                "--delete",
                &format!("refs/tags/{name}"),
            ])?;
            Ok(format!("Deleted tag {name} from {remote}"))
        }
    }
}

/// Create a repository in an existing folder.
pub fn init_repository(path: &Path) -> Result<String, Error> {
    if !path.is_dir() {
        return Err(format!("{} isn't a folder.", path.display()));
    }
    if path.join(".git").exists() {
        return Err(format!("{} is already a git repository.", path.display()));
    }
    let git = Git::find(path.to_owned())?;
    git.run(&["init", "--quiet"])?;
    Ok(format!("Created a repository in {}", path.display()))
}

/// Clone `url` into a new folder called `name` inside `parent`, returning that folder.
/// Reports progress like a fetch, and can be cancelled with [`cancel`].
pub fn clone_repository(
    url: &str,
    parent: &Path,
    name: &str,
    on_progress: &dyn Fn(Progress),
) -> Result<PathBuf, Error> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Enter the address of the repository to clone.".into());
    }
    if url.starts_with('-') || url.contains(char::is_control) || url.contains(' ') {
        return Err(format!("\"{url}\" doesn't look like a repository address."));
    }
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err("Choose a folder name, without slashes.".into());
    }
    if !parent.is_dir() {
        return Err(format!("{} isn't a folder.", parent.display()));
    }
    let target = parent.join(name);
    let existed = target.exists();
    let empty = || {
        std::fs::read_dir(&target)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false)
    };
    if existed && !(target.is_dir() && empty()) {
        return Err(format!(
            "{} already exists. Choose another name or folder.",
            target.display()
        ));
    }
    let target_arg = target
        .to_str()
        .ok_or("The folder's path has characters git can't be given here.")?;
    let git = Git::find(parent.to_owned())?;
    if let Err(error) =
        git.run_progress(&["clone", "--progress", "--", url, target_arg], on_progress)
    {
        // Don't leave a half-finished clone behind.
        if existed {
            if let Ok(entries) = std::fs::read_dir(&target) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let _ = if path.is_dir() {
                        std::fs::remove_dir_all(path)
                    } else {
                        std::fs::remove_file(path)
                    };
                }
            }
        } else {
            let _ = std::fs::remove_dir_all(&target);
        }
        return Err(error);
    }
    Ok(target)
}

/// Rewrite the commits after `onto`: git's own interactive rebase, with the to-do list
/// written for it instead of edited by hand.
fn interactive_rebase(
    repo: &gix::Repository,
    git: &Git,
    onto: &str,
    steps: &[RebaseStep],
) -> Result<String, Error> {
    let branch = current_branch(repo)?;
    let onto = commit_id(repo, onto)?.to_string();
    if git
        .run(&["merge-base", "--is-ancestor", &onto, "HEAD"])
        .is_err()
    {
        return Err(format!("{} isn't part of {branch}'s history.", &onto[..7]));
    }
    let range = format!("{onto}..HEAD");
    if !git
        .run(&["rev-list", "--merges", &range])?
        .trim()
        .is_empty()
    {
        return Err(
            "Those commits include merges, which can't be rewritten this way. Use git in a terminal for this one."
                .into(),
        );
    }
    let mut expected: Vec<String> = git
        .run(&["rev-list", &range])?
        .lines()
        .map(str::to_owned)
        .collect();
    if expected.is_empty() {
        return Err("There are no commits after that one to rewrite.".into());
    }
    let mut given: Vec<String> = steps.iter().map(|step| step.id.clone()).collect();
    expected.sort();
    given.sort();
    if given != expected {
        return Err("The branch changed. Refresh and try again.".into());
    }
    match steps.iter().find(|step| step.action != StepAction::Drop) {
        None => {
            return Err(
                "Every commit would be dropped. To do that, hard reset to the commit instead."
                    .into(),
            );
        }
        Some(first) if matches!(first.action, StepAction::Squash | StepAction::Fixup) => {
            return Err(
                "The oldest commit kept can't be squashed or fixed up: there's no commit before it to combine with."
                    .into(),
            );
        }
        _ => {}
    }

    // The to-do list and new messages live in the git folder until the rebase is done
    // (it may stop for conflicts and be continued later).
    let folder = repo.git_dir().join("tributary-rebase");
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).map_err(|e| format!("Could not prepare the rebase: {e}"))?;
    let executable = sh_quote(&git.executable.to_string_lossy());
    let mut todo = String::new();
    for (index, step) in steps.iter().enumerate() {
        let id = &step.id;
        match step.action {
            StepAction::Pick => todo.push_str(&format!("pick {id}\n")),
            StepAction::Squash => todo.push_str(&format!("squash {id}\n")),
            StepAction::Fixup => todo.push_str(&format!("fixup {id}\n")),
            StepAction::Drop => todo.push_str(&format!("drop {id}\n")),
            StepAction::Reword => {
                let message = step
                    .message
                    .as_deref()
                    .map(str::trim)
                    .filter(|m| !m.is_empty())
                    .ok_or("Write the new message for each commit you reword.")?;
                let file = folder.join(format!("message-{index}.txt"));
                std::fs::write(&file, message)
                    .map_err(|e| format!("Could not prepare the rebase: {e}"))?;
                let file = sh_quote(&file.to_string_lossy());
                todo.push_str(&format!(
                    "pick {id}\nexec {executable} commit --amend --quiet --allow-empty --cleanup=strip --file {file}\n"
                ));
            }
        }
    }
    let todo_file = folder.join("todo");
    std::fs::write(&todo_file, todo).map_err(|e| format!("Could not prepare the rebase: {e}"))?;
    // git hands its to-do file to this "editor", which replaces it with ours.
    let editor = format!("cp {}", sh_quote(&todo_file.to_string_lossy()));
    git.run_with_env(
        &["rebase", "--interactive", "--no-autosquash", &onto],
        &[("GIT_SEQUENCE_EDITOR", &editor)],
    )?;
    let _ = std::fs::remove_dir_all(&folder);
    Ok(format!("Rewrote {}'s history", branch))
}

/// A string in single quotes for git's shell, with forward slashes (git's shell on
/// Windows reads `C:/…` paths too).
fn sh_quote(text: &str) -> String {
    format!("'{}'", text.replace('\\', "/").replace('\'', "'\\''"))
}

/// Full ids of distinct existing commits.
fn commit_ids(repo: &gix::Repository, ids: &[String]) -> Result<Vec<ObjectId>, Error> {
    if ids.is_empty() {
        return Err("No commits given.".into());
    }
    let mut seen = std::collections::HashSet::new();
    ids.iter()
        .map(|id| {
            let oid = commit_id(repo, id)?;
            if !seen.insert(oid) {
                return Err(format!("{id} is listed twice."));
            }
            Ok(oid)
        })
        .collect()
}

fn require_tag(repo: &gix::Repository, name: &str) -> Result<(), Error> {
    if name.starts_with('-')
        || repo
            .try_find_reference(format!("refs/tags/{name}").as_str())
            .ok()
            .flatten()
            .is_none()
    {
        return Err(format!("There is no tag called {name}."));
    }
    Ok(())
}

fn check_new_tag_name(repo: &gix::Repository, git: &Git, name: &str) -> Result<(), Error> {
    if name.is_empty() {
        return Err("Enter a name for the tag.".into());
    }
    if name.starts_with('-')
        || git
            .run(&["check-ref-format", &format!("refs/tags/{name}")])
            .is_err()
    {
        return Err(format!(
            "\"{name}\" isn't a valid tag name. Avoid spaces and characters like ~ ^ : ? * [ \\."
        ));
    }
    if repo
        .try_find_reference(format!("refs/tags/{name}").as_str())
        .ok()
        .flatten()
        .is_some()
    {
        return Err(format!("A tag called {name} already exists."));
    }
    Ok(())
}

/// The name of a configured remote.
fn known_remote(repo: &gix::Repository, name: &str) -> Result<String, Error> {
    let known = repo
        .remote_names()
        .iter()
        .any(|remote| remote.to_str_lossy() == name);
    if !known || name.starts_with('-') {
        return Err(format!("There's no remote called {name}."));
    }
    Ok(name.to_owned())
}

/// The git command for the merge, rebase, cherry-pick or revert in progress.
fn in_progress(repo: &gix::Repository) -> Result<&'static str, Error> {
    use gix::state::InProgress;
    match repo.state() {
        Some(InProgress::Merge) => Ok("merge"),
        Some(InProgress::Rebase | InProgress::RebaseInteractive) => Ok("rebase"),
        Some(InProgress::CherryPick | InProgress::CherryPickSequence) => Ok("cherry-pick"),
        Some(InProgress::Revert | InProgress::RevertSequence) => Ok("revert"),
        Some(_) => Err("Another git operation is in progress. Finish it in a terminal.".into()),
        None => Err("There's no merge, rebase, cherry-pick or revert in progress.".into()),
    }
}

/// A full commit id, or the short name of an existing branch, remote branch or tag.
fn revision_name(repo: &gix::Repository, target: &str) -> Result<String, Error> {
    if let Ok(id) = commit_id(repo, target) {
        return Ok(id.to_string());
    }
    let exists = ["refs/heads/", "refs/remotes/", "refs/tags/"]
        .iter()
        .any(|prefix| {
            repo.try_find_reference(format!("{prefix}{target}").as_str())
                .ok()
                .flatten()
                .is_some()
        });
    if target.starts_with('-') || !exists {
        return Err(format!("There's no branch or tag called {target}."));
    }
    Ok(target.to_owned())
}

/// A short form of a revision for messages: commit ids are shortened, names kept.
fn short(name: &str) -> &str {
    if name.len() >= 40 && name.chars().all(|c| c.is_ascii_hexdigit()) {
        &name[..7]
    } else {
        name
    }
}

fn is_merge(repo: &gix::Repository, id: ObjectId) -> bool {
    repo.find_commit(id)
        .map(|commit| commit.parent_ids().count() > 1)
        .unwrap_or(false)
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
    /// Running on Tributary's own initiative, not because the user asked (for the log).
    background: bool,
}

/// What a fetch, pull or push printed.
struct ProgressOutput {
    /// Messages on standard error, without the progress lines.
    messages: String,
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
            background: false,
        })
    }

    /// Run git with `args`, returning its output, or its error message.
    fn run(&self, args: &[&str]) -> Result<String, Error> {
        self.run_with_env(args, &[])
    }

    fn run_with_env(&self, args: &[&str], env: &[(&str, &str)]) -> Result<String, Error> {
        let (started, took) = (SystemTime::now(), Instant::now());
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
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let printed = format!("{}\n{}", stdout.trim_end(), stderr.trim_end());
        record(self, args, started, took, output.status.success(), &printed);
        if output.status.success() {
            return Ok(stdout.into_owned());
        }
        Err(error_message(args, &output.status, &stdout, &stderr))
    }

    /// Run a fetch, pull or push, reporting progress and allowing [`cancel`].
    fn run_progress(
        &self,
        args: &[&str],
        on_progress: &dyn Fn(Progress),
    ) -> Result<ProgressOutput, Error> {
        use std::sync::mpsc::{RecvTimeoutError, channel};
        use std::time::Duration;

        let (started, took) = (SystemTime::now(), Instant::now());
        on_progress(Progress {
            phase: "Connecting".into(),
            percent: None,
        });
        let mut child = command(&self.executable)
            .arg("-C")
            .arg(&self.workdir)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_MERGE_AUTOEDIT", "no")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not run git: {e}"))?;
        let mut stderr = child.stderr.take().ok_or("Could not read git's output")?;
        let stdout = child.stdout.take().ok_or("Could not read git's output")?;

        // git's helper processes share its output pipes and can outlive it when it's
        // cancelled, so the pipes are read on their own threads and never waited for
        // once git itself has exited.
        let (lines, received) = channel::<String>();
        std::thread::spawn(move || {
            let mut line = Vec::new();
            let mut chunk = [0u8; 4096];
            while let Ok(read) = stderr.read(&mut chunk) {
                if read == 0 {
                    break;
                }
                for &byte in &chunk[..read] {
                    // git redraws its progress with carriage returns, so split on those too.
                    if byte == b'\r' || byte == b'\n' {
                        let _ = lines.send(String::from_utf8_lossy(&line).into_owned());
                        line.clear();
                    } else {
                        line.push(byte);
                    }
                }
            }
            let _ = lines.send(String::from_utf8_lossy(&line).into_owned());
        });
        let (output, output_received) = channel::<String>();
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = std::io::BufReader::new(stdout).read_to_string(&mut text);
            let _ = output.send(text);
        });

        let child = Arc::new(Mutex::new(child));
        let cancelled = Arc::new(AtomicBool::new(false));
        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        RUNNING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(Running {
                id,
                child: child.clone(),
                cancelled: cancelled.clone(),
            });

        let mut messages = String::new();
        let mut last: Option<(String, u8)> = None;
        let mut handle = |text: String| {
            if let Some(progress) = parse_progress(&text) {
                if last.as_ref() != Some(&progress) {
                    on_progress(Progress {
                        phase: progress.0.clone(),
                        percent: Some(progress.1),
                    });
                    last = Some(progress);
                }
            } else if !text.trim().is_empty() && !is_progress_noise(&text) {
                messages.push_str(text.trim_end());
                messages.push('\n');
            }
        };
        let exited = |child: &Arc<Mutex<Child>>| {
            child
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .try_wait()
                .map_err(|e| format!("Could not run git: {e}"))
        };
        let status = loop {
            match received.recv_timeout(Duration::from_millis(50)) {
                Ok(text) => handle(text),
                Err(RecvTimeoutError::Timeout) => {
                    if let Some(status) = exited(&child)? {
                        break status;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if let Some(status) = exited(&child)? {
                        break status;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
        };
        RUNNING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|run| run.id != id);
        if cancelled.load(Ordering::SeqCst) {
            record(self, args, started, took, false, "Cancelled.");
            return Err("Cancelled.".into());
        }

        // Whatever git wrote just before exiting.
        while let Ok(text) = received.recv_timeout(Duration::from_millis(200)) {
            handle(text);
        }
        let stdout = output_received
            .recv_timeout(Duration::from_secs(2))
            .unwrap_or_default();
        let printed = format!("{}\n{}", stdout.trim_end(), messages.trim_end());
        record(self, args, started, took, status.success(), &printed);
        if status.success() {
            return Ok(ProgressOutput { messages });
        }
        Err(error_message(args, &status, &stdout, &messages))
    }
}

/// git's error output, made a little friendlier.
fn error_message(
    args: &[&str],
    status: &std::process::ExitStatus,
    stdout: &str,
    stderr: &str,
) -> String {
    // Merges report their conflicts on standard output.
    let conflicts: Vec<&str> = stdout
        .lines()
        .filter(|line| line.starts_with("CONFLICT") || line.starts_with("Automatic merge failed"))
        .collect();
    let message = [conflicts.join("\n"), stderr.trim().to_owned()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if message.contains("terminal prompts disabled") || message.contains("could not read Username")
    {
        return format!(
            "Git needs your credentials for this remote. Sign in once with git in a terminal \
             (or set up a credential helper), then try again.\n\n{message}"
        );
    }
    if message.is_empty() {
        format!("git {} failed ({status})", args.join(" "))
    } else {
        message
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_progress_lines() {
        assert_eq!(
            parse_progress("Receiving objects:  45% (450/1000), 1.2 MiB | 2.0 MiB/s"),
            Some(("Receiving objects".into(), 45))
        );
        assert_eq!(
            parse_progress("remote: Compressing objects: 100% (3/3), done."),
            Some(("Compressing objects".into(), 100))
        );
        assert_eq!(parse_progress("To github.com:someone/repo.git"), None);
        assert_eq!(
            parse_progress(" ! [rejected]        main -> main (fetch first)"),
            None
        );
        assert_eq!(parse_progress("error: failed to push some refs"), None);
    }

    #[test]
    fn leaves_progress_chatter_out_of_error_messages() {
        assert!(is_progress_noise("remote: Enumerating objects: 5, done."));
        assert!(is_progress_noise(
            "remote: Total 3 (delta 0), reused 0 (delta 0)"
        ));
        assert!(is_progress_noise(
            "Writing objects: 100% (3/3), 280 bytes | 280.00 KiB/s, done."
        ));
        assert!(!is_progress_noise(
            "error: failed to push some refs to 'origin'"
        ));
        assert!(!is_progress_noise(
            "hint: Updates were rejected because the remote contains work"
        ));
    }
}
