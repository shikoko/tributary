//! A remote's branches as remembered here from its last fetch (`refs/remotes/<remote>/…`):
//! which of them the remote really has now, keeping the work in those it no longer has when
//! that work isn't anywhere else here, and moving a remote to a new address without losing
//! them.
//!
//! A fetch used to prune: a remembered branch the remote no longer had was simply forgotten.
//! That's right for a teammate's branch merged and deleted, but a repository copied with its
//! `.git` folder, then pointed at a new, empty one, forgot every branch it only remembered,
//! with the work on them.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::backups::{BackupEvent, back_up};
use super::validate::known_remote;
use crate::error::{Error, Result};
use crate::git::{Git, Progress, without_credentials};

/// Where a remembered branch the remote no longer has is set aside, when its work isn't
/// anywhere else here: `refs/tributary/gone/<remote>/<branch>`, until it's kept as a branch
/// or forgotten.
pub(super) const SET_ASIDE: &str = "refs/tributary/gone/";

/// The branches `remote` (a remote's name, or an address) has now, asked of it: each one's
/// name and commit.
pub(super) fn heads_at(git: &Git, remote: &str) -> Result<HashMap<String, String>> {
    if remote.starts_with('-') {
        return Err(format!("\"{remote}\" isn't a remote.").into());
    }
    let listing = git.run(&["ls-remote", "--heads", remote])?;
    Ok(listing
        .lines()
        .filter_map(|line| {
            let (id, name) = line.split_once('\t')?;
            Some((name.strip_prefix("refs/heads/")?.to_owned(), id.to_owned()))
        })
        .collect())
}

/// `remote`'s branches as remembered from its last fetch (not its HEAD): each one's name
/// and commit.
pub(super) fn remembered(git: &Git, remote: &str) -> Result<Vec<(String, String)>> {
    let prefix = format!("refs/remotes/{remote}/");
    let listing = git.run(&[
        "for-each-ref",
        "--format=%(refname)%00%(objectname)%00%(symref)",
        &prefix,
    ])?;
    Ok(listing
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\0');
            let (reference, id, symref) = (fields.next()?, fields.next()?, fields.next()?);
            // origin/HEAD only names another one.
            if !symref.is_empty() {
                return None;
            }
            Some((reference.strip_prefix(&prefix)?.to_owned(), id.to_owned()))
        })
        .collect())
}

/// How many of `tip`'s commits aren't on any branch, tag or remote branch here, but those
/// remote branches in `leaving` (`origin/feature`), which are going.
pub(super) fn only_in(git: &Git, tip: &str, leaving: &[String]) -> Result<u32> {
    let mut args = vec![
        "rev-list".to_owned(),
        "--count".to_owned(),
        tip.to_owned(),
        "--not".to_owned(),
        "--branches".to_owned(),
        "--tags".to_owned(),
    ];
    // Each applies to the --remotes after it. (A branch's name can't have a glob's * ? [.)
    args.extend(leaving.iter().map(|name| format!("--exclude={name}")));
    args.push("--remotes".to_owned());
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    Ok(git.run(&args)?.trim().parse().unwrap_or(0))
}

