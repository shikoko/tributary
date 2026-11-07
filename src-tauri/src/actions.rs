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

use crate::{lfs, links};

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
    /// Delete several local branches (pruning), each only if it still points at the
    /// commit given. The ones that can't be deleted are reported; the rest still go.
    DeleteBranches { branches: Vec<BranchTip> },
    /// Put back deleted branches, with the upstream they had (undoing a prune).
    RestoreBranches { branches: Vec<BranchTip> },
    /// Push a deleted remote branch like `origin/feature` back, at commit `id` (undo).
    RestoreRemoteBranch { name: String, id: String },
    /// Put back what a backup kept (see [`backups`]).
    RestoreBackup { reference: String },
    /// Forget a backup.
    RemoveBackup { reference: String },
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
    /// Resolve conflicted files by taking one side's version of each whole file: yours
    /// (the checked-out branch, or the branch being rebased) or theirs. A side that
    /// deleted the file deletes it. For files that can't be merged, like game assets.
    ResolveConflicts { paths: Vec<String>, keep: Side },
    /// Put the conflicts back into files resolved with [`Action::ResolveConflicts`] (undo).
    RecreateConflicts { paths: Vec<String> },
    /// Lock files with Git LFS, so nobody else can push changes to them.
    LockFiles { paths: Vec<String> },
    /// Release Git LFS locks, by id (the file may not exist here). `force` releases
    /// someone else's lock.
    UnlockFiles {
        locks: Vec<LockRef>,
        #[serde(default)]
        force: bool,
    },
}

/// A Git LFS lock: its id, and the file it's on (for messages).
#[derive(Debug, Clone, Deserialize)]
pub struct LockRef {
    pub id: String,
    pub path: String,
}

/// Which version of a conflicted file to keep.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    /// The checked-out branch's version (for a rebase, the branch being rebased).
    Mine,
    /// The version being merged, picked or rebased onto.
    Theirs,
}

/// A local branch, the commit it points to and, to restore it as it was, its upstream
/// (`branch.<name>.remote` and `branch.<name>.merge`).
#[derive(Debug, Clone, Deserialize)]
pub struct BranchTip {
    pub name: String,
    pub id: String,
    #[serde(default)]
    pub remote: Option<String>,
    #[serde(default)]
    pub merge: Option<String>,
}

/// Where a branch was before Tributary deleted, reset, rebased or force-pushed it, kept
/// for [`BACKUP_DAYS`] days so it can be put back.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    /// The backup's own ref, under `refs/tributary/backups/`.
    pub reference: String,
    /// "deleted", "deletedFromRemote", "forcePushed", "reset" or "rebased".
    pub event: String,
    /// The branch, like `feat/x`, or `origin/feat/x` for a remote one.
    pub name: String,
    pub remote: bool,
    /// The commit it pointed to, its summary, and when the backup was made.
    pub id: String,
    pub summary: String,
    pub time: i64,
    /// Where the branch points now, if it still exists.
    pub current: Option<String>,
}

/// Commits that would be lost with a branch: on it, and on no other branch, remote
/// branch or tag.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LostCommits {
    pub count: u32,
    /// The newest few.
    pub commits: Vec<CommitBrief>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitBrief {
    pub id: String,
    pub summary: String,
    pub time: i64,
}

/// The commits that changed a file or folder.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistory {
    /// Relative to the repository's root, with forward slashes, without a trailing slash.
    pub path: String,
    pub folder: bool,
    /// Newest first, from every branch, remote branch and tag.
    pub ids: Vec<String>,
    /// For a file: every path it had, following renames, newest first.
    pub names: Vec<String>,
    /// More commits changed it than were listed.
    pub truncated: bool,
}

/// A local branch that could be pruned: its remote branch is gone, or it's merged.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneCandidate {
    pub name: String,
    pub id: String,
    /// Its last commit's summary and commit time.
    pub summary: String,
    pub time: i64,
    /// The remote branch it tracked, like `origin/feat/x`.
    pub upstream: Option<String>,
    /// Its remote branch was deleted (usually: its pull request was merged).
    pub gone: bool,
    /// All its commits are in the base branch (or the local branch of that name).
    pub merged: bool,
    /// How many of its commits aren't in the base branch (0 when merged).
    pub unmerged: u32,
    /// Its upstream configuration, to put back if the prune is undone.
    pub remote: Option<String>,
    pub merge: Option<String>,
}

/// What [`prune_candidates`] found.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneInfo {
    /// What "merged" is measured against, like `origin/main`.
    pub base: Option<String>,
    pub candidates: Vec<PruneCandidate>,
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
/// Reading commands, and Tributary's own backups (see [`back_up`]), stay out of the log.
const UNLOGGED: [&str; 8] = [
    "rev-parse",
    "rev-list",
    "check-ref-format",
    "merge-base",
    "for-each-ref",
    "update-ref",
    "ls-files",
    "log",
];

