//! Branches, remote branches, tags and stashes, and what they track.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use gix::ObjectId;
use gix::bstr::ByteSlice;
use serde::Serialize;

use crate::git::Git;
use crate::links;
use crate::links::WebRemote;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenRef {
    pub name: String,
    pub kind: RefKind,
    /// The commit it points to.
    pub commit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    /// Like `origin/main`.
    pub name: String,
    /// Where it points, or `None` if it hasn't been fetched yet.
    pub commit: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    pub name: String,
    pub kind: RefKind,
    /// `true` for the branch that is checked out.
    pub current: bool,
    /// For a local branch: the remote branch it tracks, like `origin/main`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    /// For an annotated tag: the id of the tag object itself (`kind` points at its commit).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// For a local branch with an upstream: how far it is ahead of the upstream, and behind
    /// it, along each one's own line (first parents): a merged pull request counts once.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<u32>,
    /// The same as git counts it (`git status`): every commit, those a merge brought in too.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead_commits: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind_commits: Option<u32>,
}

impl RefLabel {
    /// The full name, like `refs/heads/main`, or `None` for HEAD and stashes.
    pub fn full_name(&self) -> Option<String> {
        let prefix = match self.kind {
            RefKind::Branch => "refs/heads/",
            RefKind::Remote => "refs/remotes/",
            RefKind::Tag => "refs/tags/",
            RefKind::Head | RefKind::Stash => return None,
        };
        Some(format!("{prefix}{}", self.name))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    /// A detached `HEAD`.
    Head,
    Branch,
    Remote,
    Tag,
    /// A stash entry, like `stash@{0}`.
    Stash,
}

/// Group local branches, remote branches and tags by the commit they point to.
pub(super) fn collect_refs(
    repo: &gix::Repository,
    head_branch: Option<&str>,
) -> HashMap<ObjectId, Vec<RefLabel>> {
    let mut out: HashMap<ObjectId, Vec<RefLabel>> = HashMap::new();
    let Ok(platform) = repo.references() else {
        return out;
    };
    let Ok(iter) = platform.all() else {
        return out;
    };
    // Broken or unreadable refs are skipped rather than failing the whole load.
    for mut reference in iter.flatten() {
        let full_name = reference.name().as_bstr().to_str_lossy().into_owned();
        let (kind, name) = if let Some(name) = full_name.strip_prefix("refs/heads/") {
            (RefKind::Branch, name)
        } else if let Some(name) = full_name.strip_prefix("refs/remotes/") {
            if name.ends_with("/HEAD") {
                continue;
            }
            (RefKind::Remote, name)
        } else if let Some(name) = full_name.strip_prefix("refs/tags/") {
            (RefKind::Tag, name)
        } else {
            continue;
        };
        let direct = reference.target().try_id().map(|id| id.to_owned());
        let Ok(id) = reference.peel_to_id() else {
            continue;
        };
        // An annotated tag points at a tag object, which points at the commit.
        let target = direct
            .filter(|direct| kind == RefKind::Tag && *direct != id.detach())
            .map(|direct| direct.to_string());
        // Tags can point at trees or blobs; only commits belong in the graph.
        let is_commit = repo
            .find_header(id.detach())
            .map(|header| header.kind() == gix::object::Kind::Commit)
            .unwrap_or(false);
        if !is_commit {
            continue;
        }
        let upstream = (kind == RefKind::Branch)
            .then(|| upstream(repo, name).map(|upstream| upstream.name))
            .flatten();
        out.entry(id.detach()).or_default().push(RefLabel {
            current: kind == RefKind::Branch && Some(name) == head_branch,
            name: name.to_owned(),
            kind,
            upstream,
            target,
            ahead: None,
            behind: None,
            ahead_commits: None,
            behind_commits: None,
        });
    }
    out
}

/// How far a local branch is from the branch it tracks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Distance {
    /// Along each branch's own line (first parents only): a merge counts once, however many
    /// commits it brought in.
    pub ahead: u32,
    pub behind: u32,
    /// Every commit, as git counts them.
    pub ahead_commits: u32,
    pub behind_commits: u32,
}

