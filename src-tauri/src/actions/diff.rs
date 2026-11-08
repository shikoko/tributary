//! What changed in a file: line by line for text, before and after for images, and sizes
//! for other files. Also opening a file in the user's own diff or merge tool.

use std::path::Path;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};

use super::support::LITERAL;
use super::validate::{check_file_paths, commit_id};
use crate::error::{Error, Result};
use crate::git::Git;

/// git's empty tree, to compare a repository's first commit with.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
/// Diffs longer than this aren't shown in full.
const MAX_DIFF_BYTES: usize = 4 * 1024 * 1024;
const MAX_LINES: usize = 20_000;
/// Images bigger than this aren't previewed.
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
/// How long to wait for a diff or merge tool to fail before leaving it open.
const TOOL_SETTLE: Duration = Duration::from_secs(2);

/// Which change to a file.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffSource {
    /// What a commit changed, compared to its first parent.
    Commit { id: String },
    /// Staged changes, compared to the last commit.
    Staged,
    /// Changes not staged yet, compared to what's staged (new files: to nothing).
    Unstaged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Added,
    Removed,
}

/// One line of a diff, with its number before and after the change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: String,
}

/// A stretch of changed lines with some unchanged ones around them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    /// What git says the lines are in, like a function's name.
    pub section: String,
    pub lines: Vec<DiffLine>,
}

/// An image before and after, as `data:` URLs.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Images {
    pub before: Option<String>,
    pub after: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    /// Not text: shown by its sizes (or as images), not line by line.
    pub binary: bool,
    /// Stored with Git LFS.
    pub lfs: bool,
    /// Too long to show line by line.
    pub too_large: bool,
    pub additions: usize,
    pub deletions: usize,
    pub hunks: Vec<Hunk>,
    /// In bytes, when the content isn't shown line by line. None where the file doesn't exist.
    pub size_before: Option<u64>,
    pub size_after: Option<u64>,
    pub images: Option<Images>,
}

/// Where each side of a change is: a blob git can show, a file in the working tree, or
/// nothing (the file was added or deleted).
enum Side {
    Blob(String),
    Worktree,
    Missing,
}

/// What changed in `file` (and, for a rename, from `old_path`).
pub fn file_diff(
    path: &Path,
    source: DiffSource,
    file: &str,
    old_path: Option<&str>,
    ignore_whitespace: bool,
) -> Result<FileDiff, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree.")?
        .to_owned();
    let git = Git::find(workdir)?.in_background();
    let paths: Vec<String> = std::iter::once(file)
        .chain(old_path)
        .map(str::to_owned)
        .collect();
    let paths = check_file_paths(&paths)?;
    let before_path = old_path.unwrap_or(file);

    let untracked = matches!(source, DiffSource::Unstaged)
        && git
            .run_with_env(&["ls-files", "--error-unmatch", "--", file], &LITERAL)
            .is_err();
    let conflicted = matches!(source, DiffSource::Unstaged)
        && git
            .run_with_env(&["ls-files", "--unmerged", "--", file], &LITERAL)
            .is_ok_and(|listing| !listing.trim().is_empty());

    let plan = plan(&repo, &source, file, before_path, conflicted, untracked)?;
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-M"];
    if ignore_whitespace {
        args.push("-w");
    }
    args.extend(plan.revisions.iter().map(String::as_str));
    args.push("--");
    args.extend(paths.iter().copied());

    let mut diff = FileDiff {
        path: file.to_owned(),
        lfs: stored_with_lfs(&git, file),
        ..FileDiff::default()
    };
    let output = if untracked {
        new_file_diff(&git.workdir().join(file))
    } else {
        git.run_with_env(&args, &LITERAL)?
    };
    if output.len() > MAX_DIFF_BYTES {
        diff.too_large = true;
    } else {
        parse_into(&output, &mut diff);
        if diff
            .hunks
            .iter()
            .map(|hunk| hunk.lines.len())
            .sum::<usize>()
            > MAX_LINES
        {
            diff.hunks.clear();
            diff.too_large = true;
        }
    }
    // Git LFS files diff as their small pointer files: show sizes instead.
    if diff.lfs {
        diff.binary = true;
        diff.hunks.clear();
        diff.additions = 0;
        diff.deletions = 0;
    }
    if diff.binary || diff.too_large {
        let image = diff.binary && is_image(file);
        let before = read_side(&git, &plan.before, file, diff.lfs, image);
        let after = read_side(&git, &plan.after, file, diff.lfs, image);
        diff.size_before = before.size;
        diff.size_after = after.size;
        if image {
            diff.images = Some(Images {
                before: before.data.map(|bytes| data_url(file, &bytes)),
                after: after.data.map(|bytes| data_url(file, &bytes)),
            });
        }
    }
    Ok(diff)
}

