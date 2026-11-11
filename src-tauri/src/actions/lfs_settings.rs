//! A repository's Git LFS settings: which files it stores with Git LFS (its `.gitattributes`
//! patterns), which kinds of big files it has that it could, and which folders' files are
//! downloaded (`lfs.fetchinclude` and `lfs.fetchexclude`).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::git::Git;

/// Files at least this big are suggested for Git LFS.
const BIG_FILE: u64 = 1024 * 1024;
/// At most this many kinds of files are suggested.
const MAX_SUGGESTIONS: usize = 8;
/// At most this many folders are offered for choosing what to download.
const MAX_FOLDERS: usize = 12;

/// Which files a repository stores with Git LFS, and which big ones it could.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LfsSettings {
    /// Git LFS is installed on this computer.
    pub installed: bool,
    /// The patterns stored with Git LFS, as `.gitattributes` lists them (like `*.psd`).
    pub patterns: Vec<String>,
    /// Kinds of big files here that aren't stored with it, biggest first.
    pub suggestions: Vec<LfsSuggestion>,
    /// Download only the Git LFS files in these folders (or matching these patterns)…
    pub fetch_include: Vec<String>,
    /// …and not those in these.
    pub fetch_exclude: Vec<String>,
    /// The folders with files stored with Git LFS, biggest first.
    pub folders: Vec<LfsFolder>,
}

/// A folder with files stored with Git LFS, to choose whether to download them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LfsFolder {
    /// Like `Content/Characters`.
    pub path: String,
    pub files: usize,
    /// Their sizes, together (the latest versions').
    pub bytes: u64,
    /// How many of them are downloaded here.
    pub downloaded: usize,
}

/// One file stored with Git LFS, as `git lfs ls-files --json` lists it.
#[derive(Debug, Deserialize)]
struct LfsFile {
    name: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    downloaded: bool,
}

#[derive(Debug, Deserialize)]
struct LfsFiles {
    #[serde(default)]
    files: Vec<LfsFile>,
}

/// Which Git LFS files git-lfs downloads: those `include` matches (all when it's empty)
/// that `exclude` doesn't.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct FetchFilter {
    pub include: Vec<String>,
    pub exclude: Vec<String>,
}

impl FetchFilter {
    /// As git-lfs reads it, from git's config.
    pub(super) fn read(git: &Git) -> Self {
        let list = |key: &str| {
            git.run(&["config", "--get", key])
                .map(|value| split_list(&value))
                .unwrap_or_default()
        };
        FetchFilter {
            include: list("lfs.fetchinclude"),
            exclude: list("lfs.fetchexclude"),
        }
    }

    /// Whether the file at `path` is downloaded.
    pub(super) fn allows(&self, path: &str) -> bool {
        (self.include.is_empty() || self.include.iter().any(|p| path_matches(p, path)))
            && !self.exclude.iter().any(|p| path_matches(p, path))
    }
}

/// "Content/Art, *.psd" → ["Content/Art", "*.psd"].
fn split_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Whether `pattern` (a folder, a file, or a pattern with `*` like `*.psd` or `Content/*`)
/// matches `path`, the way git-lfs's fetch filters do: a folder matches everything in it,
/// and a pattern without a slash matches a name in any folder.
pub(super) fn path_matches(pattern: &str, path: &str) -> bool {
    let pattern = pattern
        .trim()
        .trim_start_matches("./")
        .trim_start_matches('/');
    let pattern = pattern.trim_end_matches('/');
    if pattern.is_empty() {
        return false;
    }
    if !pattern.contains(['*', '?', '[']) {
        return path == pattern || path.starts_with(&format!("{pattern}/"));
    }
    // A pattern matches the path, or any folder it's in (and so everything in that folder).
    let parts: Vec<&str> = path.split('/').collect();
    let candidates = (1..=parts.len()).map(|n| parts[..n].join("/"));
    if pattern.contains('/') {
        candidates
            .into_iter()
            .any(|candidate| glob(pattern, &candidate))
    } else {
        parts.iter().any(|part| glob(pattern, part))
    }
}

/// `*` (anything but `/`), `**` (anything) and `?` (one character).
fn glob(pattern: &str, text: &str) -> bool {
    fn matches(pattern: &[char], text: &[char]) -> bool {
        match pattern.first() {
            None => text.is_empty(),
            Some('*') if pattern.get(1) == Some(&'*') => {
                let rest = &pattern[2..];
                let rest = rest.strip_prefix(&['/']).unwrap_or(rest);
                (0..=text.len()).any(|i| matches(rest, &text[i..]))
            }
            Some('*') => (0..=text.len())
                .take_while(|&i| i == 0 || text[i - 1] != '/')
                .any(|i| matches(&pattern[1..], &text[i..])),
            Some('?') => !text.is_empty() && text[0] != '/' && matches(&pattern[1..], &text[1..]),
            Some(c) => text.first() == Some(c) && matches(&pattern[1..], &text[1..]),
        }
    }
    let pattern: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    matches(&pattern, &text)
}

