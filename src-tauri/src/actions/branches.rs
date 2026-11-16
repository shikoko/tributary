//! Checking out, creating, deleting, renaming and resetting branches.

use std::path::Path;

use gix::ObjectId;
use gix::bstr::ByteSlice;
use serde::Serialize;
use ts_rs::TS;

use super::BranchTip;
use super::backups::{BackupEvent, back_up, split_remote_branch};
use super::lfs_count::checkout_counting;
use super::support::ref_id;
use super::validate::{check_new_branch_name, commit_id, current_branch, require_ref};
use crate::error::{Error, Result};
use crate::git::{Git, Progress};

/// `git reset --hard <id>` on the checked-out branch.
pub(super) fn reset_hard(repo: &gix::Repository, git: &Git, id: String) -> Result<String> {
    let id = commit_id(repo, &id)?;
    let branch = current_branch(repo).unwrap_or_else(|_| "HEAD".into());
    let full_name = format!("refs/heads/{branch}");
    let before = ref_id(repo, &full_name);
    git.run(&["reset", "--hard", "--quiet", &id.to_string()])?;
    if let Some(before) = before.filter(|before| *before != id) {
        back_up(repo, git, &full_name, BackupEvent::Reset, before);
    }
    Ok(format!("Reset {branch} to {}", id.to_hex_with_len(7)))
}

/// Switch to a local branch.
pub(super) fn checkout_branch(
    repo: &gix::Repository,
    git: &Git,
    name: String,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    require_ref(repo, &format!("refs/heads/{name}"), &name)?;
    checkout_counting(
        repo,
        git,
        &["switch", "--progress", &name],
        &format!("refs/heads/{name}"),
        on_progress,
    )?;
    Ok(format!("Checked out {name}"))
}

