//! Pushing several branches at once: which have commits a remote doesn't have, and the push.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::remote::default_remote;
use super::validate::{known_remote, require_ref};
use crate::error::{Error, Result};
use crate::git::{Git, Progress};

/// A branch with commits the remote doesn't have (see [`branches_to_push`]).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BranchToPush {
    pub name: String,
    /// Its branch on the remote, like `origin/feature/export`, when it has one there: the
    /// commits are added to it. `None` when it was never pushed: pushing makes it.
    pub on_remote: Option<String>,
    /// Commits it has that the remote doesn't (as of the last fetch): ahead of its branch
    /// there, or, never pushed, on none of the remote's branches.
    pub ahead: u32,
    /// Its last commit's summary, and when that was committed (seconds).
    pub summary: String,
    pub time: i64,
}

/// The branches here with something to push to a remote (see [`branches_to_push`]).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BranchesToPush {
    pub remote: String,
    /// Newest last commit first.
    pub branches: Vec<BranchToPush>,
    /// Branches behind their branch on the remote (whether or not they're ahead too): a push
    /// would be refused until they're pulled, so they aren't offered.
    pub behind: Vec<String>,
}

/// One local branch, as `for-each-ref` describes it.
struct Local<'a> {
    name: &'a str,
    /// Its upstream's remote, and the upstream (`refs/remotes/origin/main`), if it has one.
    upstream_remote: &'a str,
    upstream: &'a str,
    summary: &'a str,
    time: i64,
}

/// The remote branch `branch` pushes to on `remote`: its upstream when that's there, or the
/// one with its name. `None` when it has neither (it was never pushed there).
fn target_on(local: &Local, remote: &str, theirs: &HashSet<&str>) -> Option<String> {
    if local.upstream_remote == remote && theirs.contains(local.upstream) {
        return Some(local.upstream.to_owned());
    }
    let same = format!("refs/remotes/{remote}/{}", local.name);
    theirs.contains(same.as_str()).then_some(same)
}

/// The local branches and the remote's branches, as last fetched.
fn read_branches(git: &Git, remote: &str) -> Result<(String, String)> {
    let ours = git.run(&[
        "for-each-ref",
        "refs/heads",
        "--format=%(refname:strip=2)%00%(upstream:remotename)%00%(upstream)%00%(contents:subject)%00%(committerdate:unix)",
    ])?;
    let theirs = git.run(&[
        "for-each-ref",
        &format!("refs/remotes/{remote}/"),
        "--format=%(refname)",
    ])?;
    Ok((ours, theirs))
}

fn parse_local(line: &str) -> Option<Local<'_>> {
    let fields: Vec<&str> = line.split('\0').collect();
    let [name, upstream_remote, upstream, summary, time] = fields[..] else {
        return None;
    };
    Some(Local {
        name,
        upstream_remote,
        upstream,
        summary,
        time: time.parse().unwrap_or(0),
    })
}

