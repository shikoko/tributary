//! The Git LFS files a pull or a switch will download. git checks files out one at a time
//! and Git LFS downloads each as it's asked for (slowly: one request a file), and knows
//! nothing of the others. The commits being checked out know them all: the files they
//! change that LFS stores, less those whose content is here already. So they're downloaded
//! first, all together and several at a time (`git lfs fetch`), and the checkout finds
//! them here; and what's left (if that failed) is at least counted.

use std::cell::Cell;
use std::collections::HashSet;
use std::path::Path;

use super::support::{LITERAL, in_batches};
use crate::error::Error;
use crate::git::lfs_progress::format_bytes;
use crate::git::{ExpectedFiles, Git, Progress};

/// Room kept free besides what the files take: git needs some for itself.
const SPARE_SPACE: u64 = 256 * 1024 * 1024;

/// What a message about too little disk space starts with (the frontend offers to go ahead).
pub const NOT_ENOUGH_SPACE: &str = "Not enough disk space";

thread_local! {
    /// The person chose to download anyway: no disk space check on this thread.
    static ANY_SPACE: Cell<bool> = const { Cell::new(false) };
}

/// Run `run` without checking for disk space first.
pub(super) fn without_space_check<T>(run: impl FnOnce() -> T) -> T {
    ANY_SPACE.set(true);
    let result = run();
    ANY_SPACE.set(false);
    result
}

/// Whether there's room for `files` on the disk `folder` is on: each takes its size twice,
/// once in Git LFS's store and once checked out. Not knowing how much is free isn't a reason
/// to stop.
pub(super) fn check_space(folder: &Path, files: &ExpectedFiles) -> Result<(), Error> {
    if ANY_SPACE.get() {
        return Ok(());
    }
    // In development builds, a made-up amount (bytes) shows the check without filling a disk.
    #[cfg(debug_assertions)]
    if let Some(free) = std::env::var("TRIBUTARY_TEST_FREE_SPACE")
        .ok()
        .and_then(|free| free.parse().ok())
    {
        return room_for(files, free);
    }
    let Ok(free) = fs4::available_space(folder) else {
        return Ok(());
    };
    room_for(files, free)
}

fn room_for(files: &ExpectedFiles, free: u64) -> Result<(), Error> {
    let bytes: u64 = files.iter().map(|(_, size)| size).sum();
    let needed = bytes.saturating_mul(2);
    if free >= needed.saturating_add(SPARE_SPACE) {
        return Ok(());
    }
    let count = files.len();
    Err(format!(
        "{NOT_ENOUGH_SPACE}: this downloads {count} Git LFS {} ({}), about {} on disk once \
         checked out, and only {} is free. Make room and try again.",
        if count == 1 { "file" } else { "files" },
        format_bytes(bytes),
        format_bytes(needed),
        format_bytes(free),
    )
    .into())
}

/// Run a checkout (`args`, a switch or a fast-forward to `target`) with its progress,
/// downloading the Git LFS files it needs first, all together.
pub(super) fn checkout_counting(
    repo: &gix::Repository,
    git: &Git,
    args: &[&str],
    target: &str,
    on_progress: &dyn Fn(Progress),
) -> Result<(), Error> {
    let before = git
        .run(&["rev-parse", "--verify", "--quiet", "HEAD"])
        .ok()
        .map(|id| id.trim().to_owned());
    let common = repo.common_dir().to_owned();
    if let Some(before) = &before {
        prefetch(
            git,
            &common,
            &format!("{before}..{target}"),
            target,
            on_progress,
        )?;
    }
    let expected = |seen: &HashSet<String>| {
        let before = before.as_deref()?;
        lfs_downloads(git, &common, &format!("{before}..{target}"), target, seen)
    };
    git.run_progress_counting(args, &[], on_progress, &expected)?;
    Ok(())
}

/// Download the Git LFS files that checking out `to` needs (comparing `range`), all
/// together, from the remote they come from. When that fails, the checkout downloads what's
/// left one at a time, so only cancelling stops it.
pub(super) fn prefetch(
    git: &Git,
    common_dir: &Path,
    range: &str,
    to: &str,
    on_progress: &dyn Fn(Progress),
) -> Result<(), Error> {
    if git.run(&["lfs", "version"]).is_err() {
        return Ok(());
    }
    let Some(files) = lfs_downloads(git, common_dir, range, to, &HashSet::new()) else {
        return Ok(());
    };
    check_space(common_dir, &files)?;
    let (Some(remote), Ok(id)) = (
        remote_for(git, to),
        git.run(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{to}^{{commit}}"),
        ]),
    ) else {
        return Ok(());
    };
    let expected = |_: &HashSet<String>| Some(files.clone());
    match git.run_progress_counting(
        &["lfs", "fetch", &remote, id.trim()],
        &[],
        on_progress,
        &expected,
    ) {
        Err(Error::Cancelled) => Err(Error::Cancelled),
        _ => Ok(()),
    }
}

/// The remote `to` comes from: its own, for a remote branch; the one its upstream is on;
/// or origin (or the only remote).
pub(super) fn remote_for(git: &Git, to: &str) -> Option<String> {
    let remotes: Vec<String> = git
        .run(&["remote"])
        .ok()?
        .lines()
        .map(str::to_owned)
        .collect();
    let on = |full: &str| {
        remotes
            .iter()
            .filter(|remote| full.starts_with(&format!("refs/remotes/{remote}/")))
            .max_by_key(|remote| remote.len())
            .cloned()
    };
    let full_name = |name: &str| {
        git.run(&["rev-parse", "--symbolic-full-name", name])
            .ok()
            .map(|full| full.trim().to_owned())
    };
    full_name(to)
        .and_then(|full| on(&full))
        .or_else(|| full_name(&format!("{to}@{{upstream}}")).and_then(|full| on(&full)))
        .or_else(|| remotes.iter().find(|remote| *remote == "origin").cloned())
        .or_else(|| (remotes.len() == 1).then(|| remotes[0].clone()))
}

