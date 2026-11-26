//! A branch whose remote branch was rebased elsewhere (on another computer, or by someone
//! else, and force-pushed) while it still has the old commits: which of its commits the
//! remote branch's new version has, to take that version in its place, with the commits it
//! hasn't got put on top of it.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::Extra;
use super::backups::{BackupEvent, back_up};
use super::history::{Picked, pick_onto};
use super::lfs_count::checkout_counting;
use super::rewrites::{PairStatus, pairs_from};
use super::support::{count, ref_id};
use super::validate::{commit_id, commit_ids, current_branch};
use crate::error::{Error, Result};
use crate::git::{Git, Progress};

/// Branches with more commits of their own than this aren't compared.
const MOST_COMMITS: u32 = 200;

/// One of the branch's own commits, and its version in the remote branch, if it has one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RebasedCommit {
    pub id: String,
    /// Its id in the remote branch (short), or `None` when that hasn't got it.
    pub now: Option<String>,
    pub summary: String,
    /// Its changes differ a little there: changed while it was rebased, to fit what's under it.
    pub changed: bool,
}

/// A branch and its remote branch, rebased elsewhere: each has commits the other hasn't, and
/// some of the branch's are in the remote branch as new versions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RebasedUpstream {
    pub branch: String,
    /// Like `origin/fix/door`.
    pub upstream: String,
    /// Where the branch and its remote branch are (full ids).
    pub from: String,
    pub to: String,
    /// The branch's own commits (those not in the remote branch as they are), oldest first.
    pub commits: Vec<RebasedCommit>,
    /// Whether the branch is checked out.
    pub current: bool,
}

/// Whether `branch`'s remote branch was rebased with its commits: `None` when it hasn't
/// diverged from it, or when none of its own commits are in it.
pub fn rebased_upstream(path: &Path, branch: &str) -> Result<Option<RebasedUpstream>> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    let full = format!("refs/heads/{branch}");
    let from = (!branch.starts_with('-'))
        .then(|| ref_id(&repo, &full))
        .flatten()
        .ok_or_else(|| format!("There's no branch called {branch}."))?;
    let Ok(tracked) = git.run(&[
        "rev-parse",
        "--symbolic-full-name",
        &format!("{branch}@{{upstream}}"),
    ]) else {
        return Ok(None);
    };
    let Some(upstream) = tracked
        .trim()
        .strip_prefix("refs/remotes/")
        .map(str::to_owned)
    else {
        return Ok(None);
    };
    let Some(to) = ref_id(&repo, &format!("refs/remotes/{upstream}")) else {
        return Ok(None);
    };
    let (from_hex, to_hex) = (from.to_string(), to.to_string());
    let both = format!("{from_hex}...{to_hex}");
    let counts = git.run(&["rev-list", "--count", "--left-right", &both])?;
    let (ahead, behind) = counts
        .trim()
        .split_once('\t')
        .and_then(|(ahead, behind)| Some((ahead.parse::<u32>().ok()?, behind.parse::<u32>().ok()?)))
        .unwrap_or((0, 0));
    if ahead == 0 || behind == 0 || ahead > MOST_COMMITS {
        return Ok(None);
    }
    let own = git.run(&[
        "log",
        "--reverse",
        "--no-merges",
        "--format=%H%x09%s",
        &format!("{to_hex}..{from_hex}"),
    ])?;
    // Each matched with its version in the remote branch (git range-diff): the same changes,
    // or changed a little (as when the rebase met a conflict) under the same summary.
    let output = git.run(&["range-diff", "--no-color", "--creation-factor=95", &both])?;
    let pairs = pairs_from(&output);
    let commits: Vec<RebasedCommit> = own
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(id, summary)| {
            let pair = pairs
                .iter()
                .find(|pair| pair.old.as_deref().is_some_and(|old| id.starts_with(old)));
            let found = pair.and_then(|pair| match pair.status {
                PairStatus::Same => Some((pair.new.clone()?, false)),
                PairStatus::Changed if pair.summary == summary => Some((pair.new.clone()?, true)),
                _ => None,
            });
            RebasedCommit {
                id: id.to_owned(),
                changed: found.as_ref().is_some_and(|(_, changed)| *changed),
                now: found.map(|(now, _)| now),
                summary: summary.to_owned(),
            }
        })
        .collect();
    if commits.iter().all(|commit| commit.now.is_none()) {
        return Ok(None);
    }
    Ok(Some(RebasedUpstream {
        branch: branch.to_owned(),
        upstream,
        from: from_hex,
        to: to_hex,
        commits,
        current: current_branch(&repo).ok().as_deref() == Some(branch),
    }))
}

