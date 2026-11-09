//! What changed when a branch was rewritten (rebased, amended, force-pushed): its earlier
//! versions, from git's record of where it pointed (its reflog: for a remote branch, after
//! each fetch), and `git range-diff` between two of them, which matches each old commit
//! with its new version and shows only what's really different, not the rebase's noise.

use std::path::Path;

use serde::Serialize;

use super::validate::revision_name;
use crate::error::{Error, Result};
use crate::git::Git;

/// At most this many earlier versions are listed.
const MOST_VERSIONS: usize = 50;
/// At most this many lines of changes are kept for each commit.
const MOST_LINES: usize = 400;

/// Where a branch pointed, and how it got there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchVersion {
    pub id: String,
    /// When it moved there (seconds since 1970).
    pub at: i64,
    /// It was rewritten to get there (not just moved forward): a forced update, a rebase,
    /// a reset or an amended commit.
    pub rewritten: bool,
    /// What moved it, as git says: "fetch: forced-update", "rebase (finish): …".
    pub how: String,
}

/// A commit of the old version, its new version, or both.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPair {
    pub status: PairStatus,
    /// Short ids.
    pub old: Option<String>,
    pub new: Option<String>,
    pub summary: String,
    /// For a changed commit, how its changes differ (git's diff of the two diffs).
    pub changes: Vec<String>,
    /// More lines than were kept.
    pub cut: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PairStatus {
    /// The same changes (its id may differ, being on a new base).
    Same,
    Changed,
    /// Only in the new version.
    Added,
    /// Only in the old one.
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeDiff {
    /// The branch both versions are compared against, if one was found.
    pub base: Option<String>,
    pub pairs: Vec<CommitPair>,
}

fn open(path: &Path) -> Result<(gix::Repository, Git)> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    Ok((repo, git))
}

/// The full name of a local or remote branch.
fn full_name(repo: &gix::Repository, name: &str) -> Result<String> {
    if name.starts_with('-') {
        return Err(format!("There's no branch called {name}.").into());
    }
    ["refs/heads/", "refs/remotes/"]
        .iter()
        .map(|prefix| format!("{prefix}{name}"))
        .find(|full| {
            repo.try_find_reference(full.as_str())
                .ok()
                .flatten()
                .is_some()
        })
        .ok_or_else(|| format!("There's no branch called {name}.").into())
}

/// Whether git's description of a move says the branch was rewritten.
fn rewrites(how: &str) -> bool {
    how.contains("forced-update")
        || how.starts_with("rebase")
        || how.starts_with("reset")
        || how.starts_with("commit (amend)")
        || how.starts_with("pull --rebase")
}

/// `git log -g --date=unix --format=%H%x1f%gd%x1f%gs` as versions.
fn versions_from(log: &str) -> Vec<BranchVersion> {
    log.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\x1f');
            let (id, selector, how) = (parts.next()?, parts.next()?, parts.next()?);
            // "refs/remotes/origin/fix@{1731000000}"
            let at = selector
                .rsplit_once("@{")
                .and_then(|(_, time)| time.trim_end_matches('}').parse().ok())
                .unwrap_or(0);
            Some(BranchVersion {
                id: id.to_owned(),
                at,
                rewritten: rewrites(how),
                how: how.to_owned(),
            })
        })
        .take(MOST_VERSIONS)
        .collect()
}

/// Where branch `name` (like "fix/door" or "origin/fix/door") pointed, newest first.
pub fn branch_versions(path: &Path, name: &str) -> Result<Vec<BranchVersion>> {
    let (repo, git) = open(path)?;
    let full = full_name(&repo, name)?;
    let log = git
        .run(&[
            "log",
            "-g",
            "--date=unix",
            "--format=%H%x1f%gd%x1f%gs",
            &full,
            "--",
        ])
        .unwrap_or_default();
    Ok(versions_from(&log))
}

/// `git range-diff --no-color` output as pairs of commits.
fn pairs_from(output: &str) -> Vec<CommitPair> {
    let mut pairs: Vec<CommitPair> = Vec::new();
    for line in output.lines() {
        if let Some(body) = line.strip_prefix("    ") {
            if let Some(pair) = pairs.last_mut() {
                if pair.changes.len() < MOST_LINES {
                    pair.changes.push(body.to_owned());
                } else {
                    pair.cut = true;
                }
            }
            continue;
        }
        // "1:  1b2c3d4 ! 2:  5e6f7a8 Door creak", "-:  ------- > 3:  5e6f7a8 New".
        let words: Vec<&str> = line.split_whitespace().collect();
        let [_, old, mark, _, new, ..] = words.as_slice() else {
            continue;
        };
        let status = match *mark {
            "=" => PairStatus::Same,
            "!" => PairStatus::Changed,
            ">" => PairStatus::Added,
            "<" => PairStatus::Removed,
            _ => continue,
        };
        let id = |word: &str| (!word.starts_with('-')).then(|| word.to_owned());
        // The summary is what follows the fifth word.
        let mut rest = line.trim_start();
        for _ in 0..5 {
            rest = rest.trim_start();
            rest = rest.find(char::is_whitespace).map_or("", |at| &rest[at..]);
        }
        pairs.push(CommitPair {
            status,
            old: id(old),
            new: id(new),
            summary: rest.trim().to_owned(),
            changes: Vec::new(),
            cut: false,
        });
    }
    // The changes start with an empty line and the commit's header; keep from the diff on.
    for pair in &mut pairs {
        while pair
            .changes
            .first()
            .is_some_and(|line| line.trim().is_empty())
        {
            pair.changes.remove(0);
        }
    }
    pairs
}

