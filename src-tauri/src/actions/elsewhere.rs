//! Files you're working on that someone also changed recently on another branch, since
//! yours split off from it. For code, git can usually merge the two; for assets that can't
//! be merged (stored with Git LFS, lockable, or binary), one version will have to win, so
//! it's better to know before spending a day on it.
//!
//! The files you're working on are your uncommitted changes and your branch's own commits:
//! those that aren't on the main branch (or, on the main branch itself, not pushed yet).
//! Everyone else's work that reached your branch through the main branch isn't yours, and
//! counting it buried the few files that matter under thousands that don't.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::support::{LITERAL, in_batches};
use crate::error::{Error, Result};
use crate::git::Git;

/// Only other branches' commits from the last this many days count: older work isn't
/// "being worked on".
const RECENT_DAYS: i64 = 30;
/// At most this many branches are looked at, the most recently changed first.
const MAX_BRANCHES: usize = 40;

/// A file that's also changed elsewhere, and where.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Overlap {
    pub path: String,
    /// It can't be merged (Git LFS, lockable or binary): one version will have to win.
    pub unmergeable: bool,
    /// Your change is uncommitted (otherwise it's in a commit on your branch).
    pub uncommitted: bool,
    /// The other branches' latest changes to it, newest first.
    pub elsewhere: Vec<OtherChange>,
}

/// The latest change to a file on another branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OtherChange {
    /// Like "origin/art/lighting" or "feature/tags".
    pub branch: String,
    pub commit: String,
    pub summary: String,
    pub author: String,
    /// Seconds since the Unix epoch.
    pub time: i64,
}