/// Two branches' tips, and how many commits each has that the other doesn't.
type Tips = (String, String);

/// First-parent distances already worked out, by the two tips' ids: they only change when
/// one of the branches moves.
static FIRST_PARENT: LazyLock<Mutex<HashMap<Tips, (u32, u32)>>> = LazyLock::new(Default::default);

/// Each local branch's distance from the branch it tracks. Branches without an upstream (or
/// whose upstream is gone) aren't listed.
pub(crate) fn upstream_counts(workdir: &Path) -> HashMap<String, Distance> {
    let Ok(git) = Git::find(workdir.to_owned()) else {
        return HashMap::new();
    };
    let git = git.in_background();
    let Ok(output) = git.run(&[
        "for-each-ref",
        "--format=%(refname:short)%00%(objectname)%00%(upstream)%00%(upstream:track,nobracket)",
        "refs/heads",
    ]) else {
        return HashMap::new();
    };
    let branches: Vec<Tracking> = output.lines().filter_map(parse_track).collect();
    // Where the upstreams point: only needed for branches that aren't level with theirs.
    let tips: HashMap<String, String> = if branches
        .iter()
        .any(|branch| branch.ahead + branch.behind > 0)
    {
        git.run(&[
            "for-each-ref",
            "--format=%(refname)%00%(objectname)",
            "refs/remotes",
            "refs/heads",
        ])
        .map(|out| {
            out.lines()
                .filter_map(|line| line.split_once('\0'))
                .map(|(name, id)| (name.to_owned(), id.to_owned()))
                .collect()
        })
        .unwrap_or_default()
    } else {
        HashMap::new()
    };
    branches
        .into_iter()
        .map(|branch| {
            let (ahead, behind) = if branch.ahead + branch.behind == 0 {
                (0, 0)
            } else {
                tips.get(&branch.upstream)
                    .and_then(|tip| first_parent_distance(&git, &branch.id, tip))
                    .unwrap_or((branch.ahead, branch.behind))
            };
            let distance = Distance {
                ahead,
                behind,
                ahead_commits: branch.ahead,
                behind_commits: branch.behind,
            };
            (branch.name, distance)
        })
        .collect()
}

/// How many commits `local` and `upstream` each have that the other doesn't, following
/// first parents only (from the cache when it's known).
fn first_parent_distance(git: &Git, local: &str, upstream: &str) -> Option<(u32, u32)> {
    let key = (local.to_owned(), upstream.to_owned());
    if let Some(&known) = FIRST_PARENT.lock().ok()?.get(&key) {
        return Some(known);
    }
    let output = git
        .run(&[
            "rev-list",
            "--count",
            "--left-right",
            "--first-parent",
            &format!("{local}...{upstream}"),
        ])
        .ok()?;
    let (ahead, behind) = output.trim().split_once('\t')?;
    let found = (ahead.parse().ok()?, behind.parse().ok()?);
    let mut known = FIRST_PARENT.lock().ok()?;
    if known.len() > 2000 {
        known.clear();
    }
    known.insert(key, found);
    Some(found)
}

/// A line of `for-each-ref`: a branch, where it is, what it tracks and git's counts.
#[derive(Debug, PartialEq, Eq)]
struct Tracking {
    name: String,
    id: String,
    /// Like `refs/remotes/origin/main`.
    upstream: String,
    ahead: u32,
    behind: u32,
}

/// "main\0<id>\0refs/remotes/origin/main\0ahead 1, behind 2" → main, 1 ahead, 2 behind.
fn parse_track(line: &str) -> Option<Tracking> {
    let mut parts = line.split('\0');
    let name = parts.next()?;
    let id = parts.next()?;
    let upstream = parts.next()?;
    let track = parts.next().unwrap_or("");
    if upstream.is_empty() || track.contains("gone") {
        return None;
    }
    let count = |word: &str| {
        track
            .split(',')
            .map(str::trim)
            .find_map(|part| part.strip_prefix(word)?.trim().parse::<u32>().ok())
            .unwrap_or(0)
    };
    Some(Tracking {
        name: name.to_owned(),
        id: id.to_owned(),
        upstream: upstream.to_owned(),
        ahead: count("ahead"),
        behind: count("behind"),
    })
}