/// Take the remote branch's version of `branch` in place of its own: move it from `from` to
/// `to`, put `keep` (its commits that version hasn't got, oldest first) on top, and check it
/// out when `checkout`. Its own version is kept in Restore; the new tip goes in `extra.backup`,
/// for undo.
#[allow(clippy::too_many_arguments)]
pub(super) fn take_upstream(
    repo: &gix::Repository,
    git: &Git,
    branch: String,
    from: String,
    to: String,
    keep: Vec<String>,
    checkout: bool,
    on_progress: &dyn Fn(Progress),
    extra: &mut Extra,
) -> Result<String> {
    let full = format!("refs/heads/{branch}");
    let from = commit_id(repo, &from)?;
    let to = commit_id(repo, &to)?;
    let keep = if keep.is_empty() {
        Vec::new()
    } else {
        commit_ids(repo, &keep)?
    };
    if ref_id(repo, &full) != Some(from) {
        return Err(format!("{branch} has changed since: look at it again.").into());
    }
    let upstream = git
        .run(&[
            "rev-parse",
            "--abbrev-ref",
            &format!("{branch}@{{upstream}}"),
        ])
        .map(|name| name.trim().to_owned())
        .unwrap_or_else(|_| "its remote branch".to_owned());
    let current = current_branch(repo).ok().as_deref() == Some(branch.as_str());
    let to_hex = to.to_string();
    if current || checkout {
        if current {
            // Uncommitted changes stay, unless they're to files that differ.
            git.run(&["reset", "--keep", "--quiet", &to_hex])?;
        } else {
            git.run(&["branch", "--force", &branch, &to_hex])?;
            checkout_counting(
                repo,
                git,
                &["switch", "--progress", &branch],
                &full,
                on_progress,
            )?;
        }
        back_up(repo, git, &full, BackupEvent::Reset, from);
        if !keep.is_empty() {
            // Stops at a conflict, to resolve here.
            let mut args = vec!["cherry-pick".to_owned()];
            args.extend(keep.iter().map(ToString::to_string));
            git.run(&args.iter().map(String::as_str).collect::<Vec<_>>())?;
        }
    } else {
        let mut tip = to_hex;
        for id in &keep {
            let short_id = id.to_hex_with_len(7);
            tip = match pick_onto(git, &tip, &id.to_string())? {
                Picked::New(new) => new,
                Picked::Nothing => tip,
                Picked::Conflicts => {
                    return Err(format!(
                        "{short_id} conflicts with {upstream}: check out {branch} to put it on top \
                         there, and resolve the conflicts."
                    )
                    .into());
                }
                Picked::OldGit => {
                    return Err(format!(
                        "This needs git 2.40 or later: check out {branch} to put {short_id} on top there."
                    )
                    .into());
                }
            };
        }
        // Refused if it's checked out in another worktree.
        git.run(&["branch", "--force", &branch, &tip])?;
        back_up(repo, git, &full, BackupEvent::Reset, from);
    }
    extra.backup = ref_id(repo, &full).map(|id| id.to_string());
    Ok(if keep.is_empty() {
        format!("{branch} now matches {upstream}")
    } else {
        format!(
            "{branch} is now {upstream} with {} of yours on top",
            count(keep.len(), "commit")
        )
    })
}

/// Move `branch` from `from` back to `to` (undoing [`take_upstream`]), if it's still at `from`.
/// Checked out, its uncommitted changes stay, unless they're to files that differ.
pub(super) fn move_branch(
    repo: &gix::Repository,
    git: &Git,
    branch: String,
    from: String,
    to: String,
) -> Result<String> {
    let full = format!("refs/heads/{branch}");
    let from = commit_id(repo, &from)?;
    let to = commit_id(repo, &to)?;
    if ref_id(repo, &full) != Some(from) {
        return Err(format!("{branch} has changed since, so it's left as it is.").into());
    }
    if current_branch(repo).ok().as_deref() == Some(branch.as_str()) {
        git.run(&["reset", "--keep", "--quiet", &to.to_string()])?;
    } else {
        git.run(&["branch", "--force", &branch, &to.to_string()])?;
    }
    back_up(repo, git, &full, BackupEvent::Reset, from);
    Ok(format!("Moved {branch} back to {}", to.to_hex_with_len(7)))
}
