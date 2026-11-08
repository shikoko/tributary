//! Small helpers shared by the actions: counting, naming files, batching paths.

use std::time::{SystemTime, UNIX_EPOCH};

use gix::ObjectId;
use gix::bstr::ByteSlice;

pub(super) fn count(n: usize, word: &str) -> String {
    // Thousands separated, like "3,000 files".
    let digits = n.to_string();
    let mut grouped = String::new();
    for (i, digit) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    format!("{grouped} {word}{}", if n == 1 { "" } else { "s" })
}

/// The name of a file, without its folders.
pub(super) fn file_name(path: &str) -> &str {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
}

/// "Barber.uasset" for one file, "3 files" for more.
pub(super) fn describe_files(paths: &[&str]) -> String {
    match paths {
        [one] => file_name(one).to_owned(),
        _ => count(paths.len(), "file"),
    }
}

/// A short form of a revision for messages: commit ids are shortened, names kept.
pub(super) fn short(name: &str) -> &str {
    if name.len() >= 40 && name.chars().all(|c| c.is_ascii_hexdigit()) {
        &name[..7]
    } else {
        name
    }
}

/// Long lists of paths are passed to git in batches, to stay under the command line
/// length limit (about 32,000 characters on Windows).
pub(super) fn in_batches<'a>(paths: &'a [&'a str]) -> impl Iterator<Item = &'a [&'a str]> {
    const MAX_CHARS: usize = 20_000;
    let mut start = 0;
    std::iter::from_fn(move || {
        if start >= paths.len() {
            return None;
        }
        let mut end = start;
        let mut chars = 0;
        while end < paths.len() && (end == start || chars + paths[end].len() < MAX_CHARS) {
            chars += paths[end].len() + 1;
            end += 1;
        }
        let batch = &paths[start..end];
        start = end;
        Some(batch)
    })
}

/// Paths are taken literally, never as patterns: a file can be called `a*.png`.
pub(super) const LITERAL: [(&str, &str); 1] = [("GIT_LITERAL_PATHSPECS", "1")];

/// The commit a ref points at now, if it exists.
pub(super) fn ref_id(repo: &gix::Repository, full_name: &str) -> Option<ObjectId> {
    repo.try_find_reference(full_name)
        .ok()
        .flatten()
        .and_then(|mut reference| reference.peel_to_id().ok())
        .map(|id| id.detach())
}

pub(super) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn summary_of(repo: &gix::Repository, id: ObjectId) -> (String, i64) {
    repo.find_commit(id)
        .ok()
        .map(|commit| {
            let summary = commit
                .message()
                .map(|m| m.summary().to_str_lossy().into_owned())
                .unwrap_or_default();
            (summary, commit.time().map(|t| t.seconds).unwrap_or(0))
        })
        .unwrap_or_default()
}

pub(super) fn is_merge(repo: &gix::Repository, id: ObjectId) -> bool {
    repo.find_commit(id)
        .map(|commit| commit.parent_ids().count() > 1)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_with_thousands_separated() {
        assert_eq!(count(1, "file"), "1 file");
        assert_eq!(count(999, "file"), "999 files");
        assert_eq!(count(3000, "file"), "3,000 files");
        assert_eq!(count(1_234_567, "commit"), "1,234,567 commits");
    }
}