/// Branches that live on, and are never offered for pruning.
pub fn is_long_lived_branch(name: &str) -> bool {
    matches!(
        name,
        "main" | "master" | "develop" | "development" | "dev" | "trunk"
    )
}

/// Local branches that track a remote branch which no longer exists.
pub(super) fn gone_branches(repo: &gix::Repository, head_branch: Option<&str>) -> Vec<String> {
    let Ok(platform) = repo.references() else {
        return Vec::new();
    };
    let Ok(branches) = platform.local_branches() else {
        return Vec::new();
    };
    let mut gone: Vec<String> = branches
        .flatten()
        .filter_map(|reference| {
            let full_name = reference.name().as_bstr().to_str_lossy().into_owned();
            let name = full_name.strip_prefix("refs/heads/")?.to_owned();
            if Some(name.as_str()) == head_branch || is_long_lived_branch(&name) {
                return None;
            }
            let upstream = upstream(repo, &name)?;
            upstream.commit.is_none().then_some(name)
        })
        .collect();
    gone.sort();
    gone
}

/// The web pages of the remotes that have one.
pub(crate) fn web_remotes(repo: &gix::Repository) -> Vec<WebRemote> {
    repo.remote_names()
        .iter()
        .filter_map(|name| {
            let remote = repo.find_remote(name.as_bstr()).ok()?;
            let url = remote.url(gix::remote::Direction::Fetch)?;
            let (host, url) = links::web_url(&url.to_bstring().to_str_lossy())?;
            Some(WebRemote {
                name: name.to_str_lossy().into_owned(),
                host,
                url,
            })
        })
        .collect()
}

/// When `FETCH_HEAD` was last written, which every fetch (and pull) does.
pub(super) fn last_fetched(repo: &gix::Repository) -> Option<i64> {
    [repo.git_dir(), repo.common_dir()]
        .iter()
        .find_map(|dir| {
            std::fs::metadata(dir.join("FETCH_HEAD"))
                .ok()?
                .modified()
                .ok()
        })
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|age| age.as_secs() as i64)
}

/// The remote-tracking branch that `branch` pulls from, like `origin/main`.
pub(crate) fn upstream(repo: &gix::Repository, branch: &str) -> Option<Upstream> {
    let full_name: gix::refs::FullName = format!("refs/heads/{branch}").try_into().ok()?;
    let tracking = repo
        .branch_remote_tracking_ref_name(full_name.as_ref(), gix::remote::Direction::Fetch)?
        .ok()?;
    let name = tracking.as_bstr().to_str_lossy();
    let commit = repo
        .try_find_reference(tracking.as_ref())
        .ok()
        .flatten()
        .and_then(|mut reference| reference.peel_to_id().ok())
        .map(|id| id.to_string());
    Some(Upstream {
        name: name
            .strip_prefix("refs/remotes/")
            .unwrap_or(&name)
            .to_owned(),
        commit,
    })
}

#[cfg(test)]
mod track_tests {
    use super::parse_track;

    #[test]
    fn reads_ahead_and_behind() {
        let read = |line: &str| parse_track(line).map(|t| (t.name, t.upstream, t.ahead, t.behind));
        assert_eq!(
            read("main\0abc\0refs/remotes/origin/main\0ahead 1, behind 2"),
            Some(("main".into(), "refs/remotes/origin/main".into(), 1, 2))
        );
        assert_eq!(
            read("feature\0abc\0refs/remotes/origin/feature\0behind 12"),
            Some((
                "feature".into(),
                "refs/remotes/origin/feature".into(),
                0,
                12
            ))
        );
        assert_eq!(
            read("level\0abc\0refs/remotes/origin/level\0"),
            Some(("level".into(), "refs/remotes/origin/level".into(), 0, 0))
        );
        assert_eq!(read("old\0abc\0refs/remotes/origin/old\0gone"), None);
        assert_eq!(read("local\0abc\0\0"), None);
    }
}
