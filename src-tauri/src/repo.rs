//! Reading history, refs and per-commit details from a repository with gix.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::path::Path;

use gix::bstr::ByteSlice;
use gix::object::tree::diff::ChangeDetached;
use gix::revision::walk::Sorting;
use gix::traverse::commit::simple::CommitTimeOrder;
use gix::ObjectId;
use serde::Serialize;

use crate::graph::{self, GraphRow};

/// Upper bound for a single load, to keep the UI responsive on huge repositories.
pub const MAX_LIMIT: usize = 200_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSnapshot {
    /// The repository's working directory (or git directory for bare repositories).
    pub path: String,
    pub name: String,
    /// The checked out branch, or `None` when HEAD is detached or unborn.
    pub head_branch: Option<String>,
    pub head_commit: Option<String>,
    pub commits: Vec<CommitRow>,
    /// The number of graph columns needed to draw every row.
    pub lane_count: u16,
    /// `true` when there are more commits than were loaded.
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRow {
    pub id: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    /// Author time, in seconds since the Unix epoch.
    pub time: i64,
    pub parents: Vec<String>,
    pub refs: Vec<RefLabel>,
    pub graph: GraphRow,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    pub name: String,
    pub kind: RefKind,
    /// `true` for the branch that is checked out.
    pub current: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    /// A detached `HEAD`.
    Head,
    Branch,
    Remote,
    Tag,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub id: String,
    pub summary: String,
    pub body: String,
    pub author: Person,
    pub committer: Person,
    pub parents: Vec<String>,
    /// Files changed compared to the first parent.
    pub files: Vec<FileChange>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub name: String,
    pub email: String,
    /// Seconds since the Unix epoch.
    pub time: i64,
    /// The author's timezone offset from UTC, in seconds.
    pub offset: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// The previous path, for renames and copies.
    pub old_path: Option<String>,
    pub status: FileStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
}

type Error = String;

fn open(path: &Path) -> Result<gix::Repository, Error> {
    let mut repo = gix::discover(path)
        .map_err(|e| format!("{} is not a git repository ({e})", path.display()))?;
    // Commits are looked up more than once while walking; a cache makes that cheap.
    repo.object_cache_size_if_unset(64 * 1024 * 1024);
    Ok(repo)
}

/// Load up to `limit` of the most recent commits reachable from any branch, tag or HEAD.
pub fn load(path: &Path, limit: usize) -> Result<RepoSnapshot, Error> {
    let repo = open(path)?;
    let limit = limit.clamp(1, MAX_LIMIT);

    let location = repo.workdir().unwrap_or_else(|| repo.git_dir());
    let name = location
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| location.display().to_string());

    let head_branch = repo
        .head_name()
        .ok()
        .flatten()
        .and_then(|name| name.as_bstr().to_str().ok()?.strip_prefix("refs/heads/").map(str::to_owned));
    let head_commit = repo.head_id().ok().map(|id| id.detach());

    let mut refs = collect_refs(&repo, head_branch.as_deref());
    if let (None, Some(id)) = (&head_branch, head_commit) {
        refs.entry(id).or_default().push(RefLabel {
            name: "HEAD".into(),
            kind: RefKind::Head,
            current: true,
        });
    }
    for labels in refs.values_mut() {
        labels.sort_by(|a, b| {
            b.current
                .cmp(&a.current)
                .then(a.kind.cmp(&b.kind))
                .then_with(|| a.name.cmp(&b.name))
        });
    }

    let mut tips: Vec<ObjectId> = refs.keys().copied().collect();
    tips.extend(head_commit);
    tips.sort();
    tips.dedup();

    let mut walked = Vec::new();
    let mut truncated = false;
    if !tips.is_empty() {
        let walk = repo
            .rev_walk(tips)
            .sorting(Sorting::ByCommitTime(CommitTimeOrder::NewestFirst))
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
                parents: info.parent_ids.iter().copied().collect(),
                commit_time: info.commit_time.unwrap_or(time),
                summary,
                author_name,
                author_email,
                time,
            });
        }
    }

    let walked = topo_sort(walked);
    let pairs: Vec<(ObjectId, Vec<ObjectId>)> =
        walked.iter().map(|c| (c.id, c.parents.clone())).collect();
    let layout = graph::layout(&pairs);

    let commits = walked
        .into_iter()
        .zip(layout.rows)
        .map(|(c, graph)| CommitRow {
            id: c.id.to_string(),
            refs: refs.remove(&c.id).unwrap_or_default(),
            parents: c.parents.iter().map(ToString::to_string).collect(),
            summary: c.summary,
            author_name: c.author_name,
            author_email: c.author_email,
            time: c.time,
            graph,
        })
        .collect();

    Ok(RepoSnapshot {
        path: location.display().to_string(),
        name,
        head_branch,
        head_commit: head_commit.map(|id| id.to_string()),
        commits,
        lane_count: layout.width,
        truncated,
    })
}