/// The branches here with commits `remote` (the default remote when none is given) doesn't
/// have, as of the last fetch: those on the remote that are only ahead of their branch there,
/// and those never pushed. Those behind are named apart, as pushing them would be refused.
pub fn branches_to_push(path: &Path, remote: Option<String>) -> Result<BranchesToPush> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo.workdir().unwrap_or(repo.git_dir()).to_owned();
    let git = Git::find(workdir)?;
    let remote = match remote {
        Some(remote) => known_remote(&repo, &remote)?,
        None => default_remote(&repo)?,
    };
    let (ours, theirs) = read_branches(&git, &remote)?;
    let theirs: HashSet<&str> = theirs
        .lines()
        .filter(|name| *name != format!("refs/remotes/{remote}/HEAD"))
        .collect();
    let mut branches = Vec::new();
    let mut behind = Vec::new();
    for local in ours.lines().filter_map(parse_local) {
        let branch = format!("refs/heads/{}", local.name);
        match target_on(&local, &remote, &theirs) {
            Some(target) => {
                // "behind<TAB>ahead": theirs only, then ours only.
                let counts = git.run(&[
                    "rev-list",
                    "--count",
                    "--left-right",
                    &format!("{target}...{branch}"),
                ])?;
                let (theirs_only, ours_only) = counts.trim().split_once('\t').unwrap_or(("0", "0"));
                let (theirs_only, ours_only): (u32, u32) = (
                    theirs_only.parse().unwrap_or(0),
                    ours_only.parse().unwrap_or(0),
                );
                if theirs_only > 0 {
                    // Behind only is nothing to push; behind and ahead would be refused.
                    if ours_only > 0 {
                        behind.push(local.name.to_owned());
                    }
                } else if ours_only > 0 {
                    branches.push(BranchToPush {
                        name: local.name.to_owned(),
                        on_remote: Some(target.trim_start_matches("refs/remotes/").to_owned()),
                        ahead: ours_only,
                        summary: local.summary.to_owned(),
                        time: local.time,
                    });
                }
            }
            None => {
                let ahead = git.run(&[
                    "rev-list",
                    "--count",
                    &branch,
                    "--not",
                    &format!("--remotes={remote}"),
                ])?;
                branches.push(BranchToPush {
                    name: local.name.to_owned(),
                    on_remote: None,
                    ahead: ahead.trim().parse().unwrap_or(0),
                    summary: local.summary.to_owned(),
                    time: local.time,
                });
            }
        }
    }
    branches.sort_by(|a, b| b.time.cmp(&a.time).then_with(|| a.name.cmp(&b.name)));
    behind.sort();
    Ok(BranchesToPush {
        remote,
        branches,
        behind,
    })
}

/// "branch main", "branches main and dev" or "3 branches".
fn some_branches(names: &[String]) -> String {
    match names {
        [one] => format!("branch {one}"),
        [one, two] => format!("branches {one} and {two}"),
        _ => format!("{} branches", names.len()),
    }
}

/// Push the branches `names` to `remote`, in one push: each to its branch there, or (never
/// pushed) to one of its name, which it then pulls from and pushes to.
pub(super) fn push_branches(
    repo: &gix::Repository,
    git: &Git,
    names: Vec<String>,
    remote: String,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    if names.is_empty() {
        return Err("Choose a branch to push.".into());
    }
    for name in &names {
        require_ref(repo, &format!("refs/heads/{name}"), name)?;
    }
    let remote = known_remote(repo, &remote)?;
    let (ours, theirs) = read_branches(git, &remote)?;
    let theirs: HashSet<&str> = theirs.lines().collect();
    let locals: Vec<Local> = ours.lines().filter_map(parse_local).collect();
    let mut refspecs = Vec::new();
    // The ones without an upstream at all: they track what they make on the remote.
    let mut to_track = Vec::new();
    for name in &names {
        let Some(local) = locals.iter().find(|local| local.name == name) else {
            continue;
        };
        let target = target_on(local, &remote, &theirs)
            .map(|target| {
                target
                    .trim_start_matches(&format!("refs/remotes/{remote}/"))
                    .to_owned()
            })
            .unwrap_or_else(|| name.clone());
        refspecs.push(format!("refs/heads/{name}:refs/heads/{target}"));
        if local.upstream.is_empty() {
            to_track.push((name.clone(), target));
        }
    }
    let mut args = vec!["push", "--progress", remote.as_str()];
    args.extend(refspecs.iter().map(String::as_str));
    git.run_progress(&args, on_progress)?;
    for (name, target) in to_track {
        // The push updated refs/remotes/<remote>/<target>, so it's there to track.
        git.run(&[
            "branch",
            &format!("--set-upstream-to={remote}/{target}"),
            &name,
        ])?;
    }
    Ok(format!("Pushed {} to {remote}", some_branches(&names)))
}
