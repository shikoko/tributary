//! What makes a repository big: every version of every file ever committed stays in its
//! history, so a big file deleted long ago still costs everyone who clones it. Listed here:
//! the biggest files in all of history (deleted or not), and what each folder and kind of
//! file costs; and moving such files into Git LFS, from now on or by rewriting history
//! (`git lfs migrate import`).

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::backups::{BackupEvent, back_up};
use super::stacks::branch_tips;
use super::validate::check_patterns;
use crate::error::{Error, Result};
use crate::git::Git;

/// How many of the biggest files are listed.
const MOST_FILES: usize = 60;
/// How many folders and kinds of file are listed.
const MOST_GROUPS: usize = 12;

/// What makes a repository big.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RepoSize {
    /// The history's size on disk (git's packed and loose objects), in bytes.
    pub history_bytes: u64,
    /// How many file versions the history holds.
    pub versions: u64,
    /// The biggest file versions, biggest first.
    pub biggest: Vec<BigFile>,
    /// What each top folder costs (all versions of its files, on disk), most first.
    pub folders: Vec<SizeGroup>,
    /// What each kind of file costs (by extension), most first.
    pub kinds: Vec<SizeGroup>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BigFile {
    pub path: String,
    /// Its size, and what it takes on disk (compressed, maybe stored as a change to another).
    pub bytes: u64,
    pub disk_bytes: u64,
    /// It's in the checked-out commit (otherwise it was deleted or changed since).
    pub current: bool,
    /// Files like it are stored with Git LFS now (so only old versions are in the history).
    pub in_lfs: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SizeGroup {
    pub name: String,
    pub disk_bytes: u64,
    pub versions: u64,
}

fn top_groups(groups: HashMap<String, (u64, u64)>) -> Vec<SizeGroup> {
    let mut groups: Vec<SizeGroup> = groups
        .into_iter()
        .map(|(name, (disk_bytes, versions))| SizeGroup {
            name,
            disk_bytes,
            versions,
        })
        .collect();
    groups.sort_by(|a, b| {
        b.disk_bytes
            .cmp(&a.disk_bytes)
            .then_with(|| a.name.cmp(&b.name))
    });
    groups.truncate(MOST_GROUPS);
    groups
}

/// "*.psd" for "Art/Hero.psd", or the file's own name when it has no extension.
pub fn kind_of(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => {
            format!("*.{}", extension.to_ascii_lowercase())
        }
        _ => name.to_owned(),
    }
}

/// What makes the repository at `path` big.
pub fn repo_size(path: &Path) -> Result<RepoSize> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    // Every file version's size and size on disk, by id.
    let objects = git.run(&[
        "cat-file",
        "--batch-all-objects",
        "--batch-check=%(objecttype) %(objectname) %(objectsize) %(objectsize:disk)",
    ])?;
    let mut sizes: HashMap<&str, (u64, u64)> = HashMap::new();
    for line in objects.lines() {
        let mut parts = line.split(' ');
        if parts.next() != Some("blob") {
            continue;
        }
        let (Some(id), Some(size), Some(disk)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        sizes.insert(id, (size.parse().unwrap_or(0), disk.parse().unwrap_or(0)));
    }
    // Where each was first seen in the history (each version counted once).
    let listing = git
        .run(&["rev-list", "--objects", "--all", "--reflog"])
        .unwrap_or_default();
    let mut placed: HashMap<&str, &str> = HashMap::new();
    for line in listing.lines() {
        if let Some((id, path)) = line.split_once(' ')
            && sizes.contains_key(id)
        {
            placed.entry(id).or_insert(path);
        }
    }
    // By name: what it costs on disk, and how many versions.
    let mut folders: HashMap<String, (u64, u64)> = HashMap::new();
    let mut kinds: HashMap<String, (u64, u64)> = HashMap::new();
    let mut history_bytes = 0;
    for (id, path) in &placed {
        let (_, disk) = sizes[id];
        history_bytes += disk;
        let top = path
            .split_once('/')
            .map_or("(top folder)", |(first, _)| first);
        let folder = folders.entry(top.to_owned()).or_default();
        folder.0 += disk;
        folder.1 += 1;
        let kind = kinds.entry(kind_of(path)).or_default();
        kind.0 += disk;
        kind.1 += 1;
    }
    let mut biggest: Vec<(&str, &str, u64, u64)> = placed
        .iter()
        .map(|(id, path)| (*id, *path, sizes[id].0, sizes[id].1))
        .collect();
    biggest.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.1.cmp(b.1)));
    biggest.truncate(MOST_FILES);
    // Which of them are in the checked-out commit, and which are stored with Git LFS now.
    // "<mode> blob <id>\t<path>" for each file.
    let current: HashSet<String> = git
        .run(&["ls-tree", "-r", "-z", "HEAD"])
        .unwrap_or_default()
        .split('\0')
        .filter_map(|entry| {
            entry
                .split_once('\t')?
                .0
                .split(' ')
                .nth(2)
                .map(str::to_owned)
        })
        .collect();
    let paths: Vec<&str> = biggest.iter().map(|(_, path, _, _)| *path).collect();
    let mut in_lfs = HashSet::new();
    for batch in super::support::in_batches(&paths) {
        let mut args = vec!["check-attr", "-z", "filter", "--"];
        args.extend(batch);
        let output = git
            .run_with_env(&args, &super::support::LITERAL)
            .unwrap_or_default();
        let parts: Vec<&str> = output.split('\0').collect();
        for record in parts.chunks(3) {
            if let [file, "filter", "lfs"] = record {
                in_lfs.insert((*file).to_owned());
            }
        }
    }
    let biggest = biggest
        .into_iter()
        .map(|(id, path, bytes, disk_bytes)| BigFile {
            path: path.to_owned(),
            bytes,
            disk_bytes,
            current: current.contains(id),
            in_lfs: in_lfs.contains(path),
        })
        .collect();
    Ok(RepoSize {
        history_bytes,
        versions: placed.len() as u64,
        biggest,
        folders: top_groups(folders),
        kinds: top_groups(kinds),
    })
}