fn record(
    git: &Git,
    args: &[&str],
    started: SystemTime,
    took: Instant,
    success: bool,
    output: &str,
) {
    if args.first().is_some_and(|first| UNLOGGED.contains(first))
        || args.starts_with(&["worktree", "list"])
        || args.starts_with(&["lfs", "locks"])
    {
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
    /// More about it, like "2 of 5 files · 56 MB of 80 MB · 12 MB/s".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
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

/// "Receiving objects:  45% (450/1000), 1.2 MiB | 2.0 MiB/s" → "Receiving objects", 45%,
/// "1.2 MiB · 2.0 MiB/s". Also reads the lines Git LFS writes when its progress is forced on.
pub fn parse_progress(line: &str) -> Option<Progress> {
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
    let percent = digits.parse::<u8>().ok()?.min(100);

    // What follows: "(450/1000), 1.2 MiB | 2.0 MiB/s", "(3/3), done." or nothing.
    let after = rest[digits.len() + 1..].trim();
    let after = after
        .trim_end_matches('.')
        .trim_end_matches(", done")
        .trim();
    let (counts, amounts) = match after.split_once("), ") {
        Some((counts, amounts)) => (counts.trim_start_matches('('), Some(amounts)),
        None => (after.trim_start_matches('(').trim_end_matches(')'), None),
    };
    let lfs = phase.contains("LFS") || phase == "Filtering content";
    let mut detail = Vec::new();
    if lfs && let Some((done, total)) = counts.split_once('/') {
        detail.push(format!("{done} of {total} files"));
    }
    for amount in amounts.into_iter().flat_map(|amounts| amounts.split(" | ")) {
        let amount = amount.trim();
        // Transfers to a folder on this computer report no bytes at all.
        let nothing =
            amount == "0 B" || amount.starts_with("0 B/") || amount.starts_with("0 bytes");
        if !amount.is_empty() && !nothing {
            detail.push(amount.to_owned());
        }
    }
    let phase = match phase.trim() {
        "Uploading LFS objects" => "Uploading LFS files",
        "Downloading LFS objects" => "Downloading LFS files",
        // git's progress while Git LFS fills in the files it checks out.
        "Filtering content" => "Checking out LFS files",
        other => other,
    };
    Some(Progress {
        phase: phase.to_owned(),
        percent: Some(percent),
        detail: (!detail.is_empty()).then(|| detail.join(" · ")),
    })
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
            let full_name = format!("refs/heads/{branch}");
            let before = ref_id(&repo, &full_name);
            git.run(&["reset", "--hard", "--quiet", &id.to_string()])?;
            if let Some(before) = before.filter(|before| *before != id) {
                back_up(&repo, &git, &full_name, "reset", before);
            }
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
            // What a force push replaces on the remote, to keep a backup of.
            let mut replaced = None;
            let remote = match push_target(&repo, &branch) {
                Some((remote, remote_branch)) => {
                    if force && let Some(leaf) = remote_branch.strip_prefix("refs/heads/") {
                        let tracking = format!("refs/remotes/{remote}/{leaf}");
                        replaced = ref_id(&repo, &tracking).map(|id| (tracking, id));
                    }
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
            if let Some((tracking, id)) = replaced
                && ref_id(&repo, "HEAD") != Some(id)
            {
                back_up(&repo, &git, &tracking, "forcePushed", id);
            }
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
            let full_name = format!("refs/heads/{name}");
            let before = ref_id(&repo, &full_name);
            git.run(&["branch", if force { "-D" } else { "-d" }, &name])?;
            if let Some(id) = before {
                back_up(&repo, &git, &full_name, "deleted", id);
            }
            Ok(format!("Deleted branch {name}"))
        }
        Action::DeleteBranches { branches } => {
            let current = current_branch(&repo).ok();
            let mut deleted = Vec::new();
            let mut failed = Vec::new();
            for tip in &branches {
                let result = (|| {
                    let full_name = format!("refs/heads/{}", tip.name);
                    require_ref(&repo, &full_name, &tip.name)?;
                    if current.as_deref() == Some(tip.name.as_str()) {
                        return Err("it's checked out".to_owned());
                    }
                    let now = repo
                        .find_reference(full_name.as_str())
                        .ok()
                        .and_then(|mut reference| reference.peel_to_id().ok())
                        .map(|id| id.to_string());
                    if now.as_deref() != Some(tip.id.as_str()) {
                        return Err("it has new commits since".to_owned());
                    }
                    // The commits were checked against the base branch (which may be a
                    // remote one, where `-d` only knows about the checked-out branch).
                    git.run(&["branch", "-D", &tip.name])?;
                    if let Ok(id) = ObjectId::from_hex(tip.id.as_bytes()) {
                        back_up(&repo, &git, &full_name, "deleted", id);
                    }
                    Ok(())
                })();
                match result {
                    Ok(()) => deleted.push(tip.name.clone()),
                    Err(error) => failed.push(format!("{} ({})", tip.name, error.trim())),
                }
            }
            if deleted.is_empty() {
                return Err(format!("Couldn't delete {}", failed.join(", ")));
            }
            let mut message = match deleted.as_slice() {
                [one] => format!("Deleted branch {one}"),
                _ => format!("Deleted {} branches", deleted.len()),
            };
            if !failed.is_empty() {
                message.push_str(&format!(". Couldn't delete {}", failed.join(", ")));
            }
            Ok(message)
        }
        Action::RestoreBranches { branches } => {
            let mut restored = 0;
            let mut failed = Vec::new();
            for tip in &branches {
                // Already there, as it was (it was never deleted): nothing to do.
                let existing = repo
                    .try_find_reference(format!("refs/heads/{}", tip.name).as_str())
                    .ok()
                    .flatten()
                    .and_then(|mut reference| reference.peel_to_id().ok())
                    .map(|id| id.to_string());
                if existing.as_deref() == Some(tip.id.as_str()) {
                    continue;
                }
                let result = (|| {
                    check_new_branch_name(&repo, &git, &tip.name)?;
                    let id = commit_id(&repo, &tip.id)?;
                    git.run(&["branch", &tip.name, &id.to_string()])?;
                    if let (Some(remote), Some(merge)) = (&tip.remote, &tip.merge)
                        && !remote.starts_with('-')
                        && merge.starts_with("refs/")
                    {
                        git.run(&["config", &format!("branch.{}.remote", tip.name), remote])?;
                        git.run(&["config", &format!("branch.{}.merge", tip.name), merge])?;
                    }
                    Ok::<(), Error>(())
                })();
                match result {
                    Ok(()) => restored += 1,
                    Err(error) => failed.push(format!("{} ({})", tip.name, error.trim())),
                }
            }
            if restored == 0 {
                if failed.is_empty() {
                    return Ok("Nothing to restore: the branches are all there".into());
                }
                return Err(format!("Couldn't restore {}", failed.join(", ")));
            }
            let mut message = if restored == 1 {
                format!("Restored branch {}", branches[0].name)
            } else {
                format!("Restored {restored} branches")
            };
            if !failed.is_empty() {
                message.push_str(&format!(". Couldn't restore {}", failed.join(", ")));
            }
            Ok(message)
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
            let full_name = format!("refs/remotes/{name}");
            let before = ref_id(&repo, &full_name);
            git.run(&["push", "--quiet", remote, "--delete", branch])?;
            if let Some(id) = before {
                back_up(&repo, &git, &full_name, "deletedFromRemote", id);
            }
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
            let before = ref_id(&repo, &format!("refs/heads/{branch}"));
            let result = git.run(&["rebase", &onto]);
            back_up_rewrite(&repo, &git, &branch, before);
            result?;
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
        Action::InteractiveRebase { onto, steps } => {
            let branch = current_branch(&repo).ok();
            let before = branch
                .as_ref()
                .and_then(|branch| ref_id(&repo, &format!("refs/heads/{branch}")));
            let result = interactive_rebase(&repo, &git, &onto, &steps);
            if let Some(branch) = branch {
                back_up_rewrite(&repo, &git, &branch, before);
            }
            result
        }
        Action::RestoreRemoteBranch { name, id } => {
            let (remote, branch) = split_remote_branch(&repo, &name)?;
            let id = commit_id(&repo, &id)?;
            if ref_id(&repo, &format!("refs/remotes/{name}")).is_some() {
                return Err(format!("{name} exists again, so it wasn't pushed back."));
            }
            let refspec = format!("{id}:refs/heads/{branch}");
            git.run_progress(&["push", "--progress", &remote, &refspec], on_progress)?;
            Ok(format!("Pushed {branch} back to {remote}"))
        }
        Action::RestoreBackup { reference } => restore_backup(&repo, &git, &reference, on_progress),
        Action::RemoveBackup { reference } => {
            let (_, _, _, name) =
                parse_backup(&reference).ok_or_else(|| format!("{reference} isn't a backup."))?;
            git.run(&["update-ref", "-d", &reference])?;
            Ok(format!("Removed the backup of {name}"))
        }
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
        Action::ResolveConflicts { paths, keep } => resolve_conflicts(&repo, &git, &paths, keep),
        Action::RecreateConflicts { paths } => {
            let paths = check_file_paths(&paths)?;
            in_progress(&repo)?;
            // git remembers how resolved files conflicted: bring that back into the index,
            // then put the conflicted files back as the merge left them.
            for batch in in_batches(&paths) {
                let mut args = vec!["update-index", "--unresolve", "--"];
                args.extend(batch);
                git.run_with_env(&args, &LITERAL)?;
            }
            let stages = conflict_stages(&git, &paths)?;
            let (mut both, mut ours, mut theirs) = (Vec::new(), Vec::new(), Vec::new());
            for &path in &paths {
                match stages.get(path) {
                    Some(found) if found.contains(&'2') && found.contains(&'3') => both.push(path),
                    Some(found) if found.contains(&'2') => ours.push(path),
                    Some(found) if found.contains(&'3') => theirs.push(path),
                    _ => {}
                }
            }
            for (flag, list) in [("--merge", &both), ("--ours", &ours), ("--theirs", &theirs)] {
                for batch in in_batches(list) {
                    let mut args = vec!["checkout", flag, "--"];
                    args.extend(batch);
                    // Binary files can't get conflict markers; git leaves your version.
                    let _ = git.run_with_env(&args, &LITERAL);
                }
            }
            Ok(format!(
                "Put the conflicts back in {}",
                describe_files(&paths)
            ))
        }
        Action::LockFiles { paths } => {
            let paths = check_file_paths(&paths)?;
            each_file(&paths, "lock", |path| {
                let output = git.run(&["lfs", "lock", "--json", "--", path])?;
                if let Some(owner) = crate::locks::owner_of_new_lock(&output) {
                    crate::locks::remember_owner(&git.workdir, &owner);
                }
                Ok(())
            })
        }
        Action::UnlockFiles { locks, force } => {
            if locks.is_empty() {
                return Err("No files given.".into());
            }
            let paths: Vec<&str> = locks.iter().map(|lock| lock.path.as_str()).collect();
            each_file(&paths, "unlock", |path| {
                let lock = locks.iter().find(|lock| lock.path == path).unwrap();
                if lock.id.is_empty() || lock.id.starts_with('-') {
                    return Err(format!("Unknown lock {}", lock.id));
                }
                let id = format!("--id={}", lock.id);
                // Git LFS makes a file read-only again once it's unlocked, and gives up
                // when the file isn't in this working tree (deleted, or on another branch).
                let missing = !Path::new(&git.workdir).join(&lock.path).exists();
                let mut args = if missing {
                    vec![
                        "-c",
                        "lfs.setlockablereadonly=false",
                        "lfs",
                        "unlock",
                        id.as_str(),
                    ]
                } else {
                    vec!["lfs", "unlock", id.as_str()]
                };
                if force {
                    args.push("--force");
                }
                git.run(&args).map(|_| ())
            })
        }
    }
}

/// Paths of files in the working tree, relative to its root.
fn check_file_paths(paths: &[String]) -> Result<Vec<&str>, Error> {
    let paths = check_paths(paths)?;
    if let Some(bad) = paths
        .iter()
        .find(|path| path.is_empty() || path.starts_with('-') || Path::new(path).is_absolute())
    {
        return Err(format!("{bad} isn't a file in this repository."));
    }
    Ok(paths)
}

/// The name of a file, without its folders.
fn file_name(path: &str) -> &str {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
}

/// "Barber.uasset" for one file, "3 files" for more.
fn describe_files(paths: &[&str]) -> String {
    match paths {
        [one] => file_name(one).to_owned(),
        _ => count(paths.len(), "file"),
    }
}

/// Lock or unlock files one by one: Git LFS takes one path at a time. Reports the ones
/// that failed, after doing the rest.
fn each_file(
    paths: &[&str],
    verb: &str,
    mut run: impl FnMut(&str) -> Result<(), Error>,
) -> Result<String, Error> {
    let mut done = Vec::new();
    let mut failed = Vec::new();
    for &path in paths {
        match run(path) {
            Ok(()) => done.push(path),
            Err(error) => failed.push(format!("{}: {}", file_name(path), error.trim())),
        }
    }
    let past = if verb == "lock" { "Locked" } else { "Unlocked" };
    if failed.is_empty() {
        return Ok(format!("{past} {}", describe_files(&done)));
    }
    let failures = failed.join("\n");
    if done.is_empty() {
        return Err(if paths.len() == 1 {
            format!("Couldn't {verb} {failures}")
        } else {
            format!("Couldn't {verb} these files:\n{failures}")
        });
    }
    Err(format!(
        "{past} {}, but couldn't {verb} these:\n{failures}",
        describe_files(&done)
    ))
}

/// Long lists of paths are passed to git in batches, to stay under the command line
/// length limit (about 32,000 characters on Windows).
fn in_batches<'a>(paths: &'a [&'a str]) -> impl Iterator<Item = &'a [&'a str]> {
    const MAX_CHARS: usize = 20_000;
    let mut start = 0;
    std::iter::from_fn(move || {
        if start >= paths.len() {
            return None;
        }
        let mut end = start;
        let mut chars = 0;
        while end < paths.len() && (end == start || chars + paths[end].len() < MAX_CHARS) {
            chars += paths[end].len() + 1;
            end += 1;
        }
        let batch = &paths[start..end];
        start = end;
        Some(batch)
    })
}

/// Paths are taken literally, never as patterns: a file can be called `a*.png`.
const LITERAL: [(&str, &str); 1] = [("GIT_LITERAL_PATHSPECS", "1")];

/// Which versions each conflicted file among `paths` has in the index: '1' (the common
/// ancestor), '2' (ours) and '3' (theirs).
fn conflict_stages(
    git: &Git,
    paths: &[&str],
) -> Result<std::collections::HashMap<String, Vec<char>>, Error> {
    let mut stages: std::collections::HashMap<String, Vec<char>> = Default::default();
    for batch in in_batches(paths) {
        let mut args = vec!["ls-files", "--unmerged", "-z", "--"];
        args.extend(batch);
        // "<mode> <id> <stage>\t<path>" records.
        for record in git.run_with_env(&args, &LITERAL)?.split('\0') {
            let Some((info, path)) = record.split_once('\t') else {
                continue;
            };
            if let Some(number) = info.split(' ').nth(2).and_then(|s| s.chars().next()) {
                stages.entry(path.to_owned()).or_default().push(number);
            }
        }
    }
    Ok(stages)
}

fn resolve_conflicts(
    repo: &gix::Repository,
    git: &Git,
    paths: &[String],
    keep: Side,
) -> Result<String, Error> {
    use gix::state::InProgress;
    let paths = check_file_paths(paths)?;
    let rebasing = matches!(
        repo.state(),
        Some(InProgress::Rebase | InProgress::RebaseInteractive | InProgress::ApplyMailboxRebase)
    );
    // While rebasing, git's "ours" is the branch being rebased onto, and "theirs" is your
    // own commit being replayed on top of it.
    let ours = (keep == Side::Mine) != rebasing;
    let (flag, stage) = if ours {
        ("--ours", '2')
    } else {
        ("--theirs", '3')
    };

    let stages = conflict_stages(git, &paths)?;
    let mut take = Vec::new();
    let mut delete = Vec::new();
    for &path in &paths {
        match stages.get(path) {
            None => {}
            Some(found) if found.contains(&stage) => take.push(path),
            // That side deleted the file.
            Some(_) => delete.push(path),
        }
    }
    if take.is_empty() && delete.is_empty() {
        return Err(if paths.len() == 1 {
            format!("{} has no conflicts left.", file_name(paths[0]))
        } else {
            "These files have no conflicts left.".into()
        });
    }
    for batch in in_batches(&take) {
        let mut args = vec!["checkout", flag, "--"];
        args.extend(batch);
        git.run_with_env(&args, &LITERAL)?;
        let mut args = vec!["add", "--"];
        args.extend(batch);
        git.run_with_env(&args, &LITERAL)?;
    }
    for batch in in_batches(&delete) {
        let mut args = vec!["rm", "--quiet", "--"];
        args.extend(batch);
        git.run_with_env(&args, &LITERAL)?;
    }
    let mut resolved = take;
    resolved.extend(delete);
    Ok(match keep {
        Side::Mine => format!("Kept your version of {}", describe_files(&resolved)),
        Side::Theirs => format!("Took their version of {}", describe_files(&resolved)),
    })
}

/// Create a repository in an existing folder.
/// Where backups of branches are kept.
const BACKUPS: &str = "refs/tributary/backups/";
/// How long a backup is kept.
pub const BACKUP_DAYS: i64 = 30;

/// The commit a ref points at now, if it exists.
fn ref_id(repo: &gix::Repository, full_name: &str) -> Option<ObjectId> {
    repo.try_find_reference(full_name)
        .ok()
        .flatten()
        .and_then(|mut reference| reference.peel_to_id().ok())
        .map(|id| id.detach())
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Keep `id`, where `full_name` (`refs/heads/…` or `refs/remotes/…`) pointed before
/// `event`, as `refs/tributary/backups/<when>/<event>/<heads|remotes>/<name>`. That also
/// keeps its commits from garbage collection. Old backups are dropped. Never fails the
/// action it's part of.
fn back_up(repo: &gix::Repository, git: &Git, full_name: &str, event: &str, id: ObjectId) {
    let Some(rest) = full_name.strip_prefix("refs/") else {
        return;
    };
    let backup = format!("{BACKUPS}{}/{event}/{rest}", now_millis());
    let _ = git.run(&["update-ref", &backup, &id.to_string()]);
    let cutoff = now_millis() - BACKUP_DAYS * 24 * 3600 * 1000;
    for (reference, (millis, ..)) in backup_refs(repo) {
        if millis < cutoff {
            let _ = git.run(&["update-ref", "-d", &reference]);
        }
    }
}

/// After a rebase: if the branch moved, or the rebase stopped part way (the branch only
/// moves at the end), keep where it was.
fn back_up_rewrite(repo: &gix::Repository, git: &Git, branch: &str, before: Option<ObjectId>) {
    let Some(before) = before else {
        return;
    };
    let full_name = format!("refs/heads/{branch}");
    let stopped = gix::open(repo.git_dir())
        .ok()
        .and_then(|fresh| fresh.state())
        .is_some();
    if stopped || ref_id(repo, &full_name) != Some(before) {
        back_up(repo, git, &full_name, "rebased", before);
    }
}

/// `refs/tributary/backups/<millis>/<event>/<heads|remotes>/<name>` → its parts.
fn parse_backup(reference: &str) -> Option<(i64, String, bool, String)> {
    let rest = reference.strip_prefix(BACKUPS)?;
    let (millis, rest) = rest.split_once('/')?;
    let (event, rest) = rest.split_once('/')?;
    let (remote, name) = match rest.split_once('/')? {
        ("heads", name) => (false, name),
        ("remotes", name) => (true, name),
        _ => return None,
    };
    Some((
        millis.parse().ok()?,
        event.to_owned(),
        remote,
        name.to_owned(),
    ))
}

type BackupParts = (i64, String, bool, String);

/// Every backup ref, with its parts.
fn backup_refs(repo: &gix::Repository) -> Vec<(String, BackupParts)> {
    let Ok(platform) = repo.references() else {
        return Vec::new();
    };
    let Ok(all) = platform.all() else {
        return Vec::new();
    };
    all.flatten()
        .filter_map(|reference| {
            let name = reference.name().as_bstr().to_str_lossy().into_owned();
            let parts = parse_backup(&name)?;
            Some((name, parts))
        })
        .collect()
}

fn summary_of(repo: &gix::Repository, id: ObjectId) -> (String, i64) {
    repo.find_commit(id)
        .ok()
        .map(|commit| {
            let summary = commit
                .message()
                .map(|m| m.summary().to_str_lossy().into_owned())
                .unwrap_or_default();
            (summary, commit.time().map(|t| t.seconds).unwrap_or(0))
        })
        .unwrap_or_default()
}

/// The backups kept in the last [`BACKUP_DAYS`] days, newest first.
pub fn backups(path: &Path) -> Result<Vec<Backup>, Error> {
    let repo = gix::discover(path)
        .map_err(|e| format!("{} is not a git repository ({e})", path.display()))?;
    let cutoff = now_millis() - BACKUP_DAYS * 24 * 3600 * 1000;
    let mut list: Vec<Backup> = backup_refs(&repo)
        .into_iter()
        .filter(|(_, (millis, ..))| *millis >= cutoff)
        .filter_map(|(reference, (millis, event, remote, name))| {
            let id = ref_id(&repo, &reference)?;
            let kind = if remote { "remotes" } else { "heads" };
            let current = ref_id(&repo, &format!("refs/{kind}/{name}")).map(|id| id.to_string());
            Some(Backup {
                reference,
                event,
                name,
                remote,
                id: id.to_string(),
                summary: summary_of(&repo, id).0,
                time: millis / 1000,
                current,
            })
        })
        .collect();
    list.sort_by(|a, b| b.time.cmp(&a.time).then_with(|| a.name.cmp(&b.name)));
    Ok(list)
}

/// `base`, or `base-2`, `base-3`… if that branch exists.
fn free_branch_name(repo: &gix::Repository, base: &str) -> String {
    let taken = |name: &str| ref_id(repo, &format!("refs/heads/{name}")).is_some();
    if !taken(base) {
        return base.to_owned();
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|name| !taken(name))
        .unwrap_or_default()
}

/// `origin/feat/x` → (`origin`, `feat/x`), for a remote that exists.
fn split_remote_branch(repo: &gix::Repository, name: &str) -> Result<(String, String), Error> {
    repo.remote_names()
        .iter()
        .map(|remote| remote.to_str_lossy().into_owned())
        .filter_map(|remote| {
            let branch = name.strip_prefix(&format!("{remote}/"))?.to_owned();
            Some((remote, branch))
        })
        .max_by_key(|(remote, _)| remote.len())
        .filter(|(remote, branch)| !remote.starts_with('-') && !branch.is_empty())
        .ok_or_else(|| format!("{name} isn't a branch of a remote here."))
}

/// Put back what a backup kept. Never overwrites anything: when the branch has changed
/// since, the earlier version becomes a new branch beside it.
fn restore_backup(
    repo: &gix::Repository,
    git: &Git,
    reference: &str,
    on_progress: &dyn Fn(Progress),
) -> Result<String, Error> {
    let (_, event, remote, name) =
        parse_backup(reference).ok_or_else(|| format!("{reference} isn't a backup."))?;
    let id = ref_id(repo, reference).ok_or("That backup is gone.")?;
    let new_branch = |base: &str| -> Result<String, Error> {
        let branch = free_branch_name(repo, base);
        check_new_branch_name(repo, git, &branch)?;
        git.run(&["branch", &branch, &id.to_string()])?;
        Ok(branch)
    };
    if !remote {
        return match ref_id(repo, &format!("refs/heads/{name}")) {
            None => {
                check_new_branch_name(repo, git, &name)?;
                git.run(&["branch", &name, &id.to_string()])?;
                Ok(format!("Restored {name}"))
            }
            Some(current) if current == id => Ok(format!("{name} is already there, as it was")),
            Some(_) => {
                let branch = new_branch(&format!("{name}-restored"))?;
                Ok(format!(
                    "{name} has changed since, so its earlier version is now the branch {branch}"
                ))
            }
        };
    }
    let (remote_name, branch) = split_remote_branch(repo, &name)?;
    if event == "deletedFromRemote" && ref_id(repo, &format!("refs/remotes/{name}")).is_none() {
        let refspec = format!("{id}:refs/heads/{branch}");
        git.run_progress(&["push", "--progress", &remote_name, &refspec], on_progress)?;
        return Ok(format!("Pushed {branch} back to {remote_name}"));
    }
    let suffix = if event == "forcePushed" {
        "before-force-push"
    } else {
        "restored"
    };
    let local = new_branch(&format!("{branch}-{suffix}"))?;
    Ok(format!(
        "The earlier version of {name} is now the local branch {local}"
    ))
}

/// At most this many commits are listed for a file's history.
const HISTORY_LIMIT: usize = 5000;

/// The commits that changed `file` (a path in the repository, or an absolute path inside
/// it), following renames for a file. For a folder, those that changed anything in it.
pub fn file_history(path: &Path, file: &str) -> Result<FileHistory, Error> {
    let repo = gix::discover(path)
        .map_err(|e| format!("{} is not a git repository ({e})", path.display()))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree.")?
        .to_owned();
    let relative = repo_relative(&workdir, file)?;
    let folder = file.ends_with('/') || file.ends_with('\\') || workdir.join(&relative).is_dir();
    let git = Git::find(workdir)?;

    let limit = format!("--max-count={}", HISTORY_LIMIT + 1);
    let mut args = vec!["log", "--format=%x1e%H", &limit];
    if !folder {
        args.extend(["--follow", "--name-only"]);
    }
    // The same commits the graph shows: everything reachable from branches, remote
    // branches and tags (and HEAD, which may be detached), but not stashes or backups.
    args.extend(["--branches", "--remotes", "--tags"]);
    if repo.head_id().is_ok() {
        args.push("HEAD");
    }
    args.extend(["--", &relative]);
    let output = git.run_with_env(&args, &LITERAL)?;

    let mut ids = Vec::new();
    let mut names: Vec<String> = Vec::new();
    for record in output
        .split('\u{1e}')
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        let mut lines = record
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty());
        let Some(id) = lines.next() else { continue };
        ids.push(id.to_owned());
        for name in lines {
            if !names.iter().any(|known| known == name) {
                names.push(name.to_owned());
            }
        }
    }
    let truncated = ids.len() > HISTORY_LIMIT;
    ids.truncate(HISTORY_LIMIT);
    if !folder && names.is_empty() {
        names.push(relative.clone());
    }
    Ok(FileHistory {
        path: relative,
        folder,
        ids,
        names,
        truncated,
    })
}

/// `file` relative to the working tree's root, with forward slashes: as given, or cut
/// from an absolute path inside the working tree.
fn repo_relative(workdir: &Path, file: &str) -> Result<String, Error> {
    let trimmed = file.trim().trim_end_matches(['/', '\\']);
    let given = Path::new(trimmed);
    let relative = if given.is_absolute() {
        let canonical =
            |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_owned());
        let root = canonical(workdir);
        let inside = canonical(given);
        inside
            .strip_prefix(&root)
            .or_else(|_| given.strip_prefix(workdir))
            .map(Path::to_owned)
            .map_err(|_| format!("{file} isn't in this repository."))?
    } else {
        given.to_owned()
    };
    let parts: Vec<String> = relative
        .components()
        .map(|part| match part {
            std::path::Component::Normal(name) => Ok(name.to_string_lossy().into_owned()),
            std::path::Component::CurDir => Ok(String::new()),
            _ => Err(format!("{file} isn't in this repository.")),
        })
        .collect::<Result<_, _>>()?;
    let joined = parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    if joined.is_empty() {
        return Err("Choose a file or a folder inside the repository.".into());
    }
    Ok(joined)
}

/// Commits that deleting `reference` (`refs/heads/…` or `refs/remotes/…`) would lose: on it,
/// and on no other branch, remote branch or tag.
pub fn lost_commits(path: &Path, reference: &str) -> Result<LostCommits, Error> {
    let repo = gix::discover(path)
        .map_err(|e| format!("{} is not a git repository ({e})", path.display()))?;
    let workdir = repo.workdir().unwrap_or(repo.git_dir()).to_owned();
    let git = Git::find(workdir)?;
    ref_id(&repo, reference).ok_or_else(|| format!("There is no {reference}."))?;
    // `--exclude` takes a pattern: match the name exactly.
    let exact = |name: &str| -> String {
        name.chars()
            .flat_map(|c| match c {
                '*' | '?' | '[' | '\\' => vec!['\\', c],
                _ => vec![c],
            })
            .collect()
    };
    let others: Vec<String> = if let Some(name) = reference.strip_prefix("refs/heads/") {
        vec![
            format!("--exclude={}", exact(name)),
            "--branches".into(),
            "--remotes".into(),
            "--tags".into(),
        ]
    } else if let Some(name) = reference.strip_prefix("refs/remotes/") {
        vec![
            "--branches".into(),
            format!("--exclude={}", exact(name)),
            "--remotes".into(),
            "--tags".into(),
        ]
    } else {
        return Err(format!("{reference} isn't a branch."));
    };
    let mut range = vec![reference, "--not"];
    range.extend(others.iter().map(String::as_str));
    let count = git
        .run(&[&["rev-list", "--count"][..], &range].concat())?
        .trim()
        .parse()
        .unwrap_or(0);
    let commits = git
        .run(&[&["rev-list", "--max-count=5"][..], &range].concat())?
        .lines()
        .filter_map(|line| {
            let id = ObjectId::from_hex(line.trim().as_bytes()).ok()?;
            let (summary, time) = summary_of(&repo, id);
            Some(CommitBrief {
                id: id.to_string(),
                summary,
                time,
            })
        })
        .collect();
    Ok(LostCommits { count, commits })
}

/// Local branches that could be pruned: those whose remote branch was deleted, and those
/// merged into the main branch. Never the checked-out branch, one checked out in another
/// worktree, or long-lived ones like main. Reads only; nothing is changed.
pub fn prune_candidates(path: &Path) -> Result<PruneInfo, Error> {
    let repo = gix::discover(path)
        .map_err(|e| format!("{} is not a git repository ({e})", path.display()))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree, so this can't be done here.")?
        .to_owned();
    let git = Git::find(workdir)?;
    let current = current_branch(&repo).ok();

    // What "merged" is measured against: the remote's default branch (where pull requests
    // land), and the local branch of the same name.
    let base = prune_base(&repo);
    let default_name = base
        .as_ref()
        .map(|(_, full)| full.rsplit('/').next().unwrap_or_default().to_owned());
    let mut merged_into: Vec<String> = base.iter().map(|(_, full)| full.clone()).collect();
    if let Some(name) = &default_name {
        let local = format!("refs/heads/{name}");
        if repo
            .try_find_reference(local.as_str())
            .ok()
            .flatten()
            .is_some()
            && !merged_into.contains(&local)
        {
            merged_into.push(local);
        }
    }
    let mut merged = std::collections::HashSet::new();
    for target in &merged_into {
        let listing = git.run(&[
            "for-each-ref",
            &format!("--merged={target}"),
            "--format=%(refname:short)",
            "refs/heads",
        ])?;
        merged.extend(listing.lines().map(str::to_owned));
    }
    // git won't delete a branch that's checked out in any worktree.
    let checked_out: std::collections::HashSet<String> = git
        .run(&["worktree", "list", "--porcelain"])
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.strip_prefix("branch refs/heads/"))
        .map(str::to_owned)
        .collect();

    let listing = git.run(&[
        "for-each-ref",
        "--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)%00%(contents:subject)",
        "refs/heads",
    ])?;
    let config = repo.config_snapshot();
    let mut candidates = Vec::new();
    for line in listing.lines() {
        let fields: Vec<&str> = line.split('\0').collect();
        let [name, id, upstream, track, time, summary] = fields[..] else {
            continue;
        };
        let gone = track == "[gone]";
        let is_merged = merged.contains(name);
        if !(gone || is_merged)
            || current.as_deref() == Some(name)
            || checked_out.contains(name)
            || crate::repo::is_long_lived_branch(name)
            || default_name.as_deref() == Some(name)
        {
            continue;
        }
        let unmerged = match (&base, is_merged) {
            (Some((_, full)), false) => git
                .run(&["rev-list", "--count", &format!("{full}..{id}")])
                .ok()
                .and_then(|count| count.trim().parse().ok())
                .unwrap_or(0),
            _ => 0,
        };
        let setting = |key: &str| {
            config
                .string(format!("branch.{name}.{key}").as_str())
                .map(|value| value.to_str_lossy().into_owned())
        };
        candidates.push(PruneCandidate {
            name: name.to_owned(),
            id: id.to_owned(),
            summary: summary.to_owned(),
            time: time.parse().unwrap_or(0),
            upstream: (!upstream.is_empty()).then(|| upstream.to_owned()),
            gone,
            merged: is_merged,
            unmerged,
            remote: setting("remote"),
            merge: setting("merge"),
        });
    }
    // Gone ones first, then the most recently worked on.
    candidates.sort_by(|a, b| b.gone.cmp(&a.gone).then(b.time.cmp(&a.time)));
    Ok(PruneInfo {
        base: base.map(|(display, _)| display),
        candidates,
    })
}

/// The branch pruning measures "merged" against, as (`origin/main`, `refs/remotes/origin/main`):
/// the default remote's default branch, or a local main, master, develop or trunk.
fn prune_base(repo: &gix::Repository) -> Option<(String, String)> {
    let usual = ["main", "master", "develop", "trunk"];
    let exists = |full: &str| repo.try_find_reference(full).ok().flatten().is_some();
    if let Ok(remote) = default_remote(repo) {
        // What the remote calls its default branch, as recorded by clone or `remote set-head`.
        let head = repo
            .try_find_reference(format!("refs/remotes/{remote}/HEAD").as_str())
            .ok()
            .flatten()
            .and_then(|reference| match reference.target() {
                gix::refs::TargetRef::Symbolic(name) => {
                    Some(name.as_bstr().to_str_lossy().into_owned())
                }
                gix::refs::TargetRef::Object(_) => None,
            })
            .filter(|full| exists(full));
        let found = head.or_else(|| {
            usual
                .iter()
                .map(|name| format!("refs/remotes/{remote}/{name}"))
                .find(|full| exists(full))
        });
        if let Some(full) = found {
            let display = full
                .strip_prefix("refs/remotes/")
                .unwrap_or(&full)
                .to_owned();
            return Some((display, full));
        }
    }
    usual
        .iter()
        .find(|name| exists(&format!("refs/heads/{name}")))
        .map(|name| (name.to_string(), format!("refs/heads/{name}")))
}

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
pub(crate) struct Git {
    executable: PathBuf,
    pub(crate) workdir: PathBuf,
    /// Running on Tributary's own initiative, not because the user asked (for the log).
    pub(crate) background: bool,
}

/// What a fetch, pull or push printed.
struct ProgressOutput {
    /// Messages on standard error, without the progress lines.
    messages: String,
}

impl Git {
    /// Apps started from the macOS Finder don't get the shell's `PATH`, so common
    /// install locations are tried as well.
    pub(crate) fn find(workdir: PathBuf) -> Result<Self, Error> {
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

    /// The password (for GitHub, a token) git's credential helper keeps for `https://{host}`,
    /// if it has one. Never prompts, and gives up after a few seconds.
    pub(crate) fn stored_password(&self, host: &str) -> Option<String> {
        use std::io::Write;
        use std::time::Duration;
        let mut child = command(&self.executable)
            .args(["credential", "fill"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "never")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        child
            .stdin
            .take()?
            .write_all(format!("protocol=https\nhost={host}\n\n").as_bytes())
            .ok()?;
        let mut stdout = child.stdout.take()?;
        let (sender, answer) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stdout.read_to_string(&mut text);
            let _ = sender.send(text);
        });
        let text = answer.recv_timeout(Duration::from_secs(10)).ok();
        let _ = child.kill();
        let _ = child.wait();
        text?
            .lines()
            .find_map(|line| line.strip_prefix("password="))
            .map(str::to_owned)
            .filter(|password| !password.is_empty())
    }

    /// Run git with `args`, returning its output, or its error message.
    pub(crate) fn run(&self, args: &[&str]) -> Result<String, Error> {
        self.run_with_env(args, &[])
    }

    pub(crate) fn run_with_env(
        &self,
        args: &[&str],
        env: &[(&str, &str)],
    ) -> Result<String, Error> {
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
            detail: None,
        });
        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        // Git LFS keeps quiet about its transfers unless it's writing to a terminal. Ask it
        // to log them to a file instead (byte by byte), and to print its own summary lines
        // anyway, for transfers the file doesn't cover.
        let lfs_log =
            std::env::temp_dir().join(format!("tributary-lfs-{}-{id}.log", std::process::id()));
        let _ = std::fs::remove_file(&lfs_log);
        let mut lfs = lfs::ProgressLog::new(lfs_log.clone());
        let mut child = command(&self.executable)
            .arg("-C")
            .arg(&self.workdir)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_MERGE_AUTOEDIT", "no")
            .env("GIT_LFS_PROGRESS", &lfs_log)
            .env("GIT_LFS_FORCE_PROGRESS", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not run git: {e}"))?;
        let stderr = child.stderr.take().ok_or("Could not read git's output")?;
        let stdout = child.stdout.take().ok_or("Could not read git's output")?;

        // git's helper processes share its output pipes and can outlive it when it's
        // cancelled, so the pipes are read on their own threads and never waited for
        // once git itself has exited.
        let (lines, received) = channel::<String>();
        let progress_lines = lines.clone();
        std::thread::spawn(move || {
            read_lines(stderr, |line| {
                let _ = lines.send(line);
            })
        });
        let (output, output_received) = channel::<String>();
        std::thread::spawn(move || {
            // Hooks write to standard output, and Git LFS's upload before a push (a hook)
            // reports its progress there, so progress is picked out of it as it comes.
            let mut text = String::new();
            read_lines(stdout, |line| {
                if is_progress_noise(&line) {
                    let _ = progress_lines.send(line);
                } else {
                    text.push_str(&line);
                    text.push('\n');
                }
            });
            let _ = output.send(text.trim_end().to_owned());
        });

        let child = Arc::new(Mutex::new(child));
        let cancelled = Arc::new(AtomicBool::new(false));
        RUNNING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(Running {
                id,
                child: child.clone(),
                cancelled: cancelled.clone(),
            });

        let mut messages = String::new();
        let mut last: Option<Progress> = None;
        let mut report = |progress: Progress| {
            if last.as_ref() != Some(&progress) {
                on_progress(progress.clone());
                last = Some(progress);
            }
        };
        let mut handle = |text: String, lfs: &mut lfs::ProgressLog| {
            if let Some(progress) = lfs.poll() {
                report(progress);
            }
            if let Some(progress) = parse_progress(&text) {
                // Git LFS's own lines only count files; its log, when there is one, is better.
                let from_lfs = progress.phase.contains("LFS");
                if !(from_lfs && lfs.active()) {
                    report(progress);
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
                Ok(text) => handle(text, &mut lfs),
                Err(RecvTimeoutError::Timeout) => {
                    handle(String::new(), &mut lfs);
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
        let _ = std::fs::remove_file(&lfs_log);
        if cancelled.load(Ordering::SeqCst) {
            record(self, args, started, took, false, "Cancelled.");
            return Err("Cancelled.".into());
        }

        // Whatever git wrote just before exiting.
        while let Ok(text) = received.recv_timeout(Duration::from_millis(200)) {
            handle(text, &mut lfs);
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

/// Read `reader` to the end, a line at a time. git redraws its progress with carriage
/// returns, so those end lines too.
fn read_lines(mut reader: impl Read, mut each: impl FnMut(String)) {
    let mut line = Vec::new();
    let mut chunk = [0u8; 4096];
    while let Ok(read) = reader.read(&mut chunk) {
        if read == 0 {
            break;
        }
        for &byte in &chunk[..read] {
            if byte == b'\r' || byte == b'\n' {
                each(String::from_utf8_lossy(&line).into_owned());
                line.clear();
            } else {
                line.push(byte);
            }
        }
    }
    if !line.is_empty() {
        each(String::from_utf8_lossy(&line).into_owned());
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
        let progress = |phase: &str, percent: u8, detail: Option<&str>| Progress {
            phase: phase.into(),
            percent: Some(percent),
            detail: detail.map(Into::into),
        };
        assert_eq!(
            parse_progress("Receiving objects:  45% (450/1000), 1.2 MiB | 2.0 MiB/s"),
            Some(progress(
                "Receiving objects",
                45,
                Some("1.2 MiB · 2.0 MiB/s")
            ))
        );
        assert_eq!(
            parse_progress("remote: Compressing objects: 100% (3/3), done."),
            Some(progress("Compressing objects", 100, None))
        );
        assert_eq!(
            parse_progress("Writing objects: 100% (6/6), 916 bytes | 916.00 KiB/s, done."),
            Some(progress(
                "Writing objects",
                100,
                Some("916 bytes · 916.00 KiB/s")
            ))
        );
        // Git LFS, with its progress forced on.
        assert_eq!(
            parse_progress("Uploading LFS objects:  67% (2/3), 56 MB | 30 MB/s          "),
            Some(progress(
                "Uploading LFS files",
                67,
                Some("2 of 3 files · 56 MB · 30 MB/s")
            ))
        );
        assert_eq!(
            parse_progress("Uploading LFS objects: 100% (2/2), 0 B | 0 B/s, done."),
            Some(progress("Uploading LFS files", 100, Some("2 of 2 files")))
        );
        assert_eq!(
            parse_progress("Filtering content:  50% (1/2), 15 MB | 7.5 MB/s"),
            Some(progress(
                "Checking out LFS files",
                50,
                Some("1 of 2 files · 15 MB · 7.5 MB/s")
            ))
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