/// Whether `tip`'s changes are in `base` already: merged, or put there by a rebase or a
/// squash (the same changes, in new commits), as a pull request merged on GitHub usually is.
fn landed(git: &Git, base: &str, tip: &str) -> bool {
    // A rebase: each commit's changes are in `base` ("-"), none of them only here ("+").
    let Ok(cherry) = git.run(&["cherry", base, tip]) else {
        return false;
    };
    if !cherry.lines().any(|line| line.starts_with('+')) {
        return true;
    }
    // A squash: all of them together, as one commit, are in `base`.
    let Ok(start) = git.run(&["merge-base", base, tip]) else {
        return false;
    };
    let Ok(tree) = git.run(&["rev-parse", &format!("{tip}^{{tree}}")]) else {
        return false;
    };
    // Who made it doesn't matter (nothing points at it), but git won't make one without.
    let squashed = git.run_with_env(
        &[
            "commit-tree",
            tree.trim(),
            "-p",
            start.trim(),
            "-m",
            "Tributary: was it squashed?",
        ],
        &[
            ("GIT_AUTHOR_NAME", "Tributary"),
            ("GIT_AUTHOR_EMAIL", "tributary@localhost"),
            ("GIT_COMMITTER_NAME", "Tributary"),
            ("GIT_COMMITTER_EMAIL", "tributary@localhost"),
        ],
    );
    let Ok(squashed) = squashed else {
        return false;
    };
    git.run(&["cherry", base, squashed.trim()])
        .is_ok_and(|cherry| cherry.lines().all(|line| line.starts_with('-')))
}

/// The remote branch a remote's pull requests go into: what its HEAD names, or main or
/// master, if the remote still has it (`theirs`).
fn main_branch(git: &Git, remote: &str, theirs: &HashMap<String, String>) -> Option<String> {
    let named = git
        .run(&[
            "symbolic-ref",
            "--quiet",
            &format!("refs/remotes/{remote}/HEAD"),
        ])
        .ok()
        .and_then(|target| {
            target
                .trim()
                .strip_prefix(&format!("refs/remotes/{remote}/"))
                .map(str::to_owned)
        });
    named
        .into_iter()
        .chain(["main".to_owned(), "master".to_owned()])
        .find(|name| theirs.contains_key(name))
        .map(|name| format!("refs/remotes/{remote}/{name}"))
}

/// After a fetch that didn't prune: forget the remembered branches each remote no longer has,
/// as `--prune` would, but set aside those holding commits found nowhere else here (and not
/// merged, rebased or squashed into the remote's main branch), under [`SET_ASIDE`], for the
/// person to keep or forget. A remote that can't be asked keeps all of its. How many were set
/// aside.
pub(super) fn tidy_gone(git: &Git, remotes: &[String]) -> usize {
    let mut set_aside = 0;
    for remote in remotes {
        let (Ok(theirs), Ok(ours)) = (heads_at(git, remote), remembered(git, remote)) else {
            continue;
        };
        let gone: Vec<&(String, String)> = ours
            .iter()
            .filter(|(name, _)| !theirs.contains_key(name))
            .collect();
        if gone.is_empty() {
            continue;
        }
        let leaving: Vec<String> = gone
            .iter()
            .map(|(name, _)| format!("{remote}/{name}"))
            .collect();
        let main = main_branch(git, remote, &theirs);
        for (name, id) in gone {
            let reference = format!("refs/remotes/{remote}/{name}");
            let unique = only_in(git, id, &leaving).unwrap_or(1);
            let keep = unique > 0 && !main.as_deref().is_some_and(|main| landed(git, main, id));
            if keep {
                let aside = format!("{SET_ASIDE}{remote}/{name}");
                if git.run(&["update-ref", &aside, id]).is_err() {
                    continue;
                }
                set_aside += 1;
            }
            let _ = git.run(&["update-ref", "-d", &reference, id]);
        }
    }
    set_aside
}

/// A remembered branch whose work isn't anywhere else here.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RememberedBranch {
    /// Its remote's, and its name there: `origin`, `feature/export`.
    pub remote: String,
    pub name: String,
    /// Where it's kept: `refs/remotes/origin/feature/export`, or set aside.
    pub reference: String,
    /// Its commits found nowhere else here.
    pub commits: u32,
    /// Its last commit's summary, and when that was committed (seconds).
    pub summary: String,
    pub time: i64,
}

/// Its last commit's summary and time.
pub(super) fn last_commit(git: &Git, id: &str) -> (String, i64) {
    git.run(&["log", "-1", "--format=%s%x00%ct", id])
        .ok()
        .and_then(|line| {
            let (summary, time) = line.trim_end().split_once('\0')?;
            Some((summary.to_owned(), time.parse().unwrap_or(0)))
        })
        .unwrap_or_default()
}

