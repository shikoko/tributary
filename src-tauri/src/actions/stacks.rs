//! Stacked branches: a branch built on another one that isn't merged yet (`feat/menu` on
//! top of `feat/api`, itself on top of main). Rebasing or rewriting one moves the branches
//! built on its commits along (git's `--update-refs`, from 2.38), and when the branch below
//! was rewritten on its own (amended, rebased, force-pushed), the one above can be moved
//! onto its new version ("restacked").

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use gix::ObjectId;
use serde::Serialize;

use super::backups::{BackupEvent, back_up};
use super::rewrites::branch_versions;
use super::validate::{commit_id, current_branch};
use crate::error::{Error, Result};
use crate::git::Git;

/// At most this many unmerged branches are looked at.
const MOST_BRANCHES: usize = 60;
/// At most this many earlier versions of a branch are looked at for a restack.
const MOST_VERSIONS: usize = 5;

/// A branch built on another unmerged branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stacked {
    pub branch: String,
    /// The branch it's built on.
    pub on: String,
    /// It's built on an earlier version of `on`, which has since been rewritten: it can be
    /// moved onto the new one.
    pub moved: bool,
    /// For a moved one: the earlier version of `on` it's built on.
    pub old: Option<String>,
}

/// Whether git can move the branches built on rewritten commits (`--update-refs`).
pub(super) fn updates_refs(git: &Git) -> bool {
    super::speed::version(git).1.as_slice() >= [2, 38].as_slice()
}

/// Every local branch and the commit it points at.
pub(super) fn branch_tips(git: &Git) -> BTreeMap<String, String> {
    git.run(&[
        "for-each-ref",
        "--format=%(objectname) %(refname:short)",
        "refs/heads",
    ])
    .unwrap_or_default()
    .lines()
    .filter_map(|line| line.split_once(' '))
    .map(|(id, name)| (name.to_owned(), id.to_owned()))
    .collect()
}

/// After a rewrite of `current`: the other local branches that moved since `before` (their
/// tips then). Each is backed up, to restore from Restore; their names are returned.
pub(super) fn moved_along(
    repo: &gix::Repository,
    git: &Git,
    current: &str,
    before: &BTreeMap<String, String>,
) -> Vec<String> {
    let after = branch_tips(git);
    let mut moved = Vec::new();
    for (name, old) in before {
        if name == current || after.get(name).is_none_or(|new| new == old) {
            continue;
        }
        if let Ok(old) = ObjectId::from_hex(old.as_bytes()) {
            back_up(
                repo,
                git,
                &format!("refs/heads/{name}"),
                BackupEvent::Rebased,
                old,
            );
        }
        moved.push(name.clone());
    }
    moved
}

/// ", and moved feat/api along" for the branches a rewrite moved.
pub(super) fn and_moved(moved: &[String]) -> String {
    match moved {
        [] => String::new(),
        [one] => format!(", and moved {one} along"),
        [first, rest @ ..] => format!(", and moved {first} and {} more along", rest.len()),
    }
}

/// The branch the others are measured against: the remote's default branch, or main/master.
fn default_base(git: &Git) -> Option<String> {
    for remote in ["origin"] {
        if let Ok(head) = git.run(&["rev-parse", "--abbrev-ref", &format!("{remote}/HEAD")]) {
            let head = head.trim();
            if !head.is_empty() && !head.ends_with("/HEAD") {
                return Some(head.to_owned());
            }
        }
    }
    [
        "origin/main",
        "origin/master",
        "main",
        "master",
        "develop",
        "trunk",
    ]
    .iter()
    .find(|name| {
        git.run(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{name}^{{commit}}"),
        ])
        .is_ok()
    })
    .map(|name| (*name).to_owned())
}

fn is_ancestor(git: &Git, ancestor: &str, of: &str) -> bool {
    git.run(&["merge-base", "--is-ancestor", ancestor, of])
        .is_ok()
}

