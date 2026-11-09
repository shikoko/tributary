//! How many Git LFS files a pull or a switch will download. git checks files out one at a
//! time and Git LFS downloads each as it's asked for, so LFS itself never knows how many
//! there are; the commits being checked out do: the files they change that LFS stores,
//! less those whose content was already downloaded.

use std::collections::HashSet;
use std::path::Path;

use super::support::{LITERAL, in_batches};
use crate::error::Error;
use crate::git::{Git, Progress};

/// Run a checkout (`args`, a switch or a fast-forward to `target`) with its progress,
/// counting the Git LFS files it downloads.
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
    let expected = |seen: &HashSet<String>| {
        let before = before.as_deref()?;
        lfs_downloads(git, &common, &format!("{before}..{target}"), target, seen)
    };
    git.run_progress_counting(args, &[], on_progress, &expected)?;
    Ok(())
}

/// The Git LFS files that differ between `from` and `to` (`range` is how they're compared:
/// `from..to` for a switch, `from...to` for what a pull brings in) that LFS downloads:
/// those it has (`seen`, its log so far) and those whose content isn't here yet. None
/// when there are none, or it can't be told.
pub(super) fn lfs_downloads(
    git: &Git,
    common_dir: &Path,
    range: &str,
    to: &str,
    seen: &HashSet<String>,
) -> Option<u32> {
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
    // Their pointers in `to`, and whether each one's content is here already.
    let input: String = stored.iter().map(|path| format!("{to}:{path}\n")).collect();
    let output = git
        .run_bytes(&["cat-file", "--batch"], Some(input.as_bytes()))
        .ok()?;
    // Asked once LFS has begun, so some will have arrived already: those count too.
    let downloads = stored
        .iter()
        .zip(pointers(&output))
        .filter(|(path, oid)| match oid {
            Some(oid) => seen.contains(*path) || !lfs_object(common_dir, oid).exists(),
            None => false,
        })
        .count() as u32;
    (downloads > 0).then_some(downloads)
}

/// For each object in `git cat-file --batch` output, in order, its Git LFS pointer's
/// object id (None when it's missing or isn't a pointer).
fn pointers(mut output: &[u8]) -> Vec<Option<String>> {
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
        found.push(pointer_oid(content));
    }
    found
}

fn pointer_oid(bytes: &[u8]) -> Option<String> {
    if bytes.len() > 1024 || !bytes.starts_with(b"version https://git-lfs") {
        return None;
    }
    String::from_utf8_lossy(bytes)
        .lines()
        .find_map(|line| line.strip_prefix("oid sha256:"))
        .map(|oid| oid.trim().to_owned())
        .filter(|oid| oid.len() == 64 && oid.bytes().all(|b| b.is_ascii_hexdigit()))
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
    fn reads_pointers_from_batch_output() {
        let oid = "a".repeat(64);
        let pointer =
            format!("version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize 12\n");
        let output = format!(
            "1111 blob {}\n{pointer}\nabc:gone missing\n2222 blob 5\nhello\n",
            pointer.len()
        );
        assert_eq!(pointers(output.as_bytes()), vec![Some(oid), None, None]);
    }
}