/// Move files matching `patterns` (like `*.psd`) into Git LFS by rewriting history: in the
/// checked-out branch's commits that aren't on a remote yet, or with `everything`, in every
/// local branch's whole history (which then needs force-pushing, and everyone else to clone
/// again). Every branch rewritten is backed up first.
pub(super) fn migrate_to_lfs(
    repo: &gix::Repository,
    git: &Git,
    patterns: Vec<String>,
    everything: bool,
) -> Result<String> {
    let patterns = check_patterns(&patterns)?;
    if git.run(&["lfs", "version"]).is_err() {
        return Err(
            "This needs Git LFS, which isn't installed: get it from https://git-lfs.com".into(),
        );
    }
    if !git
        .run(&["status", "--porcelain", "--untracked-files=no"])?
        .trim()
        .is_empty()
    {
        return Err("Commit or stash your changes first: the files are rewritten in place.".into());
    }
    let branch = super::validate::current_branch(repo)?;
    let before = branch_tips(git);
    for (name, id) in &before {
        if !everything && *name != branch {
            continue;
        }
        if let Ok(id) = gix::ObjectId::from_hex(id.as_bytes()) {
            back_up(
                repo,
                git,
                &format!("refs/heads/{name}"),
                BackupEvent::Rebased,
                id,
            );
        }
    }
    let include = format!("--include={}", patterns.join(","));
    let mut args = vec![
        "lfs",
        "migrate",
        "import",
        "--skip-fetch",
        "--yes",
        include.as_str(),
    ];
    if everything {
        args.push("--everything");
    }
    git.run(&args)?;
    let after = branch_tips(git);
    let rewritten = before
        .iter()
        .filter(|(name, id)| after.get(*name).is_some_and(|new| new != *id))
        .count();
    let what = patterns.join(", ");
    Ok(match (everything, rewritten) {
        (_, 0) => format!("Nothing to move: no commits had {what} outside Git LFS"),
        (false, _) => format!("Moved {what} into Git LFS in {branch}'s commits not pushed yet"),
        (true, n) => format!(
            "Moved {what} into Git LFS in {} branches' history: force-push them, and ask everyone to clone again",
            n
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_files_by_kind() {
        assert_eq!(kind_of("Art/Hero.PSD"), "*.psd");
        assert_eq!(kind_of("Makefile"), "Makefile");
        assert_eq!(kind_of("Art/.gitkeep"), ".gitkeep");
        let groups = top_groups(HashMap::from([("a".into(), (5, 1)), ("b".into(), (9, 2))]));
        assert_eq!(groups[0].name, "b");
    }
}
