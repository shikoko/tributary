//! What the team changed lately, file by file: which kinds of file (code, art, levels,
//! audio), the files changed most and by whom (hotspots), and lines of code added and
//! removed. One `git log --numstat` over the period's commits on every branch.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::Serialize;

use super::elsewhere::unmergeable_files;
use crate::error::{Error, Result};
use crate::git::Git;

/// How many hotspots are listed.
const MOST_HOTSPOTS: usize = 10;
/// At most this many commits are listed (for the lines-of-code graph).
const MOST_COMMITS: usize = 5000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    Code,
    /// Pictures, textures, models, materials and engine assets.
    Art,
    Levels,
    Audio,
    Other,
}

const KINDS: [FileKind; 5] = [
    FileKind::Code,
    FileKind::Art,
    FileKind::Levels,
    FileKind::Audio,
    FileKind::Other,
];

/// What kind of file `path` is, by its extension.
pub fn file_kind(path: &str) -> FileKind {
    let name = path.rsplit('/').next().unwrap_or(path);
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "c" | "cc" | "cpp" | "cxx" | "h" | "hh" | "hpp" | "hxx" | "inl" | "cs" | "java" | "kt"
        | "swift" | "m" | "mm" | "rs" | "go" | "py" | "rb" | "js" | "jsx" | "ts" | "tsx"
        | "lua" | "gd" | "gdshader" | "shader" | "hlsl" | "glsl" | "usf" | "ush" | "compute"
        | "cginc" | "php" | "sh" | "ps1" | "bat" | "cmake" | "vue" | "svelte" | "css" | "scss"
        | "html" | "sql" | "zig" | "dart" | "fs" | "vb" | "verse" => FileKind::Code,
        "png" | "jpg" | "jpeg" | "tga" | "psd" | "dds" | "exr" | "tif" | "tiff" | "hdr" | "bmp"
        | "gif" | "webp" | "svg" | "kra" | "blend" | "fbx" | "obj" | "gltf" | "glb" | "ma"
        | "mb" | "max" | "spp" | "sbs" | "sbsar" | "ztl" | "abc" | "uasset" | "mat" | "prefab"
        | "asset" | "anim" | "controller" | "physicmaterial" | "tres" | "res" => FileKind::Art,
        "umap" | "unity" | "tscn" | "scn" | "tmx" | "ldtk" | "level" | "map" => FileKind::Levels,
        "wav" | "ogg" | "mp3" | "flac" | "aif" | "aiff" | "bank" | "bnk" | "wem" | "fsb" => {
            FileKind::Audio
        }
        _ => FileKind::Other,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindCount {
    pub kind: FileKind,
    /// File changes (a file changed in three commits counts three times).
    pub files: u64,
    /// The share of the commits' work: each commit counts as one, split between the kinds of
    /// file it changed (so importing 2,000 generated files is one commit's work, not 2,000).
    pub work: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonWork {
    pub email: String,
    pub kinds: Vec<KindCount>,
    /// Lines of code added and removed.
    pub added: u64,
    pub removed: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkCommit {
    pub time: i64,
    /// Lines of code it added and removed, and the files it changed.
    pub added: u64,
    pub removed: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hotspot {
    pub path: String,
    pub kind: FileKind,
    /// How many commits changed it, and who made them (emails), the most first.
    pub changes: u64,
    pub people: Vec<String>,
    /// It can't be merged line by line (Git LFS, lockable or binary): one version wins.
    pub unmergeable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamWork {
    pub kinds: Vec<KindCount>,
    pub people: Vec<PersonWork>,
    pub commits: Vec<WorkCommit>,
    pub hotspots: Vec<Hotspot>,
}

/// File changes and work by kind of file.
type Kinds = HashMap<FileKind, (u64, f64)>;

fn counted(kinds: &Kinds) -> Vec<KindCount> {
    KINDS
        .iter()
        .filter_map(|kind| {
            kinds.get(kind).map(|(files, work)| KindCount {
                kind: *kind,
                files: *files,
                work: *work,
            })
        })
        .collect()
}

/// Adds one commit's file changes by kind: each file once, and the commit's one unit of
/// work split between its kinds in proportion.
fn add_commit(total: &mut Kinds, commit: &HashMap<FileKind, u64>) {
    let files: u64 = commit.values().sum();
    if files == 0 {
        return;
    }
    for (kind, count) in commit {
        let entry = total.entry(*kind).or_default();
        entry.0 += count;
        entry.1 += *count as f64 / files as f64;
    }
}

/// A path as `--numstat` prints it: quoted when it has unusual characters.
fn unquote(path: &str) -> String {
    match path
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
    {
        Some(inner) => inner.replace("\\\"", "\"").replace("\\\\", "\\"),
        None => path.to_owned(),
    }
}

/// What the team changed in the last `days` days, on every branch (merges left out).
pub fn team_work(path: &Path, days: u32) -> Result<TeamWork, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .map(Path::to_owned)
        .unwrap_or_else(|| repo.git_dir().to_owned());
    let git = Git::find(workdir)?.in_background();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let since = now - i64::from(days.clamp(1, 365)) * 24 * 3600;
    let log = git.run(&[
        "-c",
        "core.quotePath=false",
        "log",
        "--branches",
        "--remotes",
        "--no-merges",
        "--no-renames",
        &format!("--since=@{since}"),
        "--format=%x1e%ae%x1f%ct",
        "--numstat",
    ])?;
    Ok(summarize(&git, &log))
}

fn summarize(git: &Git, log: &str) -> TeamWork {
    let mut kinds: Kinds = HashMap::new();
    let mut people: HashMap<String, (Kinds, u64, u64)> = HashMap::new();
    let mut files: HashMap<String, (u64, HashMap<String, u64>)> = HashMap::new();
    let mut commits = Vec::new();
    for record in log
        .split('\u{1e}')
        .filter(|record| !record.trim().is_empty())
    {
        let mut lines = record.lines();
        let Some((email, time)) = lines.next().and_then(|line| line.split_once('\u{1f}')) else {
            continue;
        };
        let email = email.to_lowercase();
        let mut commit = WorkCommit {
            time: time.trim().parse().unwrap_or(0),
            added: 0,
            removed: 0,
            files: 0,
        };
        let person = people.entry(email.clone()).or_default();
        let mut by_kind: HashMap<FileKind, u64> = HashMap::new();
        for line in lines {
            let mut parts = line.splitn(3, '\t');
            let (Some(added), Some(removed), Some(path)) =
                (parts.next(), parts.next(), parts.next())
            else {
                continue;
            };
            let path = unquote(path);
            let kind = file_kind(&path);
            commit.files += 1;
            *by_kind.entry(kind).or_default() += 1;
            // Lines count for code only ("-" for binary files).
            if kind == FileKind::Code
                && let (Ok(added), Ok(removed)) = (added.parse::<u64>(), removed.parse::<u64>())
            {
                commit.added += added;
                commit.removed += removed;
                person.1 += added;
                person.2 += removed;
            }
            let file = files.entry(path).or_default();
            file.0 += 1;
            *file.1.entry(email.clone()).or_default() += 1;
        }
        add_commit(&mut kinds, &by_kind);
        add_commit(&mut person.0, &by_kind);
        if commits.len() < MOST_COMMITS {
            commits.push(commit);
        }
    }

    let mut hot: Vec<(String, u64, HashMap<String, u64>)> = files
        .into_iter()
        .map(|(path, (changes, by))| (path, changes, by))
        .collect();
    // The most changed first; among equals, those more people changed.
    hot.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then_with(|| b.2.len().cmp(&a.2.len()))
            .then_with(|| a.0.cmp(&b.0))
    });
    hot.truncate(MOST_HOTSPOTS);
    let paths: Vec<&str> = hot.iter().map(|(path, _, _)| path.as_str()).collect();
    let unmergeable: HashSet<String> = unmergeable_files(git, &paths);
    let hotspots = hot
        .iter()
        .map(|(path, changes, by)| {
            let mut people: Vec<(&String, &u64)> = by.iter().collect();
            people.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
            Hotspot {
                path: path.clone(),
                kind: file_kind(path),
                changes: *changes,
                people: people.into_iter().map(|(email, _)| email.clone()).collect(),
                unmergeable: unmergeable.contains(path),
            }
        })
        .collect();

    let mut people: Vec<PersonWork> = people
        .into_iter()
        .map(|(email, (kinds, added, removed))| PersonWork {
            email,
            kinds: counted(&kinds),
            added,
            removed,
        })
        .collect();
    people.sort_by(|a, b| a.email.cmp(&b.email));
    TeamWork {
        kinds: counted(&kinds),
        people,
        commits,
        hotspots,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_files_into_kinds() {
        assert_eq!(file_kind("Source/Door.cpp"), FileKind::Code);
        assert_eq!(file_kind("Art/Hero.PSD"), FileKind::Art);
        assert_eq!(file_kind("Content/Props/Chair.uasset"), FileKind::Art);
        assert_eq!(file_kind("Content/Maps/Tavern.umap"), FileKind::Levels);
        assert_eq!(file_kind("Audio/Creak.wav"), FileKind::Audio);
        assert_eq!(file_kind("README.md"), FileKind::Other);
        assert_eq!(file_kind("Makefile"), FileKind::Other);
        assert_eq!(unquote("\"Art/Caf\\\\\u{e9}.png\""), "Art/Caf\\\u{e9}.png");
    }

    #[test]
    fn counts_each_commit_as_one_piece_of_work() {
        let mut total = Kinds::new();
        // A commit importing 2,000 generated files, and one changing a script and a texture.
        add_commit(&mut total, &HashMap::from([(FileKind::Other, 2000)]));
        add_commit(
            &mut total,
            &HashMap::from([(FileKind::Code, 1), (FileKind::Art, 1)]),
        );
        let kinds = counted(&total);
        let work: Vec<(FileKind, u64, f64)> =
            kinds.iter().map(|k| (k.kind, k.files, k.work)).collect();
        assert_eq!(
            work,
            vec![
                (FileKind::Code, 1, 0.5),
                (FileKind::Art, 1, 0.5),
                (FileKind::Other, 2000, 1.0)
            ]
        );
    }
}
