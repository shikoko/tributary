//! Staging, unstaging and throwing away some of a file's changed lines, rather than the
//! whole file: a patch with just those lines, made from git's own diff and applied with
//! `git apply` (to the index, or to the file).

use std::collections::BTreeSet;

use serde::Deserialize;
use ts_rs::TS;

use super::Extra;
use super::backups::{DISCARDED, forget_old_discards};
use super::support::{now_millis, ref_id};
use super::validate::check_file_paths;
use crate::error::Result;
use crate::git::Git;

/// What to do with the chosen lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum LineMode {
    /// Add them to what's staged (from the file's unstaged changes).
    Stage,
    /// Take them out of what's staged (from its staged changes).
    Unstage,
    /// Undo them in the file itself (from its unstaged changes).
    Discard,
}

/// One patch line: its first character (' ', '+', '-' or '\\') and the rest, as bytes
/// (the file needn't be UTF-8).
type Line<'a> = (u8, &'a [u8]);

/// From `diff` (git's diff of one file), a patch with only the changes on the `added`
/// lines (numbered as after the change) and `removed` lines (numbered as before it).
///
/// Applied forwards (`reverse` false, for staging), the other changes are left out: added
/// lines are dropped and removed lines stay, as context. Applied in reverse (unstaging,
/// discarding), the other changes are what's there already: added lines stay, as
/// context, and removed lines are dropped.
pub(crate) fn partial_patch(
    diff: &[u8],
    added: &BTreeSet<u32>,
    removed: &BTreeSet<u32>,
    reverse: bool,
) -> std::result::Result<Vec<u8>, String> {
    let mut lines: Vec<&[u8]> = diff.split(|&byte| byte == b'\n').collect();
    if lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    let Some(first_hunk) = lines.iter().position(|line| line.starts_with(b"@@")) else {
        return Err(
            if lines.iter().any(|line| line.starts_with(b"Binary files")) {
                "This file isn't text, so it can't be split into lines.".into()
            } else {
                "There are no changed lines here any more.".into()
            },
        );
    };
    let header = &lines[..first_hunk];

    let mut found_added = BTreeSet::new();
    let mut found_removed = BTreeSet::new();
    // Whether some changes are left out, which turns a new or deleted file into a change.
    let mut partial = false;
    let mut hunks: Vec<Vec<u8>> = Vec::new();
    // How far the side being written has moved from the side being matched, so far.
    let mut shift: i64 = 0;
    let mut index = first_hunk;
    while index < lines.len() {
        let (old_start, new_start) = parse_hunk_header(lines[index])
            .ok_or_else(|| "Couldn't read git's diff of this file.".to_owned())?;
        index += 1;
        let (mut old_number, mut new_number) = (old_start, new_start);
        let mut body: Vec<Line> = Vec::new();
        let mut changed = false;
        let mut kept_last = false;
        while index < lines.len() && !lines[index].starts_with(b"@@") {
            let line = lines[index];
            index += 1;
            let (&sign, text) = line.split_first().unwrap_or((&b' ', &[]));
            match sign {
                b'+' => {
                    let chosen = added.contains(&new_number);
                    found_added.insert(new_number);
                    new_number += 1;
                    kept_last = chosen || reverse;
                    if chosen {
                        body.push((b'+', text));
                        changed = true;
                    } else {
                        partial = true;
                        if reverse {
                            body.push((b' ', text));
                        }
                    }
                }
                b'-' => {
                    let chosen = removed.contains(&old_number);
                    found_removed.insert(old_number);
                    old_number += 1;
                    kept_last = chosen || !reverse;
                    if chosen {
                        body.push((b'-', text));
                        changed = true;
                    } else {
                        partial = true;
                        if !reverse {
                            body.push((b' ', text));
                        }
                    }
                }
                // "\ No newline at end of file", about the line before it.
                b'\\' => {
                    if kept_last {
                        body.push((b'\\', text));
                    }
                }
                _ => {
                    body.push((b' ', text));
                    old_number += 1;
                    new_number += 1;
                    kept_last = true;
                }
            }
        }
        if !changed {
            continue;
        }
        let old_count = body
            .iter()
            .filter(|(sign, _)| matches!(sign, b' ' | b'-'))
            .count() as i64;
        let new_count = body
            .iter()
            .filter(|(sign, _)| matches!(sign, b' ' | b'+'))
            .count() as i64;
        // The side that's matched keeps its numbers; the other follows the changes so far.
        // An empty range is numbered by the line before it.
        let (old_at, new_at) = if reverse {
            let new_at = i64::from(new_start);
            let old_at = new_at + shift - i64::from(old_count == 0 && new_count > 0);
            shift += old_count - new_count;
            (old_at, new_at)
        } else {
            let old_at = i64::from(old_start);
            let new_at = old_at + shift - i64::from(new_count == 0 && old_count > 0);
            shift += new_count - old_count;
            (old_at, new_at)
        };
        let mut hunk = format!("@@ -{old_at},{old_count} +{new_at},{new_count} @@\n").into_bytes();
        for (sign, text) in body {
            hunk.push(sign);
            hunk.extend_from_slice(text);
            hunk.push(b'\n');
        }
        hunks.push(hunk);
    }

    if !added.is_subset(&found_added) || !removed.is_subset(&found_removed) {
        return Err(
            "The file has changed since these lines were shown. Look again and try once more."
                .into(),
        );
    }
    if hunks.is_empty() {
        return Err("Choose some added or removed lines first.".into());
    }

    let mut patch = Vec::new();
    for line in header {
        // Mode changes go with the whole file, not some of its lines.
        if line.starts_with(b"old mode ")
            || line.starts_with(b"new mode ")
            || line.starts_with(b"index ")
        {
            continue;
        }
        if partial {
            // Part of a new (or deleted) file is a change to the file, not a new one.
            if line.starts_with(b"new file mode ") || line.starts_with(b"deleted file mode ") {
                continue;
            }
            if *line == b"--- /dev/null" {
                patch.extend(other_side(header, b"+++ ", b"--- ", b'b', b'a'));
                patch.push(b'\n');
                continue;
            }
            if *line == b"+++ /dev/null" {
                patch.extend(other_side(header, b"--- ", b"+++ ", b'a', b'b'));
                patch.push(b'\n');
                continue;
            }
        }
        patch.extend_from_slice(line);
        patch.push(b'\n');
    }
    for hunk in hunks {
        patch.extend(hunk);
    }
    Ok(patch)
}