/// The branches a fetch set aside (see [`tidy_gone`]) whose work still isn't anywhere else
/// here, newest first: the person is asked whether to keep them as branches or forget them.
pub fn set_aside_branches(path: &Path) -> Result<Vec<RememberedBranch>, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let git = Git::find(repo.workdir().unwrap_or(repo.git_dir()).to_owned())?;
    let listing = git.run(&[
        "for-each-ref",
        "--format=%(refname)%00%(objectname)",
        SET_ASIDE,
    ])?;
    let mut found = Vec::new();
    for line in listing.lines() {
        let Some((reference, id)) = line.split_once('\0') else {
            continue;
        };
        let Some((remote, name)) = reference
            .strip_prefix(SET_ASIDE)
            .and_then(|rest| rest.split_once('/'))
        else {
            continue;
        };
        let commits = only_in(&git, id, &[])?;
        if commits == 0 {
            // Its work is on a branch here now: nothing to keep.
            let _ = git.run(&["update-ref", "-d", reference, id]);
            continue;
        }
        let (summary, time) = last_commit(&git, id);
        found.push(RememberedBranch {
            remote: remote.to_owned(),
            name: name.to_owned(),
            reference: reference.to_owned(),
            commits,
            summary,
            time,
        });
    }
    found.sort_by(|a, b| b.time.cmp(&a.time).then_with(|| a.name.cmp(&b.name)));
    Ok(found)
}

/// A name for a new branch here: `wanted`, or, taken, `wanted-kept`, `wanted-kept-2`…
fn free_name(git: &Git, wanted: &str) -> String {
    let taken = |name: &str| {
        git.run(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{name}"),
        ])
        .is_ok()
    };
    if !taken(wanted) {
        return wanted.to_owned();
    }
    (1..)
        .map(|n| {
            if n == 1 {
                format!("{wanted}-kept")
            } else {
                format!("{wanted}-kept-{n}")
            }
        })
        .find(|name| !taken(name))
        .unwrap_or_else(|| format!("{wanted}-kept"))
}

/// "feature/export", "feature/export and release/1.2", or "3 branches".
fn named(names: &[String]) -> String {
    match names {
        [one] => one.clone(),
        [one, two] => format!("{one} and {two}"),
        _ => format!("{} branches", names.len()),
    }
}

/// `reference`, if it's one this module keeps (set aside, or a remembered branch of a remote),
/// as (remote, name, commit).
fn kept_reference(git: &Git, reference: &str) -> Result<(String, String, String)> {
    let rest = reference
        .strip_prefix(SET_ASIDE)
        .or_else(|| reference.strip_prefix("refs/remotes/"))
        .ok_or_else(|| format!("{reference} isn't a remembered branch."))?;
    let (remote, name) = rest
        .split_once('/')
        .ok_or_else(|| format!("{reference} isn't a remembered branch."))?;
    let id = git
        .run(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{reference}^{{commit}}"),
        ])
        .map_err(|_| format!("{reference} isn't here any more."))?;
    Ok((remote.to_owned(), name.to_owned(), id.trim().to_owned()))
}

/// Keep remembered branches (set aside, or a remote's) as branches here: one of each's
/// name (or, taken, `-kept`), tracking nothing, as the remote doesn't have it. A set-aside
/// one is then gone from where it was set aside.
pub(super) fn keep_remembered(git: &Git, references: Vec<String>) -> Result<String> {
    if references.is_empty() {
        return Err("Choose a branch to keep.".into());
    }
    let mut made = Vec::new();
    for reference in &references {
        let (_, name, id) = kept_reference(git, reference)?;
        let local = free_name(git, &name);
        git.run(&["branch", "--no-track", "--", &local, &id])?;
        if reference.starts_with(SET_ASIDE) {
            let _ = git.run(&["update-ref", "-d", reference, &id]);
        }
        made.push(local);
    }
    Ok(format!(
        "Kept {} here, as {}",
        if made.len() == 1 {
            "a branch"
        } else {
            "branches"
        },
        named(&made)
    ))
}