/// The branch both versions are most likely based on: the remote's default branch.
fn default_base(git: &Git, branch: &str) -> Option<String> {
    let remote = git
        .run(&["remote"])
        .ok()?
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty() && !remote.starts_with('-'))
        .find(|remote| branch.starts_with(&format!("{remote}/")))
        .map(str::to_owned)
        .unwrap_or_else(|| "origin".to_owned());
    if let Ok(head) = git.run(&["rev-parse", "--abbrev-ref", &format!("{remote}/HEAD")]) {
        let head = head.trim();
        if !head.is_empty() && head != format!("{remote}/HEAD") {
            return Some(head.to_owned());
        }
    }
    ["main", "master", "develop", "trunk"]
        .iter()
        .flat_map(|name| [format!("{remote}/{name}"), (*name).to_owned()])
        .find(|name| {
            git.run(&[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{name}^{{commit}}"),
            ])
            .is_ok()
        })
}

/// How version `new` of a branch differs from version `old`, commit by commit. `base` is
/// the branch both are on top of (the remote's default branch when None): its own commits,
/// which a rebase brings in, aren't shown. `branch` names the branch, to find that default.
pub fn range_diff(
    path: &Path,
    old: &str,
    new: &str,
    base: Option<&str>,
    branch: Option<&str>,
) -> Result<RangeDiff> {
    let (repo, git) = open(path)?;
    let old = revision_name(&repo, old)?;
    let new = revision_name(&repo, new)?;
    let base = match base {
        Some(base) => Some(revision_name(&repo, base)?),
        None => default_base(&git, branch.unwrap_or_default()),
    };
    // Each version's own commits: those not on the base (or, without one, not on the other).
    // A rewritten branch's commits are its old ones changed, so they're matched up more
    // readily than git does by default (which takes a small commit changed a little for a
    // different one).
    let ranges = match &base {
        Some(base) => vec![format!("{base}..{old}"), format!("{base}..{new}")],
        None => vec![format!("{old}...{new}")],
    };
    let mut args = vec!["range-diff", "--no-color", "--creation-factor=95"];
    args.extend(ranges.iter().map(String::as_str));
    let output = git.run(&args)?;
    Ok(RangeDiff {
        base,
        pairs: pairs_from(&output),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_versions_and_what_rewrote_them() {
        let log = "aaa\x1frefs/remotes/origin/fix@{1731000200}\x1ffetch: forced-update\n\
                   bbb\x1frefs/remotes/origin/fix@{1731000100}\x1ffetch: fast-forward\n\
                   ccc\x1frefs/remotes/origin/fix@{1731000000}\x1fupdate by push\n";
        let versions = versions_from(log);
        assert_eq!(versions.len(), 3);
        assert_eq!(
            (versions[0].at, versions[0].rewritten),
            (1_731_000_200, true)
        );
        assert!(!versions[1].rewritten);
        assert!(rewrites("rebase (finish): refs/heads/fix onto 123"));
        assert!(rewrites("commit (amend): Door creak"));
        assert!(!rewrites("commit: Door creak"));
    }

    #[test]
    fn reads_range_diff_output() {
        let output = "\
1:  1b2c3d4 = 1:  5e6f7a8 Barber: a longer beard
2:  2b2c3d4 ! 2:  6e6f7a8 Door creak
    @@ Metadata
    ## door.txt ##
    -creak
    +creeeak
-:  ------- > 3:  7e6f7a8 Oil the hinges
3:  3b2c3d4 < -:  ------- A slower door
";
        let pairs = pairs_from(output);
        assert_eq!(pairs.len(), 4);
        assert_eq!(pairs[0].status, PairStatus::Same);
        assert_eq!(pairs[0].summary, "Barber: a longer beard");
        assert_eq!(pairs[1].status, PairStatus::Changed);
        assert_eq!(
            pairs[1].changes,
            vec!["@@ Metadata", "## door.txt ##", "-creak", "+creeeak"]
        );
        assert_eq!(
            (pairs[2].old.as_deref(), pairs[2].new.as_deref()),
            (None, Some("7e6f7a8"))
        );
        assert_eq!(pairs[2].summary, "Oil the hinges");
        assert_eq!(pairs[3].status, PairStatus::Removed);
        assert_eq!(pairs[3].summary, "A slower door");
    }
}
