//! Files you're working on that someone also changed on another branch, since yours split
//! off from it. For code, git can usually merge the two; for assets that can't be merged
//! (stored with Git LFS, lockable, or binary), one version will have to win, so it's
//! better to know before spending a day on it.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use serde::Serialize;

use super::support::{LITERAL, in_batches};
use crate::error::{Error, Result};
use crate::git::Git;

/// Branches changed longer ago than this aren't looked at.
const RECENT_DAYS: i64 = 30;
/// At most this many branches are looked at, the most recently changed first.
const MAX_BRANCHES: usize = 40;

/// A file that's also changed elsewhere, and where.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlap {
    pub path: String,
    /// It can't be merged (Git LFS, lockable or binary): one version will have to win.
    pub unmergeable: bool,
    /// Your change is uncommitted (otherwise it's in a commit on your branch).
    pub uncommitted: bool,
    pub elsewhere: Vec<OtherChange>,
}

/// The latest change to a file on another branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherChange {
    /// Like "origin/art/lighting" or "feature/tags".
    pub branch: String,
    pub commit: String,
    pub summary: String,
    pub author: String,
    pub time: i64,
}

/// Files among `changed` (your uncommitted changes) and the files your branch changed,
/// that recently changed branches also changed since yours split off from them.
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

    let mut found: BTreeMap<String, Overlap> = BTreeMap::new();
    let mut mine_since: HashMap<String, HashSet<String>> = HashMap::new();
    for branch in other_branches(&git, &head)? {
        let Ok(base) = git.run(&["merge-base", &head, &branch.tip]) else {
            continue;
        };
        let base = base.trim().to_owned();
        if base == branch.tip {
            // Everything on it is already on yours.
            continue;
        }
        let theirs = changed_between(&git, &base, &branch.tip);
        if theirs.is_empty() {
            continue;
        }
        let committed = mine_since
            .entry(base.clone())
            .or_insert_with(|| changed_between(&git, &base, &head));
        let mut overlapping: Vec<&String> = theirs
            .iter()
            .filter(|file| committed.contains(*file) || uncommitted.contains(file.as_str()))
            .collect();
        overlapping.sort();
        for file in overlapping {
            let Some(change) = last_change(&git, &base, &branch, file) else {
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

/// The files that changed between two commits (renames count as both paths).
fn changed_between(git: &Git, from: &str, to: &str) -> HashSet<String> {
    git.run(&["diff", "--name-only", "--no-renames", "-z", from, to])
        .map(|output| {
            output
                .split('\0')
                .filter(|file| !file.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The latest commit on `branch` (since `base`) that changed `file`.
fn last_change(git: &Git, base: &str, branch: &Branch, file: &str) -> Option<OtherChange> {
    let range = format!("{base}..{}", branch.tip);
    let output = git
        .run_with_env(
            &[
                "log",
                "-1",
                "--format=%H%x00%an%x00%at%x00%s",
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
fn unmergeable_files(git: &Git, paths: &[&str]) -> HashSet<String> {
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
