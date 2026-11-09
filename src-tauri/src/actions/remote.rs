//! Fetching, pulling and pushing.

use gix::bstr::ByteSlice;

use super::Extra;
use super::backups::{BackupEvent, back_up};
use super::support::ref_id;
use super::validate::current_branch;
use crate::error::{Error, Result};
use crate::git::{Git, Progress};
use crate::links;

/// Fetch from every remote. `background` fetches never show sign-in prompts.
pub(super) fn fetch(
    repo: &gix::Repository,
    git: &Git,
    background: bool,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    if repo.remote_names().is_empty() {
        return Err("This repository has no remotes to fetch from.".into());
    }
    if background {
        // Nobody asked for this fetch, so never pop up a sign-in window for it.
        let git = git.in_background();
        git.run_with_env(
            &["fetch", "--all", "--prune", "--quiet"],
            &[("GCM_INTERACTIVE", "never")],
        )?;
    } else {
        git.run_progress(&["fetch", "--all", "--prune", "--progress"], on_progress)?;
    }
    Ok("Fetched from all remotes".into())
}

/// Pull into the checked-out branch.
pub(super) fn pull(
    repo: &gix::Repository,
    git: &Git,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    let branch = current_branch(repo)?;
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
    // git fills in each Git LFS file as it checks it out, and LFS downloads each then, one
    // request a file. So fetch first, download the Git LFS files the pull brings all
    // together, then pull: its checkout finds them here (and its fetch has nothing to do).
    let before = git
        .run(&["rev-parse", "--verify", "--quiet", "HEAD"])
        .ok()
        .map(|id| id.trim().to_owned());
    let common = repo.common_dir().to_owned();
    if let Some(before) = &before
        && git.run(&["lfs", "version"]).is_ok()
    {
        git.run_progress(&["fetch", "--progress"], on_progress)?;
        super::lfs_count::prefetch(
            git,
            &common,
            &format!("{before}...@{{upstream}}"),
            "@{upstream}",
            on_progress,
        )?;
    }
    // Whatever's still to download then, one at a time, is at least counted.
    let expected = |seen: &std::collections::HashSet<String>| {
        let before = before.as_deref()?;
        super::lfs_count::lfs_downloads(
            git,
            &common,
            &format!("{before}...@{{upstream}}"),
            "@{upstream}",
            seen,
        )
    };
    git.run_progress_counting(&args, &[], on_progress, &expected)?;
    Ok(format!("Pulled {branch}"))
}

/// Push the checked-out branch, setting its upstream if it has none.
/// `force` uses `--force-with-lease`.
pub(super) fn push(
    repo: &gix::Repository,
    git: &Git,
    force: bool,
    no_verify: bool,
    on_progress: &dyn Fn(Progress),
    extra: &mut Extra,
) -> Result<String> {
    let branch = current_branch(repo)?;
    let mut args = vec!["push".to_owned(), "--progress".to_owned()];
    if force {
        args.push("--force-with-lease".into());
    }
    // Without the repository's pre-push hook, when it stopped the push.
    if no_verify {
        args.push("--no-verify".into());
    }
    // What a force push replaces on the remote, to keep a backup of.
    let mut replaced = None;
    let remote = match push_target(repo, &branch) {
        Some((remote, remote_branch)) => {
            if force && let Some(leaf) = remote_branch.strip_prefix("refs/heads/") {
                let tracking = format!("refs/remotes/{remote}/{leaf}");
                replaced = ref_id(repo, &tracking).map(|id| (tracking, id));
            }
            args.extend([remote.clone(), format!("HEAD:{remote_branch}")]);
            remote
        }
        None => {
            let remote = default_remote(repo)?;
            args.extend(["--set-upstream".into(), remote.clone(), "HEAD".into()]);
            remote
        }
    };
    // The files the pushed commits change (the ones the remote doesn't have yet): after the
    // push, locks on them can be released.
    let pushed_files = files_not_on(git, &remote);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = git
        .run_progress(&args, on_progress)
        .map_err(|error| super::hooks::explain(git, error, true))?;
    extra.pushed_files = pushed_files;
    if let Some((tracking, id)) = replaced
        && ref_id(repo, "HEAD") != Some(id)
    {
        back_up(repo, git, &tracking, BackupEvent::ForcePushed, id);
    }
    extra.pull_request = links::pull_request_url(&output.messages);
    Ok(format!(
        "{} {branch} to {remote}",
        if force { "Force pushed" } else { "Pushed" }
    ))
}

/// The files changed by the commits on HEAD that `remote` doesn't have yet.
fn files_not_on(git: &Git, remote: &str) -> Vec<String> {
    let remotes = format!("--remotes={remote}");
    let Ok(output) = git.run(&[
        "log",
        "--format=",
        "--name-only",
        "-z",
        "HEAD",
        "--not",
        &remotes,
    ]) else {
        return Vec::new();
    };
    let mut files: Vec<String> = output
        .split(['\0', '\n'])
        .filter(|file| !file.is_empty())
        .map(str::to_owned)
        .collect();
    files.sort();
    files.dedup();
    files
}

/// Where the checked-out `branch` pushes to: its remote and the remote branch it
/// tracks, from the branch's configuration.
pub(super) fn push_target(repo: &gix::Repository, branch: &str) -> Option<(String, String)> {
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
pub(super) fn default_remote(repo: &gix::Repository) -> Result<String, Error> {
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
        return Err(format!("Unsupported remote name {remote}").into());
    }
    Ok(remote)
}
