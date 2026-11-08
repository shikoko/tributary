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
/// Text read in full (Git LFS files) up to this size to compare line by line.
const MAX_TEXT_BYTES: u64 = MAX_DIFF_BYTES as u64;
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

/// What kind of file a picture, sound, video or 3D model is, to show it as one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Image,
    Audio,
    Video,
    Model,
}

/// A picture, sound, video or 3D model before and after, as `data:` URLs: None where the
/// file doesn't exist, or (with its size known) is too big to show here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub kind: MediaKind,
    /// Its extension, like "glb" (3D models are read by it).
    pub format: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

/// The kinds of files shown as what they are, with their types and how big they can be.
const MEDIA_TYPES: [(&str, MediaKind, &str); 25] = [
    ("png", MediaKind::Image, "image/png"),
    ("jpg", MediaKind::Image, "image/jpeg"),
    ("jpeg", MediaKind::Image, "image/jpeg"),
    ("gif", MediaKind::Image, "image/gif"),
    ("webp", MediaKind::Image, "image/webp"),
    ("bmp", MediaKind::Image, "image/bmp"),
    ("ico", MediaKind::Image, "image/x-icon"),
    ("wav", MediaKind::Audio, "audio/wav"),
    ("mp3", MediaKind::Audio, "audio/mpeg"),
    ("ogg", MediaKind::Audio, "audio/ogg"),
    ("oga", MediaKind::Audio, "audio/ogg"),
    ("opus", MediaKind::Audio, "audio/ogg"),
    ("flac", MediaKind::Audio, "audio/flac"),
    ("m4a", MediaKind::Audio, "audio/mp4"),
    ("aac", MediaKind::Audio, "audio/aac"),
    ("mp4", MediaKind::Video, "video/mp4"),
    ("m4v", MediaKind::Video, "video/mp4"),
    ("webm", MediaKind::Video, "video/webm"),
    ("mov", MediaKind::Video, "video/quicktime"),
    ("glb", MediaKind::Model, "model/gltf-binary"),
    ("gltf", MediaKind::Model, "model/gltf+json"),
    ("obj", MediaKind::Model, "model/obj"),
    ("fbx", MediaKind::Model, "application/octet-stream"),
    ("stl", MediaKind::Model, "model/stl"),
    ("ply", MediaKind::Model, "application/octet-stream"),
];

/// Files bigger than this aren't shown here (they'd have to go to the window whole).
fn media_limit(kind: MediaKind) -> u64 {
    const MB: u64 = 1024 * 1024;
    match kind {
        MediaKind::Image => 20 * MB,
        MediaKind::Audio => 50 * MB,
        MediaKind::Video => 80 * MB,
        MediaKind::Model => 40 * MB,
    }
}

/// The file's kind and type, if it's one shown as what it is.
fn media_type(file: &str) -> Option<(MediaKind, &'static str)> {
    let extension = file.rsplit_once('.')?.1.to_ascii_lowercase();
    MEDIA_TYPES
        .iter()
        .find(|(known, _, _)| *known == extension)
        .map(|(_, kind, mime)| (*kind, *mime))
}

/// A submodule moved from one commit to another.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleChange {
    pub before: Option<String>,
    pub after: Option<String>,
    /// Its own files have uncommitted changes.
    pub dirty: bool,
    /// The commits it moved forward by, newest first (or back by, when `rewound`), as far
    /// as its checked-out copy knows them.
    pub commits: Vec<SubmoduleCommit>,
    pub rewound: bool,
    /// There are more commits than listed.
    pub more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleCommit {
    pub id: String,
    pub summary: String,
}