struct Walked {
    id: ObjectId,
    parents: Vec<ObjectId>,
    commit_time: i64,
    summary: String,
    author_name: String,
    author_email: String,
    time: i64,
}

/// Group local branches, remote branches and tags by the commit they point to.
fn collect_refs(repo: &gix::Repository, head_branch: Option<&str>) -> HashMap<ObjectId, Vec<RefLabel>> {
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
        let Ok(id) = reference.peel_to_id() else {
            continue;
        };
        // Tags can point at trees or blobs; only commits belong in the graph.
        let is_commit = repo
            .find_header(id.detach())
            .map(|header| header.kind() == gix::object::Kind::Commit)
            .unwrap_or(false);
        if !is_commit {
            continue;
        }
        out.entry(id.detach()).or_default().push(RefLabel {
            current: kind == RefKind::Branch && Some(name) == head_branch,
            name: name.to_owned(),
            kind,
        });
    }
    out
}

/// Order commits so that every commit comes before its parents, preferring newer
/// commits first (like `git log --date-order`). The walk is already in commit-time
/// order; this only fixes up history with skewed clocks.
fn topo_sort(commits: Vec<Walked>) -> Vec<Walked> {
    let index: HashMap<ObjectId, usize> = commits.iter().enumerate().map(|(i, c)| (c.id, i)).collect();
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

/// Full message, people and changed files for one commit.
pub fn details(path: &Path, id: &str) -> Result<CommitDetails, Error> {
    let repo = open(path)?;
    let id = ObjectId::from_hex(id.as_bytes()).map_err(|e| format!("Invalid commit id {id}: {e}"))?;
    let commit = repo
        .find_commit(id)
        .map_err(|e| format!("Could not find commit {id}: {e}"))?;

    let (summary, body) = match commit.message() {
        Ok(message) => (
            message.summary().to_str_lossy().into_owned(),
            message
                .body
                .map(|body| body.to_str_lossy().trim().to_owned())
                .unwrap_or_default(),
        ),
        Err(_) => (commit.message_raw_sloppy().to_str_lossy().trim().to_owned(), String::new()),
    };

    let person = |signature: gix::Result<gix::actor::SignatureRef<'_>>| match signature {
        Ok(signature) => {
            let time = signature.time().unwrap_or_default();
            Person {
                name: signature.name.to_str_lossy().trim().to_owned(),
                email: signature.email.to_str_lossy().trim().to_owned(),
                time: time.seconds,
                offset: time.offset,
            }
        }
        Err(_) => Person {
            name: String::new(),
            email: String::new(),
            time: 0,
            offset: 0,
        },
    };
    let author = person(commit.author());
    let committer = person(commit.committer());
    let parents: Vec<ObjectId> = commit.parent_ids().map(|id| id.detach()).collect();

    let tree = commit
        .tree()
        .map_err(|e| format!("Could not read the tree of {id}: {e}"))?;
    let parent_tree = match parents.first() {
        Some(parent) => Some(
            repo.find_commit(*parent)
                .and_then(|parent| parent.tree())
                .map_err(|e| format!("Could not read the parent of {id}: {e}"))?,
        ),
        None => None,
    };
    let changes = repo
        .diff_tree_to_tree(parent_tree.as_ref(), &tree, None)
        .map_err(|e| format!("Could not diff {id}: {e}"))?;

    let mut files: Vec<FileChange> = changes
        .iter()
        .filter(|change| !change.entry_mode().is_tree())
        .map(file_change)
        .collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(CommitDetails {
        id: id.to_string(),
        summary,
        body,
        author,
        committer,
        parents: parents.iter().map(ToString::to_string).collect(),
        files,
    })
}

fn file_change(change: &ChangeDetached) -> FileChange {
    let path = change.location().to_str_lossy().into_owned();
    match change {
        ChangeDetached::Addition { .. } => FileChange {
            path,
            old_path: None,
            status: FileStatus::Added,
        },
        ChangeDetached::Deletion { .. } => FileChange {
            path,
            old_path: None,
            status: FileStatus::Deleted,
        },
        ChangeDetached::Modification { .. } => FileChange {
            path,
            old_path: None,
            status: FileStatus::Modified,
        },
        ChangeDetached::Rewrite {
            source_location, copy, ..
        } => FileChange {
            path,
            old_path: Some(source_location.to_str_lossy().into_owned()),
            status: if *copy { FileStatus::Copied } else { FileStatus::Renamed },
        },
    }
}