/// What to compare: the revisions for `git diff`, and where each side's content is.
struct Plan {
    revisions: Vec<String>,
    before: Side,
    after: Side,
}

fn plan(
    repo: &gix::Repository,
    source: &DiffSource,
    file: &str,
    before_path: &str,
    conflicted: bool,
    untracked: bool,
) -> Result<Plan> {
    Ok(match source {
        DiffSource::Commit { id } => {
            let id = commit_id(repo, id)?.to_string();
            let parent = first_parent(repo, &id);
            Plan {
                before: Side::Blob(format!("{parent}:{before_path}")),
                after: Side::Blob(format!("{id}:{file}")),
                revisions: vec![parent, id],
            }
        }
        DiffSource::Staged => Plan {
            revisions: vec!["--cached".into()],
            before: Side::Blob(format!("HEAD:{before_path}")),
            after: Side::Blob(format!(":{file}")),
        },
        // A conflicted file is compared with the last commit: its conflict markers show.
        DiffSource::Unstaged if conflicted => Plan {
            revisions: vec!["HEAD".into()],
            before: Side::Blob(format!("HEAD:{file}")),
            after: Side::Worktree,
        },
        DiffSource::Unstaged if untracked => Plan {
            revisions: Vec::new(),
            before: Side::Missing,
            after: Side::Worktree,
        },
        DiffSource::Unstaged => Plan {
            revisions: Vec::new(),
            before: Side::Blob(format!(":{file}")),
            after: Side::Worktree,
        },
    })
}

/// A commit's first parent, or the empty tree for a repository's first commit.
fn first_parent(repo: &gix::Repository, id: &str) -> String {
    gix::ObjectId::from_hex(id.as_bytes())
        .ok()
        .and_then(|id| repo.find_commit(id).ok())
        .and_then(|commit| {
            commit
                .parent_ids()
                .next()
                .map(|parent| parent.detach().to_string())
        })
        .unwrap_or_else(|| EMPTY_TREE.to_owned())
}

struct Read {
    size: Option<u64>,
    data: Option<Vec<u8>>,
}

/// One side's size, and with `content`, its bytes (for a Git LFS file, the real file
/// rather than its pointer, when it's on this computer).
fn read_side(git: &Git, side: &Side, file: &str, lfs: bool, content: bool) -> Read {
    let bytes = match side {
        Side::Missing => {
            return Read {
                size: None,
                data: None,
            };
        }
        Side::Worktree => {
            let path = git.workdir().join(file);
            let Ok(metadata) = std::fs::metadata(&path) else {
                return Read {
                    size: None,
                    data: None,
                };
            };
            let wanted = content && metadata.len() <= MAX_IMAGE_BYTES;
            let data = if wanted {
                std::fs::read(&path).ok()
            } else {
                None
            };
            let pointer = data.as_deref().filter(|bytes| is_lfs_pointer(bytes));
            if let Some(pointer) = pointer {
                // Not downloaded: the pointer says how big it is.
                return Read {
                    size: pointer_size(pointer),
                    data: None,
                };
            }
            return Read {
                size: Some(metadata.len()),
                data,
            };
        }
        Side::Blob(spec) => match git.run_bytes(&["cat-file", "blob", spec], None) {
            Ok(bytes) => bytes,
            Err(_) => {
                return Read {
                    size: None,
                    data: None,
                };
            }
        },
    };
    if lfs && is_lfs_pointer(&bytes) {
        let size = pointer_size(&bytes);
        let data = (content && size.is_some_and(|size| size <= MAX_IMAGE_BYTES))
            .then(|| {
                git.run_bytes(&["lfs", "smudge", "--", file], Some(&bytes))
                    .ok()
            })
            .flatten()
            .filter(|real| !is_lfs_pointer(real));
        return Read { size, data };
    }
    let size = Some(bytes.len() as u64);
    let data = (content && bytes.len() as u64 <= MAX_IMAGE_BYTES).then_some(bytes);
    Read { size, data }
}

