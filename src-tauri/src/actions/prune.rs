//! Finding branches to prune, and the commits deleting a branch would lose.

use std::path::Path;

use gix::ObjectId;
use gix::bstr::ByteSlice;
use serde::Serialize;

use super::remote::default_remote;
use super::support::{ref_id, summary_of};
use super::validate::current_branch;
use crate::error::{Error, Result};
use crate::git::Git;

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

/// Commits that deleting `reference` (`refs/heads/…` or `refs/remotes/…`) would lose: on it,
/// and on no other branch, remote branch or tag.
pub fn lost_commits(path: &Path, reference: &str) -> Result<LostCommits, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
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
        return Err(format!("{reference} isn't a branch.").into());
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
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
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
pub(super) fn prune_base(repo: &gix::Repository) -> Option<(String, String)> {
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