/// The files stored with Git LFS at the checked-out commit.
fn lfs_files(git: &Git) -> Vec<LfsFile> {
    if let Ok(listing) = git.run(&["lfs", "ls-files", "--json"])
        && let Ok(parsed) = serde_json::from_str::<LfsFiles>(&listing)
    {
        return parsed.files;
    }
    // Older Git LFS: names only.
    git.run(&["lfs", "ls-files", "--name-only"])
        .map(|listing| {
            listing
                .lines()
                .filter(|line| !line.is_empty())
                .map(|name| LfsFile {
                    name: name.to_owned(),
                    size: 0,
                    downloaded: false,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The folders the Git LFS files are in, biggest first: the top-level ones, or (when
/// they're all in one, like `Content`) the ones inside it.
fn folders(files: &[LfsFile]) -> Vec<LfsFolder> {
    let group = |depth: usize| {
        let mut found: BTreeMap<String, LfsFolder> = BTreeMap::new();
        for file in files {
            let parts: Vec<&str> = file.name.split('/').collect();
            if parts.len() <= depth {
                continue;
            }
            let path = parts[..depth].join("/");
            let folder = found.entry(path.clone()).or_insert(LfsFolder {
                path,
                files: 0,
                bytes: 0,
                downloaded: 0,
            });
            folder.files += 1;
            folder.bytes += file.size;
            folder.downloaded += usize::from(file.downloaded);
        }
        found.into_values().collect::<Vec<_>>()
    };
    let mut found = group(1);
    for depth in 2..=3 {
        if found.len() != 1 {
            break;
        }
        let deeper = group(depth);
        if deeper.len() <= 1 {
            break;
        }
        found = deeper;
    }
    found.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.path.cmp(&b.path)));
    found.truncate(MAX_FOLDERS);
    found
}

/// Download only the Git LFS files `include` matches (all, when it's empty) and not those
/// `exclude` does: this repository's `lfs.fetchinclude` and `lfs.fetchexclude`.
pub(super) fn set_lfs_fetch_folders(
    git: &Git,
    include: Vec<String>,
    exclude: Vec<String>,
) -> Result<String> {
    let clean = |list: Vec<String>| -> Result<Vec<String>> {
        let list: Vec<String> = list
            .iter()
            .map(|item| item.trim().to_owned())
            .filter(|item| !item.is_empty())
            .collect();
        if list
            .iter()
            .any(|item| item.starts_with('-') || item.contains([',', '\n', '\r']))
        {
            return Err("Folder names can't start with a dash or contain commas.".into());
        }
        Ok(list)
    };
    let (include, exclude) = (clean(include)?, clean(exclude)?);
    for (key, list) in [
        ("lfs.fetchinclude", &include),
        ("lfs.fetchexclude", &exclude),
    ] {
        if list.is_empty() {
            // Exit code 5: it wasn't set, which is fine.
            if let Err(error) = git.run(&["config", "--local", "--unset", key])
                && git.run(&["config", "--local", "--get", key]).is_ok()
            {
                return Err(error);
            }
        } else {
            git.run(&["config", "--local", key, &list.join(",")])?;
        }
    }
    Ok(match (include.is_empty(), exclude.is_empty()) {
        (true, true) => "Git LFS files are downloaded from every folder again".to_owned(),
        (false, true) => format!(
            "Git LFS files are downloaded only from {}",
            include.join(", ")
        ),
        (true, false) => format!(
            "Git LFS files aren't downloaded from {}",
            exclude.join(", ")
        ),
        (false, false) => format!(
            "Git LFS files are downloaded only from {}, except {}",
            include.join(", "),
            exclude.join(", ")
        ),
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LfsSuggestion {
    /// Like `*.psd`.
    pub pattern: String,
    /// How many files of that kind are big, and how big they are together.
    pub files: usize,
    pub bytes: u64,
}

/// The repository's Git LFS settings.
pub fn lfs_settings(path: &Path) -> Result<LfsSettings, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree.")?
        .to_owned();
    let git = Git::find(workdir.clone())?.in_background();
    let installed = git.run(&["lfs", "version"]).is_ok();
    let patterns = std::fs::read_to_string(workdir.join(".gitattributes"))
        .map(|text| lfs_patterns(&text))
        .unwrap_or_default();
    let filter = FetchFilter::read(&git);
    let folders = if installed && !patterns.is_empty() {
        folders(&lfs_files(&git))
    } else {
        Vec::new()
    };
    Ok(LfsSettings {
        installed,
        suggestions: suggestions(&git, &workdir, &patterns),
        patterns,
        fetch_include: filter.include,
        fetch_exclude: filter.exclude,
        folders,
    })
}

/// The patterns a `.gitattributes` file stores with Git LFS (`filter=lfs`).
fn lfs_patterns(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(pattern) = parts.next() else {
            continue;
        };
        if parts.any(|attribute| attribute == "filter=lfs") && !found.iter().any(|p| p == pattern) {
            found.push(pattern.to_owned());
        }
    }
    found
}

/// The kinds of big files (by extension) among the files here, tracked or new, that no
/// Git LFS pattern covers yet.
fn suggestions(git: &Git, workdir: &Path, patterns: &[String]) -> Vec<LfsSuggestion> {
    let covered: HashSet<String> = patterns
        .iter()
        .map(|pattern| pattern.to_lowercase())
        .collect();
    let Ok(listing) = git.run(&[
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
    ]) else {
        return Vec::new();
    };
    let mut by_kind: HashMap<String, (usize, u64)> = HashMap::new();
    for file in listing.split('\0').filter(|file| !file.is_empty()) {
        let name = file.rsplit('/').next().unwrap_or(file);
        let Some((stem, extension)) = name.rsplit_once('.') else {
            continue;
        };
        if stem.is_empty() || extension.is_empty() || extension.len() > 12 {
            continue;
        }
        let pattern = format!("*.{}", extension.to_lowercase());
        if covered.contains(&pattern) {
            continue;
        }
        let Ok(size) = std::fs::metadata(workdir.join(file)).map(|meta| meta.len()) else {
            continue;
        };
        if size >= BIG_FILE {
            let entry = by_kind.entry(pattern).or_default();
            entry.0 += 1;
            entry.1 += size;
        }
    }
    let mut found: Vec<LfsSuggestion> = by_kind
        .into_iter()
        .map(|(pattern, (files, bytes))| LfsSuggestion {
            pattern,
            files,
            bytes,
        })
        .collect();
    found.sort_by(|a, b| {
        b.bytes
            .cmp(&a.bytes)
            .then_with(|| a.pattern.cmp(&b.pattern))
    });
    found.truncate(MAX_SUGGESTIONS);
    found
}

/// Stop storing files matching `patterns` with Git LFS (files already stored with it stay so).
pub(super) fn untrack_with_lfs(git: &Git, patterns: Vec<String>) -> Result<String> {
    let patterns: Vec<&str> = patterns
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    if patterns.is_empty()
        || patterns
            .iter()
            .any(|p| p.starts_with('-') || p.contains('\n'))
    {
        return Err("Choose which patterns to stop storing with Git LFS.".into());
    }
    let mut args = vec!["lfs", "untrack", "--"];
    args.extend(&patterns);
    git.run(&args)?;
    git.run(&["add", "--", ".gitattributes"])?;
    Ok(format!(
        "No longer storing {} with Git LFS",
        patterns.join(", ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_folders_and_patterns_like_git_lfs() {
        assert!(path_matches("Content/Art", "Content/Art/hero.psd"));
        assert!(path_matches("Content/Art/", "Content/Art/hero.psd"));
        assert!(!path_matches("Content/Art", "Content/Artwork/hero.psd"));
        assert!(path_matches("*.psd", "Content/Art/hero.psd"));
        assert!(!path_matches("*.psd", "Content/Art/hero.png"));
        assert!(path_matches("Content/*", "Content/Art/hero.psd"));
        assert!(path_matches(
            "Content/**/hero.psd",
            "Content/Art/Old/hero.psd"
        ));
        assert!(!path_matches("", "Content/Art/hero.psd"));

        let filter = FetchFilter {
            include: vec!["Content".into()],
            exclude: vec!["Content/Cinematics".into()],
        };
        assert!(filter.allows("Content/Art/hero.psd"));
        assert!(!filter.allows("Content/Cinematics/intro.mp4"));
        assert!(!filter.allows("Docs/logo.png"));
        assert!(FetchFilter::default().allows("anything.bin"));
    }

    #[test]
    fn groups_files_into_folders() {
        let file = |name: &str, size: u64| LfsFile {
            name: name.into(),
            size,
            downloaded: true,
        };
        // All under Content: the folders inside it.
        let found = folders(&[
            file("Content/Art/a.psd", 10),
            file("Content/Art/b.psd", 10),
            file("Content/Audio/c.wav", 30),
        ]);
        let paths: Vec<&str> = found.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["Content/Audio", "Content/Art"]);
        assert_eq!(
            (found[1].files, found[1].bytes, found[1].downloaded),
            (2, 20, 2)
        );
    }

    #[test]
    fn reads_the_patterns_stored_with_lfs() {
        let text = "# Art\n*.psd filter=lfs diff=lfs merge=lfs -text\n*.uasset lockable\n\
                    Content/** filter=lfs diff=lfs merge=lfs -text\n*.psd filter=lfs\n*.txt text\n";
        assert_eq!(lfs_patterns(text), vec!["*.psd", "Content/**"]);
    }
}