/// Submodule changes list at most this many commits.
const MAX_SUBMODULE_COMMITS: usize = 50;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    /// Not text: shown by its sizes (or as media), not line by line.
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
    /// For pictures, sounds, videos and 3D models: both versions, to show as what they are.
    pub media: Option<Media>,
    /// It's a submodule: which commits it moved by.
    pub submodule: Option<SubmoduleChange>,
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
    if let Some(change) = submodule_change(&diff) {
        diff.submodule = Some(with_commits(&git, file, change));
        diff.hunks.clear();
        diff.additions = 0;
        diff.deletions = 0;
        return Ok(diff);
    }
    let media = media_type(file);
    // Git LFS files diff as their small pointer files: compare the real files instead,
    // line by line when they're text, by their sizes (or as media) otherwise.
    if diff.lfs {
        diff.binary = true;
        diff.hunks.clear();
        diff.additions = 0;
        diff.deletions = 0;
        // Pictures, sounds and videos aren't text; 3D models can be (OBJ, glTF).
        let binary_media = media.is_some_and(|(kind, _)| kind != MediaKind::Model);
        if !binary_media {
            let before = read_side(&git, &plan.before, file, true, Some(MAX_TEXT_BYTES));
            let after = read_side(&git, &plan.after, file, true, Some(MAX_TEXT_BYTES));
            if let Some(output) = text_diff(&git, file, &before, &after, ignore_whitespace) {
                diff.binary = false;
                if output.len() > MAX_DIFF_BYTES {
                    diff.too_large = true;
                } else {
                    parse_into(&output, &mut diff);
                }
                if diff.binary || diff.too_large {
                    diff.hunks.clear();
                }
            }
            diff.size_before = before.size;
            diff.size_after = after.size;
        }
    }
    // Shown as what they are: pictures, sounds and videos (never text), and 3D models
    // (also when they're text, which then shows line by line too).
    if let Some((kind, mime)) = media
        && (diff.binary || diff.lfs || kind == MediaKind::Model)
    {
        let limit = Some(media_limit(kind));
        let before = read_side(&git, &plan.before, file, diff.lfs, limit);
        let after = read_side(&git, &plan.after, file, diff.lfs, limit);
        diff.size_before = before.size;
        diff.size_after = after.size;
        let url = |bytes: Vec<u8>| data_url(mime, &bytes);
        diff.media = Some(Media {
            kind,
            format: file
                .rsplit_once('.')
                .map(|(_, ext)| ext.to_ascii_lowercase())
                .unwrap_or_default(),
            before: before.data.map(url),
            after: after.data.map(url),
        });
    } else if diff.binary || diff.too_large {
        let before = read_side(&git, &plan.before, file, diff.lfs, None);
        let after = read_side(&git, &plan.after, file, diff.lfs, None);
        diff.size_before = before.size;
        diff.size_after = after.size;
    }
    Ok(diff)
}

/// A submodule's diff is a "Subproject commit <id>" line for each side.
fn submodule_change(diff: &FileDiff) -> Option<SubmoduleChange> {
    let lines: Vec<&DiffLine> = diff.hunks.iter().flat_map(|hunk| &hunk.lines).collect();
    if lines.is_empty() {
        return None;
    }
    let mut change = SubmoduleChange::default();
    for line in lines {
        let id = line.text.strip_prefix("Subproject commit ")?;
        let (id, dirty) = match id.strip_suffix("-dirty") {
            Some(id) => (id, true),
            None => (id, false),
        };
        match line.kind {
            LineKind::Removed => change.before = Some(id.to_owned()),
            LineKind::Added => {
                change.after = Some(id.to_owned());
                change.dirty |= dirty;
            }
            LineKind::Context => return None,
        }
    }
    Some(change)
}

