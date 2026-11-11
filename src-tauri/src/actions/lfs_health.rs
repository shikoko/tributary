//! Whether Git LFS works in a repository: installed, set up, and its files downloaded
//! rather than left as small pointer files.

use std::io::Read;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::lfs_settings::FetchFilter;
use crate::error::{Error, Result};
use crate::git::{ExpectedFiles, Git, Progress};

/// How many pointer files are named.
const EXAMPLES: usize = 5;

/// What's wrong with Git LFS in a repository that uses it, if anything.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LfsHealth {
    /// Git LFS isn't installed: files stored with it are left as pointer files, and
    /// files can't be locked.
    pub not_installed: bool,
    /// Git LFS is installed, but git doesn't use it (`git lfs install` was never run),
    /// so checking out leaves pointer files.
    pub not_set_up: bool,
    /// Files in the working tree whose contents weren't downloaded: they're still the
    /// small pointer files Git LFS replaces them with.
    pub pointers: usize,
    /// A few of those, as paths in the repository.
    pub examples: Vec<String>,
}

impl LfsHealth {
    pub fn is_healthy(&self) -> bool {
        !self.not_installed && !self.not_set_up && self.pointers == 0
    }
}

/// How Git LFS is doing in the repository at `path`, or nothing if it doesn't use Git LFS.
pub fn lfs_health(path: &Path) -> Result<Option<LfsHealth>, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let Some(workdir) = repo.workdir().map(Path::to_owned) else {
        return Ok(None);
    };
    if !crate::locks::uses_lfs(&workdir) {
        return Ok(None);
    }
    let git = Git::find(workdir)?.in_background();
    Ok(Some(health(&git)))
}

pub(super) fn health(git: &Git) -> LfsHealth {
    if git.run(&["lfs", "version"]).is_err() {
        return LfsHealth {
            not_installed: true,
            ..LfsHealth::default()
        };
    }
    let configured = |key: &str| {
        git.run(&["config", "--get", key])
            .is_ok_and(|value| !value.trim().is_empty())
    };
    let not_set_up = !configured("filter.lfs.process") && !configured("filter.lfs.smudge");
    let pointers = pointer_files(git);
    LfsHealth {
        not_installed: false,
        not_set_up,
        pointers: pointers.len(),
        examples: pointers.into_iter().take(EXAMPLES).collect(),
    }
}

/// Files in the working tree that are still Git LFS pointers. `git lfs ls-files` marks
/// them with `-` (`*` when the file is there); files left out of a sparse checkout are
/// marked too, but aren't in the working tree, so they don't count, and neither do those
/// in folders chosen not to be downloaded (`lfs.fetchinclude`, `lfs.fetchexclude`).
fn pointer_files(git: &Git) -> Vec<String> {
    let Ok(listing) = git.run(&["lfs", "ls-files"]) else {
        return Vec::new();
    };
    let filter = FetchFilter::read(git);
    listing
        .lines()
        .filter_map(|line| {
            let (_, rest) = line.split_once(' ')?;
            let path = rest.strip_prefix("- ")?;
            (filter.allows(path) && is_pointer(&git.workdir().join(path))).then(|| path.to_owned())
        })
        .collect()
}

/// A Git LFS pointer file starts like this.
const POINTER_START: &[u8] = b"version https://git-lfs";

fn is_pointer(file: &Path) -> bool {
    let mut start = [0u8; POINTER_START.len()];
    std::fs::File::open(file)
        .and_then(|mut file| file.read_exact(&mut start))
        .is_ok_and(|()| start == POINTER_START)
}

/// Download the files stored with Git LFS that are still pointers (`git lfs pull`).
pub(super) fn download_lfs_files(git: &Git, on_progress: &dyn Fn(Progress)) -> Result<String> {
    let pointers = pointer_files(git);
    // Each one's size is in its pointer: first, whether there's room for them.
    let sizes: ExpectedFiles = pointers
        .iter()
        .filter_map(|path| {
            let bytes = std::fs::read(git.workdir().join(path)).ok()?;
            let (_, size) = super::lfs_count::pointer(&bytes)?;
            Some((path.clone(), size))
        })
        .collect();
    super::lfs_count::check_space(git.workdir(), &sizes)?;
    let before = pointers.len();
    git.run_progress(&["lfs", "pull"], on_progress)?;
    let after = pointer_files(git).len();
    let downloaded = before.saturating_sub(after);
    Ok(match (downloaded, after) {
        (0, 0) => "Every file stored with Git LFS is already here".to_owned(),
        (_, 0) => format!("Downloaded {}", files(downloaded)),
        (_, left) => format!(
            "Downloaded {}, but {} couldn't be downloaded",
            files(downloaded),
            files(left)
        ),
    })
}

/// Set git up to use Git LFS (`git lfs install`, once for this computer), then download
/// the files that are still pointers.
pub(super) fn set_up_lfs(git: &Git, on_progress: &dyn Fn(Progress)) -> Result<String> {
    git.run(&["lfs", "install"])?;
    let downloaded = download_lfs_files(git, on_progress)?;
    Ok(format!("Set up Git LFS. {downloaded}"))
}

fn files(count: usize) -> String {
    if count == 1 {
        "1 file".to_owned()
    } else {
        format!("{count} files")
    }
}
