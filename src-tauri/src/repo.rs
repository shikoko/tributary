//! Reading history, refs and per-commit details from a repository with gix.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::path::Path;

use gix::ObjectId;
use gix::bstr::ByteSlice;
use gix::object::tree::diff::ChangeDetached;
use gix::revision::walk::Sorting;
use gix::traverse::commit::simple::CommitTimeOrder;
use serde::Serialize;

use crate::graph::{self, GraphRow, Node};
use crate::links::{self, WebRemote};

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
}

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub kind: OperationKind,
    /// The commit message git prepared, for a merge, cherry-pick or revert.
    pub message: Option<String>,
    /// For a rebase: the branch being rebased (HEAD is detached while it runs).
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    /// Something else, like `git am` or `git bisect`.
    Other,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    /// Like `origin/main`.
    pub name: String,
    /// Where it points, or `None` if it hasn't been fetched yet.
    pub commit: Option<String>,
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

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// Changes in the index, compared to `HEAD`.
    pub staged: Vec<FileChange>,
    /// Changes in the working tree, compared to the index, and untracked files.
    pub unstaged: Vec<FileChange>,
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
    /// A new file git doesn't track yet.
    Untracked,
    /// A file with merge conflicts.
    Conflicted,
}

type Error = String;

fn open(path: &Path) -> Result<gix::Repository, Error> {
    let mut repo = gix::discover(path)
        .map_err(|e| format!("{} is not a git repository ({e})", path.display()))?;
    // Commits are looked up more than once while walking; a cache makes that cheap.
    repo.object_cache_size_if_unset(64 * 1024 * 1024);
    Ok(repo)
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
    if let (None, Some(id)) = (&head_branch, head_commit) {
        refs.entry(id).or_default().push(RefLabel {
            name: "HEAD".into(),
            kind: RefKind::Head,
            current: true,
            upstream: None,
            target: None,
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
    })
}

/// The web pages of the remotes that have one.
fn web_remotes(repo: &gix::Repository) -> Vec<WebRemote> {
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
fn last_fetched(repo: &gix::Repository) -> Option<i64> {
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

struct Walked {
    id: ObjectId,
    kind: RowKind,
    parents: Vec<ObjectId>,
    commit_time: i64,
    summary: String,
    author_name: String,
    author_email: String,
    time: i64,
}

/// A merge, rebase, cherry-pick or revert that is waiting to be continued or aborted.
fn operation(repo: &gix::Repository) -> Option<Operation> {
    use gix::state::InProgress;
    let kind = match repo.state()? {
        InProgress::Merge => OperationKind::Merge,
        InProgress::Rebase | InProgress::RebaseInteractive | InProgress::ApplyMailboxRebase => {
            OperationKind::Rebase
        }
        InProgress::CherryPick | InProgress::CherryPickSequence => OperationKind::CherryPick,
        InProgress::Revert | InProgress::RevertSequence => OperationKind::Revert,
        _ => OperationKind::Other,
    };
    // The message git prepared, without its "# Conflicts:" comment lines.
    let message = std::fs::read_to_string(repo.git_dir().join("MERGE_MSG"))
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
    let branch = (kind == OperationKind::Rebase)
        .then(|| {
            ["rebase-merge/head-name", "rebase-apply/head-name"]
                .iter()
                .find_map(|file| std::fs::read_to_string(repo.git_dir().join(file)).ok())
        })
        .flatten()
        .map(|name| name.trim().trim_start_matches("refs/heads/").to_owned())
        .filter(|name| !name.is_empty() && name != "detached HEAD");
    Some(Operation {
        kind,
        message,
        branch,
    })
}

/// The remote-tracking branch that `branch` pulls from, like `origin/main`.
fn upstream(repo: &gix::Repository, branch: &str) -> Option<Upstream> {
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

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The stash entries with their number, newest (`stash@{0}`) first. Each one only
/// keeps its first parent, the commit it was made from; the extra commits git uses
/// to store the index and untracked files are left out of the graph.
fn stashes(repo: &gix::Repository) -> Vec<(usize, Walked)> {
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

/// Staged and unstaged changes, like `git status`. `None` for a clean working
/// tree, a bare repository, or when the status can't be read.
fn worktree_status(repo: &gix::Repository) -> Option<WorktreeStatus> {
    use gix::diff::index::ChangeRef;
    use gix::status::index_worktree::iter::Summary;

    repo.workdir()?;
    let iter = repo
        .status(gix::progress::Discard)
        .ok()?
        .untracked_files(gix::status::UntrackedFiles::Collapsed)
        .index_worktree_submodules(None)
        .into_iter(Vec::<gix::bstr::BString>::new())
        .ok()?;

    let mut status = WorktreeStatus::default();
    let lossy = |path: &gix::bstr::BStr| path.to_str_lossy().into_owned();
    for item in iter.flatten() {
        match item {
            gix::status::Item::TreeIndex(change) => {
                let (path, old_path, file_status) = match &change {
                    ChangeRef::Addition { location, .. } => {
                        (lossy(location.as_ref()), None, FileStatus::Added)
                    }
                    ChangeRef::Deletion { location, .. } => {
                        (lossy(location.as_ref()), None, FileStatus::Deleted)
                    }
                    ChangeRef::Modification { location, .. } => {
                        (lossy(location.as_ref()), None, FileStatus::Modified)
                    }
                    ChangeRef::Rewrite {
                        source_location,
                        location,
                        copy,
                        ..
                    } => (
                        lossy(location.as_ref()),
                        Some(lossy(source_location.as_ref())),
                        if *copy {
                            FileStatus::Copied
                        } else {
                            FileStatus::Renamed
                        },
                    ),
                };
                status.staged.push(FileChange {
                    path,
                    old_path,
                    status: file_status,
                });
            }
            gix::status::Item::IndexWorktree(item) => {
                let Some(summary) = item.summary() else {
                    continue;
                };
                let file_status = match summary {
                    Summary::Added => FileStatus::Untracked,
                    Summary::Removed => FileStatus::Deleted,
                    Summary::Modified | Summary::TypeChange => FileStatus::Modified,
                    Summary::Renamed => FileStatus::Renamed,
                    Summary::Copied => FileStatus::Copied,
                    Summary::IntentToAdd => FileStatus::Added,
                    Summary::Conflict => FileStatus::Conflicted,
                };
                let mut path = lossy(item.rela_path());
                let old_path = match &item {
                    gix::status::index_worktree::Item::Rewrite { source, .. } => {
                        Some(lossy(source.rela_path()))
                    }
                    _ => None,
                };
                if let gix::status::index_worktree::Item::DirectoryContents { entry, .. } = &item {
                    // A whole untracked folder, shown collapsed like `git status` does.
                    if entry.disk_kind.is_some_and(|kind| kind.is_dir()) {
                        path.push('/');
                    }
                }
                // Conflicts can be reported once per side of the merge; list each file once.
                if file_status == FileStatus::Conflicted
                    && status.unstaged.iter().any(|f| f.path == path)
                {
                    continue;
                }
                status.unstaged.push(FileChange {
                    path,
                    old_path,
                    status: file_status,
                });
            }
        }
    }

    if status.staged.is_empty() && status.unstaged.is_empty() {
        return None;
    }
    status.staged.sort_by(|a, b| a.path.cmp(&b.path));
    status.unstaged.sort_by(|a, b| a.path.cmp(&b.path));
    Some(status)
}

/// Group local branches, remote branches and tags by the commit they point to.
fn collect_refs(
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
        });
    }
    out
}

/// Order commits so that every commit comes before its parents, preferring newer
/// commits first (like `git log --date-order`). The walk is already in commit-time
/// order; this only fixes up history with skewed clocks.
fn topo_sort(commits: Vec<Walked>) -> Vec<Walked> {
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

/// Full message, people and changed files for one commit.
pub fn details(path: &Path, id: &str) -> Result<CommitDetails, Error> {
    let repo = open(path)?;
    let id =
        ObjectId::from_hex(id.as_bytes()).map_err(|e| format!("Invalid commit id {id}: {e}"))?;
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
        Err(_) => (
            commit.message_raw_sloppy().to_str_lossy().trim().to_owned(),
            String::new(),
        ),
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
    // `git stash --include-untracked` keeps untracked files in a third parent.
    if let Some(untracked) = stash_untracked_files(&repo, &parents) {
        files.extend(untracked);
    }
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

/// The untracked files saved in a stash, if `parents` are those of a stash made
/// with `--include-untracked`.
fn stash_untracked_files(repo: &gix::Repository, parents: &[ObjectId]) -> Option<Vec<FileChange>> {
    let untracked = repo.find_commit(*parents.get(2)?).ok()?;
    let message = untracked.message_raw_sloppy();
    if untracked.parent_ids().next().is_some() || !message.starts_with(b"untracked files on ") {
        return None;
    }
    let tree = untracked.tree().ok()?;
    let changes = repo.diff_tree_to_tree(None, &tree, None).ok()?;
    Some(
        changes
            .iter()
            .filter(|change| !change.entry_mode().is_tree())
            .map(|change| FileChange {
                path: change.location().to_str_lossy().into_owned(),
                old_path: None,
                status: FileStatus::Untracked,
            })
            .collect(),
    )
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
            source_location,
            copy,
            ..
        } => FileChange {
            path,
            old_path: Some(source_location.to_str_lossy().into_owned()),
            status: if *copy {
                FileStatus::Copied
            } else {
                FileStatus::Renamed
            },
        },
    }
}