/// Which local branches are built on others that aren't merged yet, and which of those
/// were since rewritten under them.
pub fn branch_stacks(path: &Path) -> Result<Vec<Stacked>> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    let Some(base) = default_base(&git) else {
        return Ok(Vec::new());
    };
    // The branches with work of their own, not yet on the default branch.
    let unmerged: Vec<String> = git
        .run(&[
            "for-each-ref",
            &format!("--no-merged={base}"),
            "--format=%(refname:short)",
            "refs/heads",
        ])?
        .lines()
        .map(str::to_owned)
        .filter(|name| !name.is_empty())
        .take(MOST_BRANCHES)
        .collect();
    let tips = branch_tips(&git);
    let own_commits: HashMap<&str, usize> = unmerged
        .iter()
        .map(|name| {
            let count = git
                .run(&["rev-list", "--count", &format!("{base}..refs/heads/{name}")])
                .ok()
                .and_then(|n| n.trim().parse().ok())
                .unwrap_or(0);
            (name.as_str(), count)
        })
        .collect();
    let mut stacks = Vec::new();
    for branch in &unmerged {
        let full = format!("refs/heads/{branch}");
        // The unmerged branches its history includes: it's built on the nearest one.
        let below: Vec<String> = git
            .run(&[
                "for-each-ref",
                &format!("--merged={full}"),
                "--format=%(refname:short)",
                "refs/heads",
            ])
            .unwrap_or_default()
            .lines()
            .filter(|name| *name != branch && unmerged.iter().any(|u| u == name))
            .filter(|name| tips.get(*name) != tips.get(branch))
            .map(str::to_owned)
            .collect();
        if let Some(on) = below
            .iter()
            .max_by_key(|name| own_commits.get(name.as_str()).copied().unwrap_or(0))
        {
            stacks.push(Stacked {
                branch: branch.clone(),
                on: on.clone(),
                moved: false,
                old: None,
            });
            continue;
        }
        // Built on an earlier version of a branch that's since been rewritten?
        for other in unmerged.iter().filter(|other| *other != branch) {
            let versions = branch_versions(path, other).unwrap_or_default();
            let earlier = versions
                .iter()
                .enumerate()
                .filter(|(_, version)| version.rewritten)
                .filter_map(|(index, _)| versions.get(index + 1))
                .take(MOST_VERSIONS);
            let found = earlier
                .filter(|old| Some(&old.id) != tips.get(other))
                .find(|old| {
                    is_ancestor(&git, &old.id, &full) && !is_ancestor(&git, &old.id, &base)
                });
            if let Some(old) = found {
                stacks.push(Stacked {
                    branch: branch.clone(),
                    on: other.clone(),
                    moved: true,
                    old: Some(old.id.clone()),
                });
                break;
            }
        }
    }
    Ok(stacks)
}

/// Move the checked-out branch onto the new version of `onto`: its own commits (those after
/// `old`, the version of `onto` it was built on) are replayed on top.
pub(super) fn restack(
    repo: &gix::Repository,
    git: &Git,
    onto: String,
    old: String,
) -> Result<String> {
    let branch = current_branch(repo)?;
    let old = commit_id(repo, &old)?.to_string();
    let full = format!("refs/heads/{onto}");
    if onto.starts_with('-')
        || repo
            .try_find_reference(full.as_str())
            .ok()
            .flatten()
            .is_none()
    {
        return Err(format!("There's no branch called {onto}.").into());
    }
    let before = super::support::ref_id(repo, &format!("refs/heads/{branch}"));
    let tips = branch_tips(git);
    let mut args = vec!["rebase"];
    if updates_refs(git) {
        args.push("--update-refs");
    }
    args.extend(["--onto", full.as_str(), old.as_str()]);
    let result = git.run(&args);
    super::backups::back_up_rewrite(repo, git, &branch, before);
    let moved = moved_along(repo, git, &branch, &tips);
    result?;
    Ok(format!(
        "Moved {branch} onto the new {onto}{}",
        and_moved(&moved)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_which_branches_moved_along() {
        assert_eq!(and_moved(&[]), "");
        assert_eq!(
            and_moved(&["feat/api".into()]),
            ", and moved feat/api along"
        );
        assert_eq!(
            and_moved(&["a".into(), "b".into(), "c".into()]),
            ", and moved a and 2 more along"
        );
    }
}