/// Create a local branch tracking a remote branch like `origin/feature`, and switch to it.
pub(super) fn checkout_remote_branch(
    repo: &gix::Repository,
    git: &Git,
    name: String,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    require_ref(repo, &format!("refs/remotes/{name}"), &name)?;
    let local = name
        .split_once('/')
        .map_or(name.as_str(), |(_, branch)| branch);
    let Some(local_id) = ref_id(repo, &format!("refs/heads/{local}")) else {
        checkout_counting(
            repo,
            git,
            &["switch", "--progress", "--track", &name],
            &format!("refs/remotes/{name}"),
            on_progress,
        )?;
        return Ok(format!("Checked out {local}, tracking {name}"));
    };
    // There's a local branch already: check it out, and when it only lags behind the
    // remote one (and tracks it, or nothing), bring it up to date: a fast-forward.
    let remote_id = ref_id(repo, &format!("refs/remotes/{name}"))
        .ok_or_else(|| format!("There's no {name}."))?;
    let upstream = git
        .run(&[
            "rev-parse",
            "--abbrev-ref",
            &format!("{local}@{{upstream}}"),
        ])
        .ok()
        .map(|upstream| upstream.trim().to_owned());
    let tracks = upstream.as_deref().is_none_or(|upstream| upstream == name);
    let current = current_branch(repo).ok().as_deref() == Some(local);
    let behind = remote_id != local_id
        && git
            .run(&[
                "merge-base",
                "--is-ancestor",
                &local_id.to_string(),
                &remote_id.to_string(),
            ])
            .is_ok();
    if !tracks || !behind {
        if !current {
            checkout_counting(
                repo,
                git,
                &["switch", "--progress", local],
                &format!("refs/heads/{local}"),
                on_progress,
            )?;
        }
        let ahead = remote_id != local_id
            && git
                .run(&[
                    "merge-base",
                    "--is-ancestor",
                    &remote_id.to_string(),
                    &local_id.to_string(),
                ])
                .is_ok();
        return Ok(if remote_id == local_id {
            format!("Checked out {local}, the same as {name}")
        } else if !tracks {
            format!(
                "Checked out {local} (it tracks {}, not {name})",
                upstream.unwrap_or_default()
            )
        } else if ahead {
            format!("Checked out {local}, which is ahead of {name}")
        } else {
            format!(
                "Checked out {local}: it and {name} have both changed, so it wasn't updated (pull to merge them)"
            )
        });
    }
    let behind_by = git
        .run(&["rev-list", "--count", &format!("{local_id}..{remote_id}")])
        .ok()
        .and_then(|count| count.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let commits = if behind_by == 1 {
        "1 commit".to_owned()
    } else {
        format!("{behind_by} commits")
    };
    if current {
        checkout_counting(
            repo,
            git,
            &["merge", "--ff-only", "--progress", &name],
            &name,
            on_progress,
        )?;
    } else {
        // Move the branch first, so its files are only checked out once (at the new commit),
        // and only if it's still where it was.
        git.run(&[
            "update-ref",
            "-m",
            &format!("Tributary: fast-forward to {name}"),
            &format!("refs/heads/{local}"),
            &remote_id.to_string(),
            &local_id.to_string(),
        ])?;
        if let Err(error) = checkout_counting(
            repo,
            git,
            &["switch", "--progress", local],
            &format!("refs/heads/{local}"),
            on_progress,
        ) {
            return Err(format!("Brought {local} up to date with {name} ({commits}), but couldn't check it out: {error}").into());
        }
    }
    if upstream.is_none() {
        let _ = git.run(&[
            "branch",
            "--quiet",
            &format!("--set-upstream-to={name}"),
            local,
        ]);
    }
    Ok(format!(
        "Checked out {local} and brought it up to date with {name} ({commits})"
    ))
}

/// Check out a commit without a branch (detached HEAD).
pub(super) fn checkout_commit(
    repo: &gix::Repository,
    git: &Git,
    id: String,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    let id = commit_id(repo, &id)?;
    let id_text = id.to_string();
    checkout_counting(
        repo,
        git,
        &["switch", "--progress", "--detach", &id_text],
        &id_text,
        on_progress,
    )?;
    Ok(format!(
        "Checked out {} (detached HEAD)",
        id.to_hex_with_len(7)
    ))
}

/// Create a branch at a commit, and optionally switch to it.
pub(super) fn create_branch(
    repo: &gix::Repository,
    git: &Git,
    name: String,
    id: String,
    checkout: bool,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    let name = name.trim().to_owned();
    check_new_branch_name(repo, git, &name)?;
    let id = commit_id(repo, &id)?.to_string();
    if checkout {
        checkout_counting(
            repo,
            git,
            &["switch", "--progress", "--create", &name, &id],
            &id,
            on_progress,
        )?;
        Ok(format!("Created and checked out {name}"))
    } else {
        git.run(&["branch", &name, &id])?;
        Ok(format!("Created {name}"))
    }
}

/// `git reset --soft <id>`: move the branch, keeping all changes staged.
pub(super) fn reset_soft(repo: &gix::Repository, git: &Git, id: String) -> Result<String> {
    let id = commit_id(repo, &id)?;
    let branch = current_branch(repo).unwrap_or_else(|_| "HEAD".into());
    git.run(&["reset", "--soft", "--quiet", &id.to_string()])?;
    Ok(format!(
        "Moved {branch} back to {}; the changes are staged",
        id.to_hex_with_len(7)
    ))
}

/// Delete a local branch. Without `force`, git refuses if it isn't merged.
pub(super) fn delete_branch(
    repo: &gix::Repository,
    git: &Git,
    name: String,
    force: bool,
) -> Result<String> {
    require_ref(repo, &format!("refs/heads/{name}"), &name)?;
    if current_branch(repo).ok().as_deref() == Some(name.as_str()) {
        return Err(format!("{name} is checked out. Check out another branch first.").into());
    }
    let full_name = format!("refs/heads/{name}");
    let before = ref_id(repo, &full_name);
    git.run(&["branch", if force { "-D" } else { "-d" }, &name])?;
    if let Some(id) = before {
        back_up(repo, git, &full_name, BackupEvent::Deleted, id);
    }
    Ok(format!("Deleted branch {name}"))
}

/// Delete several local branches (pruning), each only if it still points at the
/// commit given. The ones that can't be deleted are reported; the rest still go.
pub(super) fn delete_branches(
    repo: &gix::Repository,
    git: &Git,
    branches: Vec<BranchTip>,
) -> Result<String> {
    let current = current_branch(repo).ok();
    let mut deleted = Vec::new();
    let mut failed = Vec::new();
    for tip in &branches {
        let result = (|| {
            let full_name = format!("refs/heads/{}", tip.name);
            require_ref(repo, &full_name, &tip.name)?;
            if current.as_deref() == Some(tip.name.as_str()) {
                return Err(Error::from("it's checked out"));
            }
            let now = repo
                .find_reference(full_name.as_str())
                .ok()
                .and_then(|mut reference| reference.peel_to_id().ok())
                .map(|id| id.to_string());
            if now.as_deref() != Some(tip.id.as_str()) {
                return Err(Error::from("it has new commits since"));
            }
            // The commits were checked against the base branch (which may be a
            // remote one, where `-d` only knows about the checked-out branch).
            git.run(&["branch", "-D", &tip.name])?;
            if let Ok(id) = ObjectId::from_hex(tip.id.as_bytes()) {
                back_up(repo, git, &full_name, BackupEvent::Deleted, id);
            }
            Ok(())
        })();
        match result {
            Ok(()) => deleted.push(tip.name.clone()),
            Err(error) => failed.push(format!("{} ({})", tip.name, error.to_string().trim())),
        }
    }
    if deleted.is_empty() {
        return Err(format!("Couldn't delete {}", failed.join(", ")).into());
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

/// Put back deleted branches, with the upstream they had (undoing a prune).
pub(super) fn restore_branches(
    repo: &gix::Repository,
    git: &Git,
    branches: Vec<BranchTip>,
) -> Result<String> {
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
            check_new_branch_name(repo, git, &tip.name)?;
            let id = commit_id(repo, &tip.id)?;
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
            Err(error) => failed.push(format!("{} ({})", tip.name, error.to_string().trim())),
        }
    }
    if restored == 0 {
        if failed.is_empty() {
            return Ok("Nothing to restore: the branches are all there".into());
        }
        return Err(format!("Couldn't restore {}", failed.join(", ")).into());
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

/// Delete a branch like `origin/feature` from its remote.
pub(super) fn delete_remote_branch(
    repo: &gix::Repository,
    git: &Git,
    name: String,
) -> Result<String> {
    require_ref(repo, &format!("refs/remotes/{name}"), &name)?;
    let (remote, branch) = name
        .split_once('/')
        .ok_or_else(|| format!("{name} isn't a remote branch."))?;
    let is_remote = repo
        .remote_names()
        .iter()
        .any(|known| known.to_str_lossy() == remote);
    if !is_remote || branch.starts_with('-') {
        return Err(format!("{name} isn't a remote branch.").into());
    }
    let full_name = format!("refs/remotes/{name}");
    let before = ref_id(repo, &full_name);
    git.run(&["push", "--quiet", remote, "--delete", branch])?;
    if let Some(id) = before {
        back_up(repo, git, &full_name, BackupEvent::DeletedFromRemote, id);
    }
    Ok(format!("Deleted {branch} from {remote}"))
}

/// Push a deleted remote branch like `origin/feature` back, at commit `id` (undo).
pub(super) fn restore_remote_branch(
    repo: &gix::Repository,
    git: &Git,
    name: String,
    id: String,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    let (remote, branch) = split_remote_branch(repo, &name)?;
    let id = commit_id(repo, &id)?;
    if ref_id(repo, &format!("refs/remotes/{name}")).is_some() {
        return Err(format!("{name} exists again, so it wasn't pushed back.").into());
    }
    let refspec = format!("{id}:refs/heads/{branch}");
    git.run_progress(&["push", "--progress", &remote, &refspec], on_progress)?;
    Ok(format!("Pushed {branch} back to {remote}"))
}

/// Rename a local branch.
pub(super) fn rename_branch(
    repo: &gix::Repository,
    git: &Git,
    name: String,
    new_name: String,
) -> Result<String> {
    require_ref(repo, &format!("refs/heads/{name}"), &name)?;
    let new_name = new_name.trim();
    check_new_branch_name(repo, git, new_name)?;
    git.run(&["branch", "--move", &name, new_name])?;
    Ok(format!("Renamed {name} to {new_name}"))
}

/// Make `branch` pull from and push to `upstream` (a remote branch: "origin/main"), or to
/// none; with `rename_to`, rename it too (its remote branch goes with it).
pub(super) fn set_upstream(
    repo: &gix::Repository,
    git: &Git,
    branch: String,
    upstream: Option<String>,
    rename_to: Option<String>,
) -> Result<String> {
    require_ref(repo, &format!("refs/heads/{branch}"), &branch)?;
    let rename_to = rename_to
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty() && *name != branch);
    if let Some(name) = &rename_to {
        check_new_branch_name(repo, git, name)?;
    }
    match &upstream {
        Some(upstream) => {
            require_ref(repo, &format!("refs/remotes/{upstream}"), upstream)?;
            git.run(&["branch", &format!("--set-upstream-to={upstream}"), &branch])?;
        }
        None => {
            git.run(&["branch", "--unset-upstream", &branch])?;
        }
    }
    let name = match &rename_to {
        Some(name) => {
            git.run(&["branch", "--move", &branch, name])?;
            name.clone()
        }
        None => branch.clone(),
    };
    Ok(match (&upstream, &rename_to) {
        (Some(upstream), Some(name)) => {
            format!("Renamed {branch} to {name}, which now goes with {upstream}")
        }
        (Some(upstream), None) => format!("{name} now goes with {upstream}"),
        (None, _) => format!("{name} no longer goes with a remote branch"),
    })
}

/// What a branch whose remote branch is gone (renamed or deleted on the remote) could go
/// with instead: the remote's branches, and the likely one.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamChoices {
    /// The remote the branch goes with: "origin".
    pub remote: String,
    /// The remote branch it went with, which is gone: "origin/master".
    pub gone: String,
    /// The remote's main branch, as the remote says now ("origin/main"), if known.
    pub default_branch: Option<String>,
    /// The likely one: the remote branch with the branch's own name, or else the remote's
    /// main branch.
    pub suggested: Option<String>,
    /// The suggested one has every commit the gone one had (when that's known here).
    pub suggested_has_all: bool,
    /// The remote's branches, the suggested one first, then the newest first.
    pub branches: Vec<RemoteBranchChoice>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranchChoice {
    /// "origin/main".
    pub name: String,
    /// Its newest commit's summary and author, and when it was committed (seconds).
    pub summary: String,
    pub author: String,
    pub time: i64,
}

/// See [`UpstreamChoices`]. `branch` is a local branch with a remote branch configured.
pub fn upstream_choices(path: &Path, branch: &str) -> Result<UpstreamChoices> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo.workdir().unwrap_or(repo.git_dir()).to_owned();
    let git = Git::find(workdir)?;
    let config = |key: String| {
        git.run(&["config", "--get", &key])
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    };
    let remote = config(format!("branch.{branch}.remote"))
        .ok_or_else(|| format!("{branch} doesn't go with a remote branch."))?;
    let merge = config(format!("branch.{branch}.merge"))
        .ok_or_else(|| format!("{branch} doesn't go with a remote branch."))?;
    let gone = format!(
        "{remote}/{}",
        merge.strip_prefix("refs/heads/").unwrap_or(&merge)
    );
    let exists = |name: &str| ref_id(&repo, &format!("refs/remotes/{name}")).is_some();
    // The remote's main branch, as it says now (it may have been renamed there too), or as
    // it was last fetched.
    let default_branch = git
        .run(&["ls-remote", "--symref", "--", &remote, "HEAD"])
        .ok()
        .and_then(|output| {
            output.lines().find_map(|line| {
                let target = line.strip_prefix("ref: ")?.split('\t').next()?;
                Some(format!("{remote}/{}", target.strip_prefix("refs/heads/")?))
            })
        })
        .or_else(|| {
            let target = git
                .run(&[
                    "symbolic-ref",
                    "--quiet",
                    &format!("refs/remotes/{remote}/HEAD"),
                ])
                .ok()?;
            Some(target.trim().strip_prefix("refs/remotes/")?.to_owned())
        })
        .filter(|name| exists(name));
    let same_name = format!("{remote}/{branch}");
    let suggested = [Some(same_name), default_branch.clone()]
        .into_iter()
        .flatten()
        .find(|name| *name != gone && exists(name));
    // Whether it has everything the gone one had: known while its copy here is left.
    let suggested_has_all = match (&suggested, ref_id(&repo, &format!("refs/remotes/{gone}"))) {
        (Some(name), Some(old)) => git
            .run(&[
                "merge-base",
                "--is-ancestor",
                &old.to_string(),
                &format!("refs/remotes/{name}"),
            ])
            .is_ok(),
        _ => false,
    };
    let listed = git.run(&[
        "for-each-ref",
        "--sort=-committerdate",
        "--count=200",
        "--format=%(refname:short)%1f%(subject)%1f%(authorname)%1f%(committerdate:unix)%1f%(symref)",
        &format!("refs/remotes/{remote}/"),
    ])?;
    let mut branches: Vec<RemoteBranchChoice> = listed
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let name = parts.next()?.to_owned();
            let summary = parts.next()?.to_owned();
            let author = parts.next()?.to_owned();
            let time = parts.next()?.trim().parse().ok()?;
            // Not the remote's HEAD (a pointer to another branch), nor the gone one.
            let symref = parts.next().unwrap_or("");
            (symref.is_empty() && name != gone && name != remote).then_some(RemoteBranchChoice {
                name,
                summary,
                author,
                time,
            })
        })
        .collect();
    if let Some(name) = &suggested
        && let Some(at) = branches.iter().position(|choice| choice.name == *name)
    {
        let first = branches.remove(at);
        branches.insert(0, first);
    }
    Ok(UpstreamChoices {
        remote,
        gone,
        default_branch,
        suggested,
        suggested_has_all,
        branches,
    })
}