/// Forget remembered branches (set aside, or a remote's), keeping a backup of each in
/// Restore, in case.
pub(super) fn forget_remembered(
    repo: &gix::Repository,
    git: &Git,
    references: Vec<String>,
) -> Result<String> {
    if references.is_empty() {
        return Err("Choose a branch to forget.".into());
    }
    let mut names = Vec::new();
    for reference in &references {
        let (remote, name, id) = kept_reference(git, reference)?;
        if let Ok(object) = gix::ObjectId::from_hex(id.as_bytes()) {
            back_up(
                repo,
                git,
                &format!("refs/remotes/{remote}/{name}"),
                BackupEvent::DeletedFromRemote,
                object,
            );
        }
        git.run(&["update-ref", "-d", reference, &id])?;
        names.push(format!("{remote}/{name}"));
    }
    Ok(format!("Forgot {} (kept in Restore)", named(&names)))
}

/// What moving a remote to a new address would do to its remembered branches (see
/// [`move_check`]).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MoveCheck {
    /// The new address, without a password or token in it.
    pub address: String,
    /// Whether the new address answered: what it has is known. When it didn't, it's taken
    /// to have none of the remembered branches.
    pub reached: bool,
    /// Why it didn't answer.
    #[ts(optional = nullable)]
    pub problem: Option<String>,
    /// Remembered branches the new address doesn't have, with work found nowhere else here:
    /// the next fetch would lose them. Newest first.
    pub at_risk: Vec<RememberedBranch>,
    /// Branches here that push to this remote, which the new address doesn't have: copying
    /// the remembered ones copies these too.
    pub local: Vec<String>,
}

/// Before pointing `remote` at `url`: what the new address has, and which remembered branches
/// it doesn't, whose work would be lost at the next fetch. When there are none, the address
/// can simply change.
pub fn move_check(path: &Path, remote: String, url: String) -> Result<MoveCheck, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let git = Git::find(repo.workdir().unwrap_or(repo.git_dir()).to_owned())?;
    let remote = known_remote(&repo, &remote)?;
    let url = url.trim().to_owned();
    if url.is_empty() || url.starts_with('-') || url.contains(char::is_whitespace) {
        return Err(format!("\"{url}\" isn't a remote's address.").into());
    }
    let (theirs, problem) = match heads_at(&git, &url) {
        Ok(theirs) => (Some(theirs), None),
        Err(e) => (None, Some(e.to_string())),
    };
    let has = |name: &str| {
        theirs
            .as_ref()
            .is_some_and(|theirs| theirs.contains_key(name))
    };
    let ours = remembered(&git, &remote)?;
    let leaving: Vec<String> = ours
        .iter()
        .filter(|(name, _)| !has(name))
        .map(|(name, _)| format!("{remote}/{name}"))
        .collect();
    let mut at_risk = Vec::new();
    for (name, id) in ours.iter().filter(|(name, _)| !has(name)) {
        let commits = only_in(&git, id, &leaving)?;
        if commits == 0 {
            continue;
        }
        let (summary, time) = last_commit(&git, id);
        at_risk.push(RememberedBranch {
            remote: remote.clone(),
            name: name.clone(),
            reference: format!("refs/remotes/{remote}/{name}"),
            commits,
            summary,
            time,
        });
    }
    at_risk.sort_by(|a, b| b.time.cmp(&a.time).then_with(|| a.name.cmp(&b.name)));
    let local = tracking(&git, &remote)?
        .into_iter()
        .filter(|(_, target)| !has(target))
        .map(|(local, _)| local)
        .collect();
    Ok(MoveCheck {
        address: without_credentials(&url),
        reached: theirs.is_some(),
        problem,
        at_risk,
        local,
    })
}

