//! Loading a repository: its history laid out as a graph, its refs, and (optionally) its
//! uncommitted changes, as one snapshot for the frontend.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::path::Path;

use gix::ObjectId;
use gix::bstr::ByteSlice;
use gix::revision::walk::Sorting;
use gix::traverse::commit::simple::CommitTimeOrder;
use serde::Serialize;

use super::open;
use super::operation::{Operation, operation};
use super::refs::{
    HiddenRef, RefKind, RefLabel, Upstream, collect_refs, gone_branches, last_fetched, upstream,
    web_remotes,
};
use super::status::{WorktreeStatus, worktree_status};
use crate::error::{Error, Result};
use crate::graph;
use crate::graph::{GraphRow, Node};
use crate::links::WebRemote;

/// Upper bound for a single load, to keep the UI responsive on huge repositories.
pub const MAX_LIMIT: usize = 200_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSnapshot {
    /// The repository's working directory (or git directory for bare repositories).
    pub path: String,
    pub name: String,
    /// `true` for a repository without a working tree.
    pub bare: bool,
    /// The checked out branch, or `None` when HEAD is detached or unborn.
    pub head_branch: Option<String>,
    /// The remote branch the checked-out branch pulls from, if it has one.
    pub upstream: Option<Upstream>,
    /// Names of the configured remotes, like `origin`.
    pub remotes: Vec<String>,
    /// A merge, rebase, cherry-pick or revert that stopped, usually because of conflicts.
    pub operation: Option<Operation>,
    /// Only the checked-out branch's own history (first parents) was loaded.
    pub first_parent: bool,
    pub head_commit: Option<String>,
    /// Commits, plus a row for uncommitted changes and one for each stash.
    pub commits: Vec<CommitRow>,
    /// Uncommitted changes, or `None` when the working tree is clean (or there is none).
    pub worktree: Option<WorktreeStatus>,
    /// The number of graph columns needed to draw every row.
    pub lane_count: u16,
    /// `true` when there are more commits than were loaded.
    pub truncated: bool,
    /// Branches, remote branches and tags left out of the graph because they're hidden
    /// (or not soloed), so they can still be listed and shown again.
    pub hidden_refs: Vec<HiddenRef>,
    /// Remotes whose repository has a web page.
    pub web_remotes: Vec<WebRemote>,
    /// The name and email address commits are made with here (`user.name`, `user.email`).
    pub user: Option<Identity>,
    /// When the repository was last fetched from (seconds since the Unix epoch).
    pub last_fetched: Option<i64>,
    /// Local branches whose remote branch was deleted (typically merged pull requests),
    /// apart from the checked-out branch and long-lived ones like main.
    pub gone_branches: Vec<String>,
    /// After a squash merge: the message prepared for committing it.
    pub squash_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRow {
    /// The commit id, or [`WORKTREE_ID`] for the uncommitted changes row.
    pub id: String,
    pub kind: RowKind,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    /// Author time, in seconds since the Unix epoch.
    pub time: i64,
    /// Commit time, in seconds since the Unix epoch.
    pub commit_time: i64,
    pub parents: Vec<String>,
    pub refs: Vec<RefLabel>,
    pub graph: GraphRow,
}

/// The id of the row that stands for uncommitted changes.
pub const WORKTREE_ID: &str = "worktree";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RowKind {
    Commit,
    /// A stash entry, drawn on top of the commit it was made from.
    Stash,
    /// Uncommitted changes in the working tree, drawn on top of `HEAD`.
    Worktree,
}

/// What to load.
#[derive(Debug, Clone, Default)]
pub struct LoadOptions {
    /// At most this many commits.
    pub limit: usize,
    /// Read uncommitted changes. That can take a while in large working trees, so the
    /// app first loads without them.
    pub include_status: bool,
    /// Only the checked-out branch's own history: HEAD and its first parents.
    pub first_parent: bool,
    /// Full names of branches, remote branches and tags to leave out, like `refs/heads/old`.
    pub hidden: Vec<String>,
    /// When not empty, only these refs (and the checked-out branch) are shown.
    pub solo: Vec<String>,
}

/// Load up to `limit` of the most recent commits reachable from any branch, tag or HEAD,
/// plus stashes, and optionally uncommitted changes.
pub fn load(path: &Path, limit: usize, include_status: bool) -> Result<RepoSnapshot, Error> {
    load_with(
        path,
        LoadOptions {
            limit,
            include_status,
            ..LoadOptions::default()
        },
    )
}

pub fn load_with(path: &Path, options: LoadOptions) -> Result<RepoSnapshot, Error> {
    let LoadOptions {
        limit,
        include_status,
        first_parent,
        hidden,
        solo,
    } = options;
    let repo = open(path)?;
    let limit = limit.clamp(1, MAX_LIMIT);

    let location = repo.workdir().unwrap_or_else(|| repo.git_dir());
    let name = location
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| location.display().to_string());

    let head_branch = repo.head_name().ok().flatten().and_then(|name| {
        name.as_bstr()
            .to_str()
            .ok()?
            .strip_prefix("refs/heads/")
            .map(str::to_owned)
    });
    let head_commit = repo.head_id().ok().map(|id| id.detach());

    let mut refs = collect_refs(&repo, head_branch.as_deref());
    // How far each branch is from its upstream, over the whole history (not just the
    // commits loaded).
    let counts = super::refs::upstream_counts(location);
    for label in refs.values_mut().flatten() {
        if label.kind == RefKind::Branch
            && let Some(&(ahead, behind)) = counts.get(&label.name)
        {
            label.ahead = Some(ahead);
            label.behind = Some(behind);
        }
    }
    if let (None, Some(id)) = (&head_branch, head_commit) {
        refs.entry(id).or_default().push(RefLabel {
            name: "HEAD".into(),
            kind: RefKind::Head,
            current: true,
            upstream: None,
            target: None,
            ahead: None,
            behind: None,
        });
    }

    // Hidden (or not soloed) refs aren't labelled, and their history is only loaded if
    // something shown leads to it. The checked-out branch is always shown.
    let mut hidden_refs = Vec::new();
    if !hidden.is_empty() || !solo.is_empty() {
        for (id, labels) in refs.iter_mut() {
            labels.retain(|label| {
                let Some(full_name) = label.full_name() else {
                    return true;
                };
                let shown = label.current
                    || if solo.is_empty() {
                        !hidden.contains(&full_name)
                    } else {
                        solo.contains(&full_name)
                    };
                if !shown {
                    hidden_refs.push(HiddenRef {
                        name: label.name.clone(),
                        kind: label.kind,
                        commit: id.to_string(),
                        upstream: label.upstream.clone(),
                    });
                }
                shown
            });
        }
        refs.retain(|_, labels| !labels.is_empty());
        hidden_refs.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.name.cmp(&b.name)));
    }
    for labels in refs.values_mut() {
        labels.sort_by(|a, b| {
            b.current
                .cmp(&a.current)
                .then(a.kind.cmp(&b.kind))
                .then_with(|| a.name.cmp(&b.name))
        });
    }

    let mut tips: Vec<ObjectId> = if first_parent {
        Vec::new()
    } else {
        refs.keys().copied().collect()
    };
    tips.extend(head_commit);
    tips.sort();
    tips.dedup();

    let mut walked = Vec::new();
    let mut truncated = false;
    if !tips.is_empty() {
        let mut platform = repo
            .rev_walk(tips)
            .sorting(Sorting::ByCommitTime(CommitTimeOrder::NewestFirst));
        if first_parent {
            platform = platform.first_parent_only();
        }
        let walk = platform
            .all()
            .map_err(|e| format!("Could not read history: {e}"))?;
        for info in walk {
            if walked.len() == limit {
                truncated = true;
                break;
            }
            let info = info.map_err(|e| format!("Could not read history: {e}"))?;
            let commit = info
                .object()
                .map_err(|e| format!("Could not read commit {}: {e}", info.id))?;
            let summary = commit
                .message()
                .map(|m| m.summary().to_str_lossy().into_owned())
                .unwrap_or_default();
            let (author_name, author_email, time) = match commit.author() {
                Ok(author) => (
                    author.name.to_str_lossy().trim().to_owned(),
                    author.email.to_str_lossy().trim().to_owned(),
                    author.seconds(),
                ),
                Err(_) => (String::new(), String::new(), 0),
            };
            walked.push(Walked {
                id: info.id,
                kind: RowKind::Commit,
                // From the commit itself: a first-parent walk only reports first parents.
                parents: commit.parent_ids().map(|id| id.detach()).collect(),
                commit_time: info.commit_time.unwrap_or(time),
                summary,
                author_name,
                author_email,
                time,
            });
        }
    }

    // Stashes and uncommitted changes are drawn as extra rows on top of the commit
    // they belong to, as long as that commit is loaded.
    let loaded: HashSet<ObjectId> = walked.iter().map(|c| c.id).collect();
    for (index, stash) in stashes(&repo).into_iter().filter(|_| !first_parent) {
        if loaded.contains(&stash.parents[0]) {
            refs.entry(stash.id).or_default().push(RefLabel {
                name: format!("stash@{{{index}}}"),
                kind: RefKind::Stash,
                current: false,
                upstream: None,
                target: None,
                ahead: None,
                behind: None,
            });
            walked.push(stash);
        }
    }
    let worktree = if include_status {
        worktree_status(&repo)
    } else {
        None
    };
    if worktree.is_some() {
        walked.push(Walked {
            id: ObjectId::null(repo.object_hash()),
            kind: RowKind::Worktree,
            parents: head_commit.into_iter().collect(),
            // Newer than everything else, so it ends up in the first row.
            commit_time: i64::MAX,
            summary: String::new(),
            author_name: String::new(),
            author_email: String::new(),
            time: now(),
        });
    }

    let walked = topo_sort(walked);
    let nodes: Vec<Node<ObjectId>> = walked
        .iter()
        .map(|c| Node {
            id: c.id,
            // In the first-parent view, merged branches aren't loaded: draw a straight line.
            parents: if first_parent {
                c.parents.iter().take(1).copied().collect()
            } else {
                c.parents.clone()
            },
            dashed: c.kind != RowKind::Commit,
        })
        .collect();
    let layout = graph::layout(&nodes);

    let commits = walked
        .into_iter()
        .zip(layout.rows)
        .map(|(c, graph)| CommitRow {
            id: match c.kind {
                RowKind::Worktree => WORKTREE_ID.to_owned(),
                _ => c.id.to_string(),
            },
            kind: c.kind,
            refs: refs.remove(&c.id).unwrap_or_default(),
            parents: c.parents.iter().map(ToString::to_string).collect(),
            summary: c.summary,
            author_name: c.author_name,
            author_email: c.author_email,
            time: c.time,
            commit_time: if c.kind == RowKind::Worktree {
                c.time
            } else {
                c.commit_time
            },
            graph,
        })
        .collect();

    let operation = operation(&repo);
    let config = repo.config_snapshot();
    let identity = Identity {
        name: config
            .string("user.name")
            .map(|v| v.to_str_lossy().into_owned()),
        email: config
            .string("user.email")
            .map(|v| v.to_str_lossy().into_owned()),
    };
    let user = (identity.name.is_some() || identity.email.is_some()).then_some(identity);
    let gone = gone_branches(&repo, head_branch.as_deref());
    // After `git merge --squash`, the changes wait to be committed with this message.
    let squash_message = std::fs::read_to_string(repo.git_dir().join("SQUASH_MSG"))
        .ok()
        .map(|text| {
            text.lines()
                .filter(|line| !line.starts_with('#'))
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_owned()
        })
        .filter(|message| !message.is_empty());
    Ok(RepoSnapshot {
        path: location.display().to_string(),
        name,
        bare: repo.workdir().is_none(),
        upstream: head_branch
            .as_deref()
            .and_then(|branch| upstream(&repo, branch)),
        operation,
        first_parent,
        remotes: repo
            .remote_names()
            .iter()
            .map(|name| name.to_str_lossy().into_owned())
            .collect(),
        head_branch,
        head_commit: head_commit.map(|id| id.to_string()),
        commits,
        worktree,
        lane_count: layout.width,
        truncated,
        hidden_refs,
        web_remotes: web_remotes(&repo),
        user,
        last_fetched: last_fetched(&repo),
        gone_branches: gone,
        squash_message,
    })
}