/// Files among `changed` (your uncommitted changes) and the files your branch's own commits
/// changed, that other branches changed in the last [`RECENT_DAYS`] days, since yours split
/// off from them.
pub fn changed_elsewhere(path: &Path, changed: &[String]) -> Result<Vec<Overlap>, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let Some(workdir) = repo.workdir().map(Path::to_owned) else {
        return Ok(Vec::new());
    };
    let git = Git::find(workdir)?.in_background();
    let Ok(head) = git.run(&["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]) else {
        return Ok(Vec::new());
    };
    let head = head.trim().to_owned();
    let uncommitted: HashSet<&str> = changed
        .iter()
        .map(String::as_str)
        .filter(|file| !file.is_empty() && !file.ends_with('/'))
        .collect();

    let committed = own_work(&git);
    let since = format!(
        "--since=@{}",
        super::support::now_millis() / 1000 - RECENT_DAYS * 24 * 3600
    );
    let mut found: BTreeMap<String, Overlap> = BTreeMap::new();
    for branch in other_branches(&git, &head)? {
        let Ok(base) = git.run(&["merge-base", &head, &branch.tip]) else {
            continue;
        };
        let base = base.trim().to_owned();
        if base == branch.tip {
            // Everything on it is already on yours.
            continue;
        }
        let theirs = changed_since(&git, &since, &base, &branch.tip);
        if theirs.is_empty() {
            continue;
        }
        let mut overlapping: Vec<&String> = theirs
            .iter()
            .filter(|file| committed.contains(*file) || uncommitted.contains(file.as_str()))
            .collect();
        overlapping.sort();
        for file in overlapping {
            let Some(change) = last_change(&git, &since, &base, &branch, file) else {
                continue;
            };
            found
                .entry(file.clone())
                .or_insert_with(|| Overlap {
                    path: file.clone(),
                    unmergeable: false,
                    uncommitted: uncommitted.contains(file.as_str()),
                    elsewhere: Vec::new(),
                })
                .elsewhere
                .push(change);
        }
    }
    let mut overlaps: Vec<Overlap> = found.into_values().collect();
    let paths: Vec<&str> = overlaps
        .iter()
        .map(|overlap| overlap.path.as_str())
        .collect();
    let unmergeable = unmergeable_files(&git, &paths);
    for overlap in &mut overlaps {
        overlap.unmergeable = unmergeable.contains(&overlap.path);
        overlap
            .elsewhere
            .sort_by_key(|change| std::cmp::Reverse(change.time));
    }
    // Assets that can't be merged first: those are the ones to act on.
    overlaps.sort_by(|a, b| {
        b.unmergeable
            .cmp(&a.unmergeable)
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(overlaps)
}

struct Branch {
    name: String,
    tip: String,
}

/// Local and remote branches other than the checked-out one, changed in the last
/// [`RECENT_DAYS`] days, most recently changed first. A local branch and its remote copy
/// at the same commit count once.
fn other_branches(git: &Git, head: &str) -> Result<Vec<Branch>> {
    let listing = git.run(&[
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(committerdate:unix)%00%(HEAD)",
        "refs/heads",
        "refs/remotes",
    ])?;
    let cutoff = super::support::now_millis() / 1000 - RECENT_DAYS * 24 * 3600;
    let mut seen = HashSet::new();
    let mut branches = Vec::new();
    for line in listing.lines() {
        let [full, name, tip, time, current] = line.split('\0').collect::<Vec<_>>()[..] else {
            continue;
        };
        let time: i64 = time.parse().unwrap_or(0);
        let symbolic = full.starts_with("refs/remotes/") && full.ends_with("/HEAD");
        if current == "*"
            || symbolic
            || tip == head
            || time < cutoff
            || !seen.insert(tip.to_owned())
        {
            continue;
        }
        branches.push(Branch {
            name: name.to_owned(),
            tip: tip.to_owned(),
        });
        if branches.len() == MAX_BRANCHES {
            break;
        }
    }
    Ok(branches)
}

/// The files changed by the commits in `from..to` made `since` then (renames count as both paths).
fn changed_since(git: &Git, since: &str, from: &str, to: &str) -> HashSet<String> {
    let range = format!("{from}..{to}");
    files_of(git.run(&[
        "log",
        "--format=",
        "--name-only",
        "--no-renames",
        "-z",
        since,
        &range,
    ]))
}

fn files_of(listing: Result<String>) -> HashSet<String> {
    listing
        .map(|output| {
            output
                .split(['\0', '\n'])
                .filter(|file| !file.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The files your branch's own commits changed: those not on the main branch, or, on the
/// main branch itself, not pushed yet. Nothing when there's no main branch to go by.
fn own_work(git: &Git) -> HashSet<String> {
    let exists = |reference: &str| {
        git.run(&["rev-parse", "--verify", "--quiet", reference])
            .is_ok()
    };
    // The remote's main branch: what its HEAD points to, or else main or master.
    let remote_main = git
        .run(&["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])
        .ok()
        .map(|reference| reference.trim().to_owned())
        .filter(|reference| exists(reference))
        .or_else(|| {
            ["refs/remotes/origin/main", "refs/remotes/origin/master"]
                .into_iter()
                .find(|reference| exists(reference))
                .map(str::to_owned)
        });
    let local_main = match &remote_main {
        Some(remote) => remote
            .strip_prefix("refs/remotes/origin/")
            .map(|name| format!("refs/heads/{name}")),
        None => ["refs/heads/main", "refs/heads/master"]
            .into_iter()
            .find(|reference| exists(reference))
            .map(str::to_owned),
    };
    let current = git
        .run(&["symbolic-ref", "--quiet", "HEAD"])
        .ok()
        .map(|reference| reference.trim().to_owned());
    let mut not: Vec<String> = remote_main.into_iter().collect();
    // On a branch of its own, the local main branch isn't yours either.
    if let Some(local) = local_main.filter(|local| exists(local) && current.as_ref() != Some(local))
    {
        not.push(local);
    }
    if not.is_empty() {
        return HashSet::new();
    }
    let mut args = vec![
        "log",
        "--format=",
        "--name-only",
        "--no-renames",
        "-z",
        "HEAD",
        "--not",
    ];
    args.extend(not.iter().map(String::as_str));
    files_of(git.run(&args))
}

/// The latest commit on `branch` (since `base`, and recent) that changed `file`.
fn last_change(
    git: &Git,
    since: &str,
    base: &str,
    branch: &Branch,
    file: &str,
) -> Option<OtherChange> {
    let range = format!("{base}..{}", branch.tip);
    let output = git
        .run_with_env(
            &[
                "log",
                "-1",
                "--format=%H%x00%an%x00%at%x00%s",
                since,
                &range,
                "--",
                file,
            ],
            &LITERAL,
        )
        .ok()?;
    let line = output.lines().next()?;
    let [commit, author, time, summary] = line.splitn(4, '\0').collect::<Vec<_>>()[..] else {
        return None;
    };
    Some(OtherChange {
        branch: branch.name.clone(),
        commit: commit.to_owned(),
        summary: summary.to_owned(),
        author: author.to_owned(),
        time: time.parse().unwrap_or(0),
    })
}

/// Which of `paths` can't be merged line by line: stored with Git LFS, marked lockable,
/// or marked binary (`-merge`, `merge=binary`).
pub(super) fn unmergeable_files(git: &Git, paths: &[&str]) -> HashSet<String> {
    let mut found = HashSet::new();
    for batch in in_batches(paths) {
        let mut args = vec!["check-attr", "-z", "filter", "lockable", "merge", "--"];
        args.extend(batch);
        let Ok(output) = git.run_with_env(&args, &LITERAL) else {
            continue;
        };
        // "<path>\0<attribute>\0<value>\0" for each path and attribute.
        let parts: Vec<&str> = output.split('\0').collect();
        for record in parts.chunks(3) {
            if let [file, attribute, value] = record {
                let unmergeable = matches!(
                    (*attribute, *value),
                    ("filter", "lfs")
                        | ("lockable", "set")
                        | ("merge", "unset")
                        | ("merge", "binary")
                );
                if unmergeable {
                    found.insert((*file).to_owned());
                }
            }
        }
    }
    found
}