/// The "--- a/path" line for a file that only has "+++ b/path" (or the other way round):
/// the same path (quoted or not) with the other side's prefix.
fn other_side(header: &[&[u8]], has: &[u8], wants: &[u8], from: u8, to: u8) -> Vec<u8> {
    let Some(line) = header
        .iter()
        .find(|line| line.starts_with(has) && !line.ends_with(b"/dev/null"))
    else {
        return wants.to_vec();
    };
    let mut path = line[has.len()..].to_vec();
    // `b/path`, or `"b/pa\th"` when git quotes it.
    let at = usize::from(path.first() == Some(&b'"'));
    if path.get(at) == Some(&from) {
        path[at] = to;
    }
    let mut result = wants.to_vec();
    result.extend(path);
    result
}

/// `@@ -12,7 +12,9 @@ fn main()` → (12, 12).
fn parse_hunk_header(line: &[u8]) -> Option<(u32, u32)> {
    let text = std::str::from_utf8(line).ok()?;
    let mut parts = text.split(' ');
    parts.next()?;
    let start = |part: &str, sign: char| -> Option<u32> {
        part.strip_prefix(sign)?.split(',').next()?.parse().ok()
    };
    let old = start(parts.next()?, '-')?;
    let new = start(parts.next()?, '+')?;
    Some((old, new))
}

/// Stage, unstage or throw away the changes on some lines of `file`.
pub(super) fn apply_lines(
    repo: &gix::Repository,
    git: &Git,
    file: String,
    mode: LineMode,
    added: Vec<u32>,
    removed: Vec<u32>,
    extra: &mut Extra,
) -> Result<String> {
    let checked = check_file_paths(std::slice::from_ref(&file))?;
    let file = checked[0];
    let added: BTreeSet<u32> = added.into_iter().collect();
    let removed: BTreeSet<u32> = removed.into_iter().collect();
    let pathspec = format!(":(literal){file}");
    let mut args = vec![
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "-U3",
    ];
    if mode == LineMode::Unstage {
        args.push("--cached");
    }
    args.extend(["--", &pathspec]);
    let diff = git.run_bytes(&args, None)?;
    let patch = partial_patch(&diff, &added, &removed, mode != LineMode::Stage)?;

    let saved = PatchFile::write(&patch)?;
    let file_path = saved.path_str()?;
    let mut apply = vec!["apply", "--whitespace=nowarn"];
    match mode {
        LineMode::Stage => apply.push("--cached"),
        LineMode::Unstage => apply.extend(["--cached", "--reverse"]),
        LineMode::Discard => apply.push("--reverse"),
    }
    apply.push(file_path);
    if mode == LineMode::Discard {
        // Kept for a while (like discarded files), so it can be undone.
        let blob = git.run(&["hash-object", "-w", file_path])?;
        let reference = format!("{DISCARDED}{}", now_millis());
        git.run(&[
            "apply",
            "--check",
            "--whitespace=nowarn",
            "--reverse",
            file_path,
        ])?;
        git.run(&["update-ref", &reference, blob.trim()])?;
        git.run(&apply)?;
        forget_old_discards(repo, git);
        extra.backup = Some(reference);
    } else {
        git.run(&apply)?;
    }
    let lines = added.len() + removed.len();
    let what = format!(
        "{} of {file}",
        if lines == 1 {
            "1 line".to_owned()
        } else {
            format!("{lines} lines")
        }
    );
    Ok(match mode {
        LineMode::Stage => format!("Staged {what}"),
        LineMode::Unstage => format!("Unstaged {what}"),
        LineMode::Discard => format!("Discarded {what}"),
    })
}