/// The branches here that pull from and push to `remote`: each one's name, and its branch's
/// name there.
fn tracking(git: &Git, remote: &str) -> Result<Vec<(String, String)>> {
    let listing = git.run(&[
        "for-each-ref",
        "--format=%(refname:strip=2)%00%(upstream:remotename)%00%(upstream)",
        "refs/heads",
    ])?;
    let prefix = format!("refs/remotes/{remote}/");
    Ok(listing
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\0');
            let (name, upstream_remote, upstream) =
                (fields.next()?, fields.next()?, fields.next()?);
            (upstream_remote == remote)
                .then(|| upstream.strip_prefix(&prefix))
                .flatten()
                .map(|target| (name.to_owned(), target.to_owned()))
        })
        .collect())
}

/// What to do with a remote's remembered branches its new address doesn't have.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum RememberedChoice {
    /// Push them to the new address, with the branches here that push to it and the tags:
    /// the repository moves over whole.
    Copy,
    /// Make them branches here, to push when the person chooses.
    Keep,
    /// Forget them (with a backup in Restore).
    Forget,
}

/// A remote's move to a new address (see [`move_remote`]).
pub(super) struct Move {
    pub remote: String,
    pub url: String,
    pub then: RememberedChoice,
    /// Its remembered branches the new address doesn't have.
    pub branches: Vec<String>,
    /// The branches here that push to it, which the new address doesn't have.
    pub local: Vec<String>,
}

/// Point a remote at its new address, and do `then` with `branches`, its remembered branches
/// the new address doesn't have (see [`move_check`]). Copying pushes `local`, the branches
/// here that push to it, too, and the tags.
pub(super) fn move_remote(
    repo: &gix::Repository,
    git: &Git,
    Move {
        remote,
        url,
        then,
        branches,
        local,
    }: Move,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    let remote = known_remote(repo, &remote)?;
    let moved = super::remote_settings::set_remote_url(git, remote.clone(), url, false)?;
    let address = git
        .run(&["remote", "get-url", "--", &remote])
        .map(|url| without_credentials(url.trim()))
        .unwrap_or_default();
    let references: Vec<String> = branches
        .iter()
        .map(|name| format!("refs/remotes/{remote}/{name}"))
        .collect();
    match then {
        RememberedChoice::Copy => {
            let targets: HashMap<String, String> = tracking(git, &remote)?.into_iter().collect();
            let mut refspecs: Vec<String> = Vec::new();
            let mut copied: HashSet<&str> = HashSet::new();
            for name in &local {
                let target = targets.get(name).cloned().unwrap_or_else(|| name.clone());
                refspecs.push(format!("refs/heads/{name}:refs/heads/{target}"));
            }
            for (name, reference) in branches.iter().zip(&references) {
                kept_reference(git, reference)?;
                if copied.insert(name) {
                    refspecs.push(format!("{reference}:refs/heads/{name}"));
                }
            }
            let mut args = vec!["push", "--progress", "--tags", remote.as_str()];
            args.extend(refspecs.iter().map(String::as_str));
            git.run_progress(&args, on_progress)?;
            let count = branches.len() + local.len();
            Ok(format!(
                "Moved {remote} to {address}, and copied {} there",
                if count == 1 {
                    "1 branch".to_owned()
                } else {
                    format!("{count} branches")
                }
            ))
        }
        RememberedChoice::Keep if !references.is_empty() => {
            let kept = keep_remembered(git, references)?;
            Ok(format!("Moved {remote} to {address}. {kept}"))
        }
        RememberedChoice::Forget if !references.is_empty() => {
            forget_remembered(repo, git, references)?;
            Ok(format!("Moved {remote} to {address}"))
        }
        _ => Ok(moved),
    }
}