/// The commits between a submodule's two commits, from its checked-out copy.
fn with_commits(git: &Git, file: &str, mut change: SubmoduleChange) -> SubmoduleChange {
    let (Some(before), Some(after)) = (change.before.clone(), change.after.clone()) else {
        return change;
    };
    let folder = git.workdir().join(file);
    if before == after || !folder.join(".git").exists() {
        return change;
    }
    let Ok(inside) = Git::find(folder).map(|git| git.in_background()) else {
        return change;
    };
    let limit = (MAX_SUBMODULE_COMMITS + 1).to_string();
    let log = |range: String| -> Vec<SubmoduleCommit> {
        inside
            .run(&["log", "--format=%H%x00%s", "-n", &limit, &range, "--"])
            .unwrap_or_default()
            .lines()
            .filter_map(|line| {
                let (id, summary) = line.split_once('\0')?;
                Some(SubmoduleCommit {
                    id: id.to_owned(),
                    summary: summary.to_owned(),
                })
            })
            .collect()
    };
    let mut commits = log(format!("{before}..{after}"));
    if commits.is_empty() {
        commits = log(format!("{after}..{before}"));
        change.rewound = !commits.is_empty();
    }
    change.more = commits.len() > MAX_SUBMODULE_COMMITS;
    commits.truncate(MAX_SUBMODULE_COMMITS);
    change.commits = commits;
    change
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

/// One side's size, and its bytes when they're wanted and no bigger than `limit` (for a
/// Git LFS file, the real file rather than its pointer, when it's on this computer).
fn read_side(git: &Git, side: &Side, file: &str, lfs: bool, limit: Option<u64>) -> Read {
    let fits = |size: u64| limit.is_some_and(|limit| size <= limit);
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
            // A pointer file is tiny: read it to tell.
            let wanted = fits(metadata.len()) || (lfs && metadata.len() < 1024);
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
        let data = size
            .is_some_and(fits)
            .then(|| {
                git.run_bytes(&["lfs", "smudge", "--", file], Some(&bytes))
                    .ok()
            })
            .flatten()
            .filter(|real| !is_lfs_pointer(real));
        return Read { size, data };
    }
    let size = Some(bytes.len() as u64);
    let data = fits(bytes.len() as u64).then_some(bytes);
    Read { size, data }
}

/// The diff of two versions of a file that are text (Git LFS files, read in full), from
/// `git diff --no-index` on copies of them. None when either isn't text, or wasn't read.
fn text_diff(
    git: &Git,
    file: &str,
    before: &Read,
    after: &Read,
    ignore_whitespace: bool,
) -> Option<String> {
    let side = |read: &Read| -> Option<Vec<u8>> {
        match (&read.size, &read.data) {
            // Missing on this side (added or deleted): compare with nothing.
            (None, _) => Some(Vec::new()),
            (Some(_), Some(bytes)) if is_text(bytes) => Some(bytes.clone()),
            _ => None,
        }
    };
    let (old, new) = (side(before)?, side(after)?);
    // Copies with the file's own name, so git's diff drivers and section names still apply.
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let folder = std::env::temp_dir().join(format!(
        "tributary-diff-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let name = super::support::file_name(file);
    let (a, b) = (folder.join("a").join(name), folder.join("b").join(name));
    let written = std::fs::create_dir_all(folder.join("a"))
        .and_then(|_| std::fs::create_dir_all(folder.join("b")))
        .and_then(|_| std::fs::write(&a, &old))
        .and_then(|_| std::fs::write(&b, &new));
    let output = written.ok().and_then(|_| {
        let mut command = crate::git::command(git.executable());
        command
            .current_dir(&folder)
            .args(["diff", "--no-index", "--no-color", "--no-ext-diff"]);
        if ignore_whitespace {
            command.arg("-w");
        }
        command
            .args(["--", "a", "b"])
            .env("GIT_TERMINAL_PROMPT", "0");
        let output = command.output().ok()?;
        // Exit code 1 means "they differ".
        matches!(output.status.code(), Some(0 | 1))
            .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    });
    let _ = std::fs::remove_dir_all(&folder);
    output
}

/// Text, as far as git would tell: no NUL bytes near the start, and not too long to show.
fn is_text(bytes: &[u8]) -> bool {
    bytes.len() <= MAX_DIFF_BYTES && !bytes[..bytes.len().min(8000)].contains(&0)
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

fn data_url(mime: &str, bytes: &[u8]) -> String {
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
            "Git has no {kind} tool set up. Choose one in Settings, under Diff and merge \
             (or with git config --global {kind}.tool <name>), then try again.\n\n{message}"
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
        assert_eq!(
            media_type("Textures/Hero.PNG"),
            Some((MediaKind::Image, "image/png"))
        );
        assert_eq!(
            media_type("Audio/Theme.wav").map(|(kind, _)| kind),
            Some(MediaKind::Audio)
        );
        assert_eq!(
            media_type("Meshes/Chair.glb").map(|(kind, _)| kind),
            Some(MediaKind::Model)
        );
        assert_eq!(media_type("notes.txt"), None);
        assert_eq!(media_type("Makefile"), None);
    }
}