fn is_lfs_pointer(bytes: &[u8]) -> bool {
    bytes.len() < 1024 && bytes.starts_with(b"version https://git-lfs")
}

/// The real file's size, from a Git LFS pointer's `size` line.
fn pointer_size(pointer: &[u8]) -> Option<u64> {
    String::from_utf8_lossy(pointer)
        .lines()
        .find_map(|line| line.strip_prefix("size ")?.trim().parse().ok())
}

fn stored_with_lfs(git: &Git, file: &str) -> bool {
    git.run_with_env(&["check-attr", "filter", "--", file], &LITERAL)
        .is_ok_and(|output| output.trim_end().ends_with(": filter: lfs"))
}

const IMAGE_TYPES: [(&str, &str); 7] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
];

fn image_type(file: &str) -> Option<&'static str> {
    let extension = file.rsplit('.').next()?.to_ascii_lowercase();
    IMAGE_TYPES
        .iter()
        .find(|(known, _)| *known == extension)
        .map(|(_, mime)| *mime)
}

fn is_image(file: &str) -> bool {
    image_type(file).is_some()
}

fn data_url(file: &str, bytes: &[u8]) -> String {
    let mime = image_type(file).unwrap_or("application/octet-stream");
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// A new file's content as a diff that adds every line (or says it's binary).
fn new_file_diff(file: &Path) -> String {
    let Ok(bytes) = std::fs::read(file) else {
        return String::new();
    };
    if bytes.len() > MAX_DIFF_BYTES || bytes[..bytes.len().min(8000)].contains(&0) {
        return if bytes.len() > MAX_DIFF_BYTES {
            "x".repeat(MAX_DIFF_BYTES + 1)
        } else {
            "Binary files /dev/null and b/file differ\n".to_owned()
        };
    }
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    let mut diff = format!("@@ -0,0 +1,{} @@\n", lines.len());
    for line in lines {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    diff
}

/// Read git's unified diff into hunks and line counts.
fn parse_into(output: &str, diff: &mut FileDiff) {
    let (mut old, mut new) = (0u32, 0u32);
    for line in output.lines() {
        if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            diff.binary = true;
            continue;
        }
        if let Some(header) = line.strip_prefix("@@ ") {
            let Some((ranges, section)) = header.split_once(" @@") else {
                continue;
            };
            let mut parts = ranges.split(' ');
            old = start_of(parts.next().unwrap_or_default());
            new = start_of(parts.next().unwrap_or_default());
            diff.hunks.push(Hunk {
                section: section.trim().to_owned(),
                lines: Vec::new(),
            });
            continue;
        }
        let Some(hunk) = diff.hunks.last_mut() else {
            continue;
        };
        let (kind, text) = match line.as_bytes().first() {
            Some(b'+') => (LineKind::Added, &line[1..]),
            Some(b'-') => (LineKind::Removed, &line[1..]),
            Some(b' ') => (LineKind::Context, &line[1..]),
            // "\ No newline at end of file", or the next file's header.
            _ => continue,
        };
        let numbers = match kind {
            LineKind::Added => (None, Some(next(&mut new))),
            LineKind::Removed => (Some(next(&mut old)), None),
            LineKind::Context => (Some(next(&mut old)), Some(next(&mut new))),
        };
        match kind {
            LineKind::Added => diff.additions += 1,
            LineKind::Removed => diff.deletions += 1,
            LineKind::Context => {}
        }
        hunk.lines.push(DiffLine {
            kind,
            old: numbers.0,
            new: numbers.1,
            text: text.to_owned(),
        });
    }
}

/// "-12,7" → 12.
fn start_of(range: &str) -> u32 {
    range
        .trim_start_matches(['-', '+'])
        .split(',')
        .next()
        .and_then(|start| start.parse().ok())
        .unwrap_or(0)
}

fn next(counter: &mut u32) -> u32 {
    // A range starting at 0 is empty; its first line is line 1.
    *counter = (*counter).max(1);
    let line = *counter;
    *counter += 1;
    line
}

/// Open a file's change in the user's diff tool (`git difftool`, as set up in git).
pub(super) fn open_in_diff_tool(
    repo: &gix::Repository,
    git: &Git,
    source: DiffSource,
    file: String,
) -> Result<String> {
    let paths = check_file_paths(std::slice::from_ref(&file))?;
    let mut args: Vec<String> = vec!["difftool".into(), "--no-prompt".into()];
    match source {
        DiffSource::Commit { id } => {
            let id = commit_id(repo, &id)?.to_string();
            args.extend([first_parent(repo, &id), id]);
        }
        DiffSource::Staged => args.push("--cached".into()),
        DiffSource::Unstaged => {
            // git has nothing to compare a new file with, and would quietly do nothing.
            let tracked = git.run_with_env(&["ls-files", "--error-unmatch", "--", &file], &LITERAL);
            if tracked.is_err() {
                return Err(Error::Message(format!(
                    "{} is new: there's no earlier version to compare it with",
                    super::support::file_name(&file)
                )));
            }
        }
    }
    args.push("--".into());
    args.extend(paths.iter().map(|path| (*path).to_owned()));
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    git.spawn(&args, TOOL_SETTLE)
        .map_err(|error| tool_error(error, "diff"))?;
    Ok(format!(
        "Opened {} in your diff tool",
        super::support::file_name(&file)
    ))
}

/// Resolve a conflicted file in the user's merge tool (`git mergetool`). Once the tool
/// saves and closes, git marks the file resolved.
pub(super) fn open_in_merge_tool(git: &Git, file: String) -> Result<String> {
    let paths = check_file_paths(std::slice::from_ref(&file))?;
    let mut args = vec!["mergetool", "--no-prompt", "--"];
    args.extend(paths.iter().copied());
    git.spawn(&args, TOOL_SETTLE)
        .map_err(|error| tool_error(error, "merge"))?;
    Ok(format!(
        "Opened {} in your merge tool",
        super::support::file_name(&file)
    ))
}

/// git's complaint about a missing tool, with what to do about it.
fn tool_error(error: Error, kind: &str) -> Error {
    let message = error.to_string();
    if message.contains("No known")
        || message.contains("is not a valid")
        || message.contains("not configured")
    {
        Error::Message(format!(
            "Git has no {kind} tool set up. Choose one with git config --global {kind}.tool <name> \
             (like vscode, meld, kdiff3, p4merge or bc), then try again.\n\n{message}"
        ))
    } else {
        error
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_hunks_and_line_numbers() {
        let output = "diff --git a/a.txt b/a.txt\nindex 1..2 100644\n--- a/a.txt\n+++ b/a.txt\n\
                      @@ -1,3 +1,3 @@ fn main\n one\n-two\n+TWO\n three\n\\ No newline at end of file\n";
        let mut diff = FileDiff::default();
        parse_into(output, &mut diff);
        assert_eq!((diff.additions, diff.deletions), (1, 1));
        assert_eq!(diff.hunks.len(), 1);
        assert_eq!(diff.hunks[0].section, "fn main");
        let numbers: Vec<_> = diff.hunks[0]
            .lines
            .iter()
            .map(|line| (line.old, line.new))
            .collect();
        assert_eq!(
            numbers,
            vec![
                (Some(1), Some(1)),
                (Some(2), None),
                (None, Some(2)),
                (Some(3), Some(3))
            ]
        );
    }

    #[test]
    fn notices_binary_files_and_lfs_pointers() {
        let mut diff = FileDiff::default();
        parse_into("Binary files a/x.png and b/x.png differ\n", &mut diff);
        assert!(diff.binary);
        let pointer = b"version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12345\n";
        assert!(is_lfs_pointer(pointer));
        assert_eq!(pointer_size(pointer), Some(12345));
        assert!(is_image("Textures/Hero.PNG"));
        assert!(!is_image("notes.txt"));
    }
}
