//! Where branches were before Tributary deleted, reset, rebased or force-pushed them,
//! kept as hidden refs so they can be put back, and changes thrown away by a discard.

use std::path::Path;

use gix::ObjectId;
use gix::bstr::ByteSlice;
use serde::Serialize;
use ts_rs::TS;

use super::support::{now_millis, ref_id, summary_of};
use super::validate::check_new_branch_name;
use crate::error::{Error, Result};
use crate::git::{Git, Progress};

/// Put back what a backup kept (see [`backups`]).
pub(super) fn restore_backup(
    repo: &gix::Repository,
    git: &Git,
    reference: String,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    restore(repo, git, &reference, on_progress)
}

/// Forget a backup.
pub(super) fn remove_backup(git: &Git, reference: String) -> Result<String> {
    let (_, _, _, name) =
        parse_backup(&reference).ok_or_else(|| format!("{reference} isn't a backup."))?;
    git.run(&["update-ref", "-d", &reference])?;
    Ok(format!("Removed the backup of {name}"))
}

/// Where a branch was before Tributary deleted, reset, rebased or force-pushed it, kept
/// for [`BACKUP_DAYS`] days so it can be put back.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    /// The backup's own ref, under `refs/tributary/backups/`.
    pub reference: String,
    pub event: BackupEvent,
    /// The branch, like `feat/x`, or `origin/feat/x` for a remote one.
    pub name: String,
    pub remote: bool,
    /// The commit it pointed to, its summary, and when the backup was made.
    pub id: String,
    pub summary: String,
    /// When the backup was made (seconds).
    pub time: i64,
    /// Where the branch points now, if it still exists.
    pub current: Option<String>,
}

/// What happened to a branch that made Tributary keep a backup of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum BackupEvent {
    Deleted,
    DeletedFromRemote,
    ForcePushed,
    Reset,
    Rebased,
}

impl BackupEvent {
    const ALL: [BackupEvent; 5] = [
        BackupEvent::Deleted,
        BackupEvent::DeletedFromRemote,
        BackupEvent::ForcePushed,
        BackupEvent::Reset,
        BackupEvent::Rebased,
    ];

    /// Its name in a backup's ref.
    fn as_str(self) -> &'static str {
        match self {
            BackupEvent::Deleted => "deleted",
            BackupEvent::DeletedFromRemote => "deletedFromRemote",
            BackupEvent::ForcePushed => "forcePushed",
            BackupEvent::Reset => "reset",
            BackupEvent::Rebased => "rebased",
        }
    }

    fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|event| event.as_str() == name)
    }
}

/// Where backups of branches are kept.
pub(super) const BACKUPS: &str = "refs/tributary/backups/";
/// How long a backup is kept.
pub const BACKUP_DAYS: i64 = 30;

/// Keep `id`, where `full_name` (`refs/heads/…` or `refs/remotes/…`) pointed before
/// `event`, as `refs/tributary/backups/<when>/<event>/<heads|remotes>/<name>`. That also
/// keeps its commits from garbage collection. Old backups are dropped. Never fails the
/// action it's part of.
pub(super) fn back_up(
    repo: &gix::Repository,
    git: &Git,
    full_name: &str,
    event: BackupEvent,
    id: ObjectId,
) {
    let Some(rest) = full_name.strip_prefix("refs/") else {
        return;
    };
    let backup = format!("{BACKUPS}{}/{}/{rest}", now_millis(), event.as_str());
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
pub(super) fn back_up_rewrite(
    repo: &gix::Repository,
    git: &Git,
    branch: &str,
    before: Option<ObjectId>,
) {
    let Some(before) = before else {
        return;
    };
    let full_name = format!("refs/heads/{branch}");
    let stopped = gix::open(repo.git_dir())
        .ok()
        .and_then(|fresh| fresh.state())
        .is_some();
    if stopped || ref_id(repo, &full_name) != Some(before) {
        back_up(repo, git, &full_name, BackupEvent::Rebased, before);
    }
}

/// `refs/tributary/backups/<millis>/<event>/<heads|remotes>/<name>` → its parts.
pub(super) fn parse_backup(reference: &str) -> Option<(i64, BackupEvent, bool, String)> {
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
        BackupEvent::from_name(event)?,
        remote,
        name.to_owned(),
    ))
}

pub(super) type BackupParts = (i64, BackupEvent, bool, String);

/// Every backup ref, with its parts.
pub(super) fn backup_refs(repo: &gix::Repository) -> Vec<(String, BackupParts)> {
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

/// The backups kept in the last [`BACKUP_DAYS`] days, newest first.
pub fn backups(path: &Path) -> Result<Vec<Backup>, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
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
pub(super) fn free_branch_name(repo: &gix::Repository, base: &str) -> String {
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
pub(super) fn split_remote_branch(
    repo: &gix::Repository,
    name: &str,
) -> Result<(String, String), Error> {
    repo.remote_names()
        .iter()
        .map(|remote| remote.to_str_lossy().into_owned())
        .filter_map(|remote| {
            let branch = name.strip_prefix(&format!("{remote}/"))?.to_owned();
            Some((remote, branch))
        })
        .max_by_key(|(remote, _)| remote.len())
        .filter(|(remote, branch)| !remote.starts_with('-') && !branch.is_empty())
        .ok_or_else(|| Error::Message(format!("{name} isn't a branch of a remote here.")))
}

/// Put back what a backup kept. Never overwrites anything: when the branch has changed
/// since, the earlier version becomes a new branch beside it.
fn restore(
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
    if event == BackupEvent::DeletedFromRemote
        && ref_id(repo, &format!("refs/remotes/{name}")).is_none()
    {
        let refspec = format!("{id}:refs/heads/{branch}");
        git.run_progress(&["push", "--progress", &remote_name, &refspec], on_progress)?;
        return Ok(format!("Pushed {branch} back to {remote_name}"));
    }
    let suffix = if event == BackupEvent::ForcePushed {
        "before-force-push"
    } else {
        "restored"
    };
    let local = new_branch(&format!("{branch}-{suffix}"))?;
    Ok(format!(
        "The earlier version of {name} is now the local branch {local}"
    ))
}

/// Where discarded changes are kept.
pub(super) const DISCARDED: &str = "refs/tributary/discarded/";

/// Remove discarded changes kept longer than [`BACKUP_DAYS`] days.
pub(super) fn forget_old_discards(repo: &gix::Repository, git: &Git) {
    let cutoff = now_millis() - BACKUP_DAYS * 24 * 3600 * 1000;
    let Ok(references) = repo.references() else {
        return;
    };
    let Ok(found) = references.prefixed(DISCARDED) else {
        return;
    };
    for reference in found.flatten() {
        let name = reference.name().as_bstr().to_str_lossy().into_owned();
        let millis = name
            .strip_prefix(DISCARDED)
            .and_then(|millis| millis.parse::<i64>().ok());
        if millis.is_some_and(|millis| millis < cutoff) {
            let _ = git.run(&["update-ref", "-d", &name]);
        }
    }
}
