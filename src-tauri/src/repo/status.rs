//! Uncommitted changes, like `git status`.

use std::collections::HashSet;
use std::path::Path;

use gix::bstr::ByteSlice;
use serde::Serialize;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// Changes in the index, compared to `HEAD`.
    pub staged: Vec<FileChange>,
    /// Changes in the working tree, compared to the index, and untracked files.
    pub unstaged: Vec<FileChange>,
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

/// Staged and unstaged changes, like `git status`. `None` for a clean working
/// tree, a bare repository, or when the status can't be read.
pub(super) fn worktree_status(repo: &gix::Repository) -> Option<WorktreeStatus> {
    use gix::diff::index::ChangeRef;
    use gix::status::index_worktree::iter::Summary;

    repo.workdir()?;
    let mut iter = repo
        .status(gix::progress::Discard)
        .ok()?
        .untracked_files(gix::status::UntrackedFiles::Collapsed)
        .index_worktree_submodules(None)
        .into_iter(Vec::<gix::bstr::BString>::new())
        .ok()?;

    let mut status = WorktreeStatus::default();
    let lossy = |path: &gix::bstr::BStr| path.to_str_lossy().into_owned();
    for item in iter.by_ref().flatten() {
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

    // Files that are unchanged but have new timestamps had to be read to tell.
    if iter
        .into_outcome()
        .is_some_and(|outcome| outcome.has_changes())
    {
        refresh_index(repo);
    }

    // Conflicts where one side deleted the file don't show up as conflicts above (the
    // file can even look untracked), so take every unmerged path from the index itself.
    if let Ok(index) = repo.index_or_empty() {
        let mut conflicted: Vec<String> = index
            .entries()
            .iter()
            .filter(|entry| entry.stage_raw() != 0)
            .map(|entry| lossy(entry.path(&index)))
            .collect();
        conflicted.dedup();
        if !conflicted.is_empty() {
            status
                .staged
                .retain(|file| !conflicted.contains(&file.path));
            status
                .unstaged
                .retain(|file| !conflicted.contains(&file.path));
            status
                .unstaged
                .extend(conflicted.into_iter().map(|path| FileChange {
                    path,
                    old_path: None,
                    status: FileStatus::Conflicted,
                }));
        }
    }

    if status.staged.is_empty() && status.unstaged.is_empty() {
        return None;
    }
    status.staged.sort_by(|a, b| a.path.cmp(&b.path));
    status.unstaged.sort_by(|a, b| a.path.cmp(&b.path));
    Some(status)
}

/// Files whose timestamps changed but whose content didn't (after a tool touched them, or
/// a copy) have to be read again on every status, which takes seconds for big assets.
/// `git status` stores their new timestamps in the index, like it does on the command
/// line, so that only happens once. It runs in the background, and only takes the
/// index's lock if nobody else holds it.
pub(super) fn refresh_index(repo: &gix::Repository) {
    static REFRESHING: std::sync::LazyLock<std::sync::Mutex<HashSet<std::path::PathBuf>>> =
        std::sync::LazyLock::new(Default::default);
    let Some(workdir) = repo.workdir().map(Path::to_owned) else {
        return;
    };
    if !REFRESHING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(workdir.clone())
    {
        return;
    }
    std::thread::spawn(move || {
        if let Ok(git) = crate::git::Git::find(workdir.clone()).map(|git| git.in_background()) {
            let _ = git.run(&[
                "status",
                "--porcelain",
                "--untracked-files=no",
                "--ignore-submodules",
            ]);
        }
        REFRESHING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&workdir);
    });
}