/// The Git LFS files, with their sizes, that differ between `from` and `to` (`range` is how
/// they're compared: `from..to` for a switch, `from...to` for what a pull brings in) that
/// LFS downloads: those it has (`seen`, its log so far) and those whose content isn't here
/// yet. None when there are none, or it can't be told.
pub(super) fn lfs_downloads(
    git: &Git,
    common_dir: &Path,
    range: &str,
    to: &str,
    seen: &HashSet<String>,
) -> Option<ExpectedFiles> {
    let to = git
        .run(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{to}^{{commit}}"),
        ])
        .ok()?
        .trim()
        .to_owned();
    let changed = git
        .run(&[
            "diff",
            "--name-only",
            "--no-renames",
            "--diff-filter=d",
            "-z",
            range,
        ])
        .ok()?;
    let paths: Vec<&str> = changed
        .split('\0')
        .filter(|path| !path.is_empty())
        .collect();
    if paths.is_empty() {
        return None;
    }
    // Which of them Git LFS stores.
    let mut stored = Vec::new();
    for batch in in_batches(&paths) {
        let mut args = vec!["check-attr", "-z", "filter", "--"];
        args.extend(batch);
        let output = git.run_with_env(&args, &LITERAL).ok()?;
        let parts: Vec<&str> = output.split('\0').collect();
        for record in parts.chunks(3) {
            if let [file, "filter", "lfs"] = record {
                stored.push((*file).to_owned());
            }
        }
    }
    if stored.is_empty() {
        return None;
    }
    // Their pointers in `to`, and whether each one's content is here already. Asked once
    // LFS has begun, some will have arrived: those count too.
    let input: String = stored.iter().map(|path| format!("{to}:{path}\n")).collect();
    let output = git
        .run_bytes(&["cat-file", "--batch"], Some(input.as_bytes()))
        .ok()?;
    let downloads: ExpectedFiles = stored
        .into_iter()
        .zip(pointers(&output))
        .filter_map(|(path, pointer)| {
            let (oid, size) = pointer?;
            (seen.contains(&path) || !lfs_object(common_dir, &oid).exists()).then_some((path, size))
        })
        .collect();
    (!downloads.is_empty()).then_some(downloads)
}

/// For each object in `git cat-file --batch` output, in order, its Git LFS pointer's object
/// id and size (None when it's missing or isn't a pointer).
fn pointers(mut output: &[u8]) -> Vec<Option<(String, u64)>> {
    let mut found = Vec::new();
    while let Some(end) = output.iter().position(|&b| b == b'\n') {
        let header = String::from_utf8_lossy(&output[..end]).into_owned();
        output = &output[end + 1..];
        // "<id> blob <size>", or "<name> missing".
        let Some(size) = header
            .rsplit(' ')
            .next()
            .and_then(|size| size.parse::<usize>().ok())
            .filter(|_| !header.ends_with(" missing"))
        else {
            found.push(None);
            continue;
        };
        let content = &output[..size.min(output.len())];
        output = &output[(size + 1).min(output.len())..];
        found.push(pointer(content));
    }
    found
}

/// A Git LFS pointer's object id and size.
pub(super) fn pointer(bytes: &[u8]) -> Option<(String, u64)> {
    if bytes.len() > 1024 || !bytes.starts_with(b"version https://git-lfs") {
        return None;
    }
    let text = String::from_utf8_lossy(bytes);
    let oid = text
        .lines()
        .find_map(|line| line.strip_prefix("oid sha256:"))
        .map(|oid| oid.trim().to_owned())
        .filter(|oid| oid.len() == 64 && oid.bytes().all(|b| b.is_ascii_hexdigit()))?;
    let size = text
        .lines()
        .find_map(|line| line.strip_prefix("size "))
        .and_then(|size| size.trim().parse().ok())
        .unwrap_or(0);
    Some((oid, size))
}

/// Where Git LFS keeps an object it has downloaded.
fn lfs_object(common_dir: &Path, oid: &str) -> std::path::PathBuf {
    common_dir
        .join("lfs")
        .join("objects")
        .join(&oid[..2])
        .join(&oid[2..4])
        .join(oid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_room_for_both_copies_of_each_file() {
        let files: ExpectedFiles = vec![
            ("a.psd".into(), 3_000_000_000),
            ("b.wav".into(), 1_000_000_000),
        ];
        // 8 GB, and some to spare.
        assert!(room_for(&files, 9_000_000_000).is_ok());
        let error = room_for(&files, 7_000_000_000).unwrap_err().to_string();
        assert!(error.starts_with(NOT_ENOUGH_SPACE), "{error}");
        assert!(error.contains("2 Git LFS files (4.0 GB)"), "{error}");
        assert!(error.contains("about 8.0 GB"), "{error}");
        assert!(error.contains("only 7.0 GB is free"), "{error}");
        assert!(room_for(&files, 8_100_000_000).is_err());
    }

    #[test]
    fn reads_pointers_from_batch_output() {
        let oid = "a".repeat(64);
        let pointer =
            format!("version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize 12\n");
        let output = format!(
            "1111 blob {}\n{pointer}\nabc:gone missing\n2222 blob 5\nhello\n",
            pointer.len()
        );
        assert_eq!(
            pointers(output.as_bytes()),
            vec![Some((oid, 12)), None, None]
        );
    }
}