pub(super) struct Walked {
    id: ObjectId,
    kind: RowKind,
    parents: Vec<ObjectId>,
    commit_time: i64,
    summary: String,
    author_name: String,
    author_email: String,
    time: i64,
}

/// The stash entries with their number, newest (`stash@{0}`) first. Each one only
/// keeps its first parent, the commit it was made from; the extra commits git uses
/// to store the index and untracked files are left out of the graph.
pub(crate) fn stashes(repo: &gix::Repository) -> Vec<(usize, Walked)> {
    let Ok(reference) = repo.find_reference("refs/stash") else {
        return Vec::new();
    };
    let mut log = reference.log_iter();
    let Ok(Some(lines)) = log.all() else {
        return Vec::new();
    };
    let ids: Vec<ObjectId> = lines.flatten().map(|line| line.new_oid()).collect();

    ids.into_iter()
        .rev()
        .enumerate()
        .filter_map(|(index, id)| {
            let commit = repo.find_commit(id).ok()?;
            let base = commit.parent_ids().next()?.detach();
            let author = commit.author().ok()?;
            let summary = commit
                .message()
                .map(|m| m.summary().to_str_lossy().into_owned())
                .unwrap_or_default();
            Some((
                index,
                Walked {
                    id,
                    kind: RowKind::Stash,
                    parents: vec![base],
                    commit_time: commit
                        .time()
                        .map(|t| t.seconds)
                        .unwrap_or_else(|_| author.seconds()),
                    summary,
                    author_name: author.name.to_str_lossy().trim().to_owned(),
                    author_email: author.email.to_str_lossy().trim().to_owned(),
                    time: author.seconds(),
                },
            ))
        })
        .collect()
}

