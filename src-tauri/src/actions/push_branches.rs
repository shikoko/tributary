//! Pushing several branches at once: which have commits a remote doesn't have, and the push.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::remembered::{heads_at, last_commit, only_in, remembered};
use super::remote::default_remote;
use super::validate::{known_remote, require_ref};
use crate::error::{Error, Result};
use crate::git::{Git, Progress, without_credentials};

/// Why a branch is offered (see [`branches_to_push`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PushReason {
    /// Its branch on the remote is there, and this one is ahead of it.
    Ahead,
    /// It pushes to the remote, which doesn't have its branch: a new, empty one, say, or
    /// one it was deleted from. Pushing puts it there.
    Missing,
    /// It was never pushed: pushing makes its branch there, which it then tracks.
    New,
    /// There's no branch here: it's only remembered from the remote's last fetch, and the
    /// remote doesn't have it now. Pushing puts it back there as it was.
    Remembered,
}

/// A branch with commits the remote doesn't have (see [`branches_to_push`]).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BranchToPush {
    pub name: String,
    pub reason: PushReason,
    /// Its branch on the remote, like `origin/feature/export`, when it's there: the commits
    /// are added to it.
    pub on_remote: Option<String>,
    /// Commits it has that the remote doesn't: ahead of its branch there, or, not there,
    /// on none of the remote's branches.
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
    /// Its address, without a password or token in it.
    pub address: String,
    /// The remote was asked just now what it has. When it couldn't be (`problem` says why),
    /// what it had at the last fetch stands in.
    pub checked: bool,
    #[ts(optional = nullable)]
    pub problem: Option<String>,
    /// It has none of the branches remembered from its last fetch: it's new, or emptied, as
    /// when a repository is moved to a new one. Those remembered branches are all offered.
    pub fresh: bool,
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

impl Local<'_> {
    /// The branch it pushes to on `remote`: its upstream's, when that's on `remote`, or one
    /// of its own name.
    fn target(&self, remote: &str) -> String {
        (self.upstream_remote == remote)
            .then(|| {
                self.upstream
                    .strip_prefix(&format!("refs/remotes/{remote}/"))
            })
            .flatten()
            .unwrap_or(self.name)
            .to_owned()
    }
}