/// Put back lines thrown away by [`apply_lines`], kept as a patch at `reference`.
pub(super) fn restore_discarded_lines(
    repo: &gix::Repository,
    git: &Git,
    reference: &str,
) -> Result<String> {
    if !reference.starts_with(DISCARDED) || ref_id(repo, reference).is_none() {
        return Err("Those changes aren't kept any more.".into());
    }
    let patch = git.run_bytes(&["cat-file", "blob", reference], None)?;
    let saved = PatchFile::write(&patch)?;
    git.run(&["apply", "--whitespace=nowarn", saved.path_str()?])
        .map_err(|e| format!("Couldn't put the lines back: the file has changed since. ({e})"))?;
    git.run(&["update-ref", "-d", reference])?;
    Ok("Put the discarded lines back".into())
}

/// Whether `reference` (a discarded change) is a patch of some lines, rather than files.
pub(super) fn is_discarded_lines(git: &Git, reference: &str) -> bool {
    git.run(&["cat-file", "-t", reference])
        .is_ok_and(|kind| kind.trim() == "blob")
}

/// A patch in a temporary file for `git apply`, deleted when dropped.
struct PatchFile(std::path::PathBuf);

impl PatchFile {
    fn write(patch: &[u8]) -> Result<Self> {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "tributary-lines-{}-{}.patch",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, patch).map_err(|e| format!("Couldn't write the patch: {e}"))?;
        Ok(PatchFile(path))
    }

    fn path_str(&self) -> Result<&str> {
        Ok(self
            .0
            .to_str()
            .ok_or("The temporary folder's path isn't text.")?)
    }
}

impl Drop for PatchFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(numbers: &[u32]) -> BTreeSet<u32> {
        numbers.iter().copied().collect()
    }

    const DIFF: &str = "diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,4 +1,5 @@
 one
-two
+TWO
+two and a half
 three
 four
@@ -10,3 +11,3 @@ fn tail
 ten
-eleven
+ELEVEN
 twelve
";

    #[test]
    fn stages_chosen_lines_and_leaves_the_rest() {
        let patch = partial_patch(DIFF.as_bytes(), &set(&[2]), &set(&[2]), false).unwrap();
        assert_eq!(
            String::from_utf8(patch).unwrap(),
            "diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1,4 +1,4 @@
 one
-two
+TWO
 three
 four
"
        );
    }

    #[test]
    fn numbers_later_hunks_after_the_earlier_ones() {
        // Only the added line in the first hunk: the second hunk moves down by one.
        let patch = partial_patch(DIFF.as_bytes(), &set(&[3, 12]), &set(&[11]), false).unwrap();
        let text = String::from_utf8(patch).unwrap();
        assert!(
            text.contains("@@ -1,4 +1,5 @@\n one\n two\n+two and a half\n three\n four\n"),
            "{text}"
        );
        assert!(
            text.contains("@@ -10,3 +11,3 @@\n ten\n-eleven\n+ELEVEN\n twelve\n"),
            "{text}"
        );
    }

    #[test]
    fn unstages_chosen_lines_in_reverse() {
        // Taking out "two and a half" only: the other added line is context now.
        let patch = partial_patch(DIFF.as_bytes(), &set(&[3]), &set(&[]), true).unwrap();
        assert_eq!(
            String::from_utf8(patch).unwrap(),
            "diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1,4 +1,5 @@
 one
 TWO
+two and a half
 three
 four
"
        );
    }

    #[test]
    fn part_of_a_new_file_is_a_change() {
        let diff = "diff --git a/n.txt b/n.txt\nnew file mode 100644\nindex 0000000..3333333\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n";
        let patch = partial_patch(diff.as_bytes(), &set(&[2]), &set(&[]), true).unwrap();
        assert_eq!(
            String::from_utf8(patch).unwrap(),
            "diff --git a/n.txt b/n.txt\n--- a/n.txt\n+++ b/n.txt\n@@ -1,2 +1,3 @@\n a\n+b\n c\n"
        );
        // All of it stays a new file.
        let whole = partial_patch(diff.as_bytes(), &set(&[1, 2, 3]), &set(&[]), true).unwrap();
        assert!(
            String::from_utf8(whole)
                .unwrap()
                .contains("new file mode 100644\n--- /dev/null\n")
        );
    }

    #[test]
    fn keeps_the_no_newline_marker_with_its_line() {
        let diff = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n x\n-y\n\\ No newline at end of file\n+z\n\\ No newline at end of file\n";
        // Staging nothing but the removal: y goes, z isn't added (nor its marker).
        let patch = String::from_utf8(
            partial_patch(diff.as_bytes(), &set(&[]), &set(&[2]), false).unwrap(),
        )
        .unwrap();
        assert!(
            patch.ends_with("@@ -1,2 +1,1 @@\n x\n-y\n\\ No newline at end of file\n"),
            "{patch}"
        );
    }

    #[test]
    fn refuses_lines_that_moved() {
        assert!(partial_patch(DIFF.as_bytes(), &set(&[40]), &set(&[]), false).is_err());
        assert!(partial_patch(DIFF.as_bytes(), &set(&[]), &set(&[]), false).is_err());
    }
}