/// Order commits so that every commit comes before its parents, preferring newer
/// commits first (like `git log --date-order`). The walk is already in commit-time
/// order; this only fixes up history with skewed clocks.
pub(super) fn topo_sort(commits: Vec<Walked>) -> Vec<Walked> {
    let index: HashMap<ObjectId, usize> =
        commits.iter().enumerate().map(|(i, c)| (c.id, i)).collect();
    let mut children = vec![0usize; commits.len()];
    for commit in &commits {
        for parent in &commit.parents {
            if let Some(&p) = index.get(parent) {
                children[p] += 1;
            }
        }
    }

    #[derive(PartialEq, Eq)]
    struct Ready {
        time: i64,
        position: usize,
    }
    impl Ord for Ready {
        fn cmp(&self, other: &Self) -> Ordering {
            // Newest first; ties keep the walk's order.
            self.time
                .cmp(&other.time)
                .then_with(|| other.position.cmp(&self.position))
        }
    }
    impl PartialOrd for Ready {
        fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
            Some(self.cmp(other))
        }
    }

    let mut ready: BinaryHeap<Ready> = commits
        .iter()
        .enumerate()
        .filter(|(i, _)| children[*i] == 0)
        .map(|(position, c)| Ready {
            time: c.commit_time,
            position,
        })
        .collect();

    let mut order = Vec::with_capacity(commits.len());
    while let Some(Ready { position, .. }) = ready.pop() {
        order.push(position);
        for parent in &commits[position].parents {
            if let Some(&p) = index.get(parent) {
                children[p] -= 1;
                if children[p] == 0 {
                    ready.push(Ready {
                        time: commits[p].commit_time,
                        position: p,
                    });
                }
            }
        }
    }

    let mut slots: Vec<Option<Walked>> = commits.into_iter().map(Some).collect();
    order.into_iter().filter_map(|i| slots[i].take()).collect()
}

pub(crate) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