/// The local branches.
fn read_locals(git: &Git) -> Result<String> {
    git.run(&[
        "for-each-ref",
        "refs/heads",
        "--format=%(refname:strip=2)%00%(upstream:remotename)%00%(upstream)%00%(contents:subject)%00%(committerdate:unix)",
    ])
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

/// A count git printed.
fn number(text: &str) -> u32 {
    text.trim().parse().unwrap_or(0)
}

/// The branches here with commits `remote` (the default remote when none is given) doesn't
/// have, asked of the remote itself (or, when it can't be reached, as of the last fetch):
/// those on it that are only ahead of their branch there, those it doesn't have, and the
/// branches only remembered from its last fetch that it no longer has. Those behind are
/// named apart, as pushing them would be refused.
pub fn branches_to_push(path: &Path, remote: Option<String>) -> Result<BranchesToPush> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo.workdir().unwrap_or(repo.git_dir()).to_owned();
    let git = Git::find(workdir)?;
    let remote = match remote {
        Some(remote) => known_remote(&repo, &remote)?,
        None => default_remote(&repo)?,
    };
    let address = git
        .run(&["remote", "get-url", "--", &remote])
        .map(|url| without_credentials(url.trim()))
        .unwrap_or_default();
    let remembered: HashMap<String, String> = remembered(&git, &remote)?.into_iter().collect();
    let (theirs, checked, problem) = match heads_at(&git, &remote) {
        Ok(theirs) => (theirs, true, None),
        Err(e) => (remembered.clone(), false, Some(e.to_string())),
    };
    // Remembered ones it no longer has: they don't count as on it.
    let leaving: Vec<String> = remembered
        .keys()
        .filter(|name| !theirs.contains_key(*name))
        .map(|name| format!("{remote}/{name}"))
        .collect();
    let mut not_on_remote = vec![
        "rev-list".to_owned(),
        "--count".to_owned(),
        String::new(),
        "--not".to_owned(),
    ];
    not_on_remote.extend(leaving.iter().map(|name| format!("--exclude={name}")));
    not_on_remote.push(format!("--remotes={remote}"));
    let ahead_of_remote = |branch: &str| -> Result<u32> {
        let mut args: Vec<&str> = not_on_remote.iter().map(String::as_str).collect();
        args[2] = branch;
        Ok(number(&git.run(&args)?))
    };

    let ours = read_locals(&git)?;
    let locals: Vec<Local> = ours.lines().filter_map(parse_local).collect();
    let mut branches = Vec::new();
    let mut behind = Vec::new();
    for local in &locals {
        let branch = format!("refs/heads/{}", local.name);
        let target = local.target(&remote);
        let Some(id) = theirs.get(&target) else {
            branches.push(BranchToPush {
                name: local.name.to_owned(),
                reason: if local.upstream_remote == remote {
                    PushReason::Missing
                } else {
                    PushReason::New
                },
                on_remote: None,
                ahead: ahead_of_remote(&branch)?,
                summary: local.summary.to_owned(),
                time: local.time,
            });
            continue;
        };
        if git
            .run(&["cat-file", "-e", &format!("{id}^{{commit}}")])
            .is_err()
        {
            // The remote has commits not fetched yet: behind, if this one has any of its own.
            if ahead_of_remote(&branch)? > 0 {
                behind.push(local.name.to_owned());
            }
            continue;
        }
        // "behind<TAB>ahead": theirs only, then ours only.
        let counts = git.run(&[
            "rev-list",
            "--count",
            "--left-right",
            &format!("{id}...{branch}"),
        ])?;
        let (theirs_only, ours_only) = counts.trim().split_once('\t').unwrap_or(("0", "0"));
        let (theirs_only, ours_only) = (number(theirs_only), number(ours_only));
        if theirs_only > 0 {
            // Behind only is nothing to push; behind and ahead would be refused.
            if ours_only > 0 {
                behind.push(local.name.to_owned());
            }
        } else if ours_only > 0 {
            branches.push(BranchToPush {
                name: local.name.to_owned(),
                reason: PushReason::Ahead,
                on_remote: Some(format!("{remote}/{target}")),
                ahead: ours_only,
                summary: local.summary.to_owned(),
                time: local.time,
            });
        }
    }
    // Remembered from the last fetch, with no branch here pushing to it, and not on the
    // remote now: unless the remote was asked, it's there as far as is known.
    let targets: HashSet<String> = locals.iter().map(|local| local.target(&remote)).collect();
    if checked {
        for (name, id) in &remembered {
            if theirs.contains_key(name) || targets.contains(name) {
                continue;
            }
            let (summary, time) = last_commit(&git, id);
            branches.push(BranchToPush {
                name: name.clone(),
                reason: PushReason::Remembered,
                on_remote: None,
                ahead: only_in(&git, id, &leaving)?,
                summary,
                time,
            });
        }
    }
    let fresh = checked
        && !remembered.is_empty()
        && remembered.keys().all(|name| !theirs.contains_key(name));
    branches.sort_by(|a, b| b.time.cmp(&a.time).then_with(|| a.name.cmp(&b.name)));
    behind.sort();
    Ok(BranchesToPush {
        remote,
        address,
        checked,
        problem,
        fresh,
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
/// pushed) to one of its name, which it then pulls from and pushes to. And `remembered`, the
/// remote's branches remembered from its last fetch that it no longer has, back to it as
/// they were.
pub(super) fn push_branches(
    repo: &gix::Repository,
    git: &Git,
    names: Vec<String>,
    remote: String,
    remembered: Vec<String>,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    if names.is_empty() && remembered.is_empty() {
        return Err("Choose a branch to push.".into());
    }
    for name in &names {
        require_ref(repo, &format!("refs/heads/{name}"), name)?;
    }
    let remote = known_remote(repo, &remote)?;
    for name in &remembered {
        require_ref(
            repo,
            &format!("refs/remotes/{remote}/{name}"),
            &format!("{remote}/{name}"),
        )?;
    }
    let ours = read_locals(git)?;
    let locals: Vec<Local> = ours.lines().filter_map(parse_local).collect();
    let mut refspecs = Vec::new();
    // The ones without an upstream at all: they track what they make on the remote.
    let mut to_track = Vec::new();
    for name in &names {
        let Some(local) = locals.iter().find(|local| local.name == name) else {
            continue;
        };
        let target = local.target(&remote);
        refspecs.push(format!("refs/heads/{name}:refs/heads/{target}"));
        if local.upstream.is_empty() {
            to_track.push((name.clone(), target));
        }
    }
    for name in &remembered {
        refspecs.push(format!("refs/remotes/{remote}/{name}:refs/heads/{name}"));
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
    let all: Vec<String> = names.into_iter().chain(remembered).collect();
    Ok(format!("Pushed {} to {remote}", some_branches(&all)))
}
