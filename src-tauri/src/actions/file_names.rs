//! File names that work here but not on everyone's computer: on Windows, reserved names
//! (`CON`, `aux.txt`), characters it doesn't allow (`?`, `:`), names ending in a dot or a
//! space, and long paths; on Windows and macOS, two names that differ only in capitals
//! (`Hero.png` and `hero.png`, or the folders `Maps` and `maps`), which there are one file.
//! A teammate's checkout of such a commit fails, or goes quietly wrong.
//!
//! Only new files are looked at: names already in the history are old news.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use gix::bstr::ByteSlice;

/// Longer paths (in the repository) are flagged: with the folder it's cloned into, like
/// `C:\Users\maya\Projects\Feast\`, the whole path goes over Windows' 260 characters.
pub const LONG_PATH: usize = 200;
/// At most this many new files are looked at.
const MOST_FILES: usize = 5000;

/// A new file whose name will cause trouble elsewhere.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NameProblem {
    pub path: String,
    pub problem: Problem,
    /// The part of the path at fault: a name, a character, or for a clash, the other path.
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Problem {
    /// Same name as another file or folder but for capitals.
    CaseClash,
    /// A name Windows keeps for devices, like `CON` or `com1.txt`.
    Reserved,
    /// A character Windows doesn't allow in names.
    Character,
    /// A name ending in a dot or a space, which Windows drops.
    TrailingDot,
    /// Longer than [`LONG_PATH`].
    TooLong,
}

const RESERVED: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];

/// Windows' device names, with or without an extension: `CON`, `nul.txt`, `COM1`, `lpt9.log`.
fn is_reserved(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or(name)
        .trim_end()
        .to_ascii_uppercase();
    RESERVED.contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
}

/// What's wrong with `path`'s own name and folders, on its own (not counting clashes).
pub fn path_problem(path: &str) -> Option<NameProblem> {
    let problem = |problem, detail: &str| {
        Some(NameProblem {
            path: path.to_owned(),
            problem,
            detail: detail.to_owned(),
        })
    };
    for part in path.split('/') {
        if let Some(bad) = part
            .chars()
            .find(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\\') || c.is_control())
        {
            return problem(Problem::Character, &bad.to_string());
        }
        if is_reserved(part) {
            return problem(Problem::Reserved, part);
        }
        if part.ends_with('.') || part.ends_with(' ') {
            return problem(Problem::TrailingDot, part);
        }
    }
    if path.chars().count() > LONG_PATH {
        return problem(Problem::TooLong, &path.chars().count().to_string());
    }
    None
}

/// New files whose name, or one of whose folders, matches another's but for capitals:
/// one in the last commit (`existing`: each folder's entries, by folder, "" for the top), or
/// another new file. A name spelled as committed is the right one, so only the other
/// spelling is flagged.
fn case_clashes(new_files: &[&str], existing: &HashMap<String, Vec<String>>) -> Vec<NameProblem> {
    let join = |folder: &str, name: &str| {
        if folder.is_empty() {
            name.to_owned()
        } else {
            format!("{folder}/{name}")
        }
    };
    // What the new files add to each folder.
    let mut added: HashMap<String, HashSet<String>> = HashMap::new();
    for file in new_files {
        let mut folder = String::new();
        for part in file.split('/') {
            added
                .entry(folder.clone())
                .or_default()
                .insert(part.to_owned());
            folder = join(&folder, part);
        }
    }
    let clash = |names: Option<&HashSet<String>>, part: &str| -> Option<String> {
        let lower = part.to_lowercase();
        names?
            .iter()
            .filter(|name| name.as_str() != part && name.to_lowercase() == lower)
            .min()
            .cloned()
    };
    let committed: HashMap<&str, HashSet<String>> = existing
        .iter()
        .map(|(folder, names)| (folder.as_str(), names.iter().cloned().collect()))
        .collect();
    let mut problems = Vec::new();
    for file in new_files {
        let mut folder = String::new();
        for part in file.split('/') {
            let here = committed.get(folder.as_str());
            if !here.is_some_and(|names| names.contains(part))
                && let Some(other) = clash(here, part).or_else(|| clash(added.get(&folder), part))
            {
                problems.push(NameProblem {
                    path: (*file).to_owned(),
                    problem: Problem::CaseClash,
                    detail: join(&folder, &other),
                });
                break;
            }
            folder = join(&folder, part);
        }
    }
    problems
}

/// The folders `files` are in, and the folders those are in, up to the top ("").
fn folders_of(files: &[&str]) -> Vec<String> {
    let mut folders: HashSet<String> = HashSet::new();
    for file in files {
        let mut at = *file;
        while let Some((folder, _)) = at.rsplit_once('/') {
            folders.insert(folder.to_owned());
            at = folder;
        }
    }
    let mut folders: Vec<String> = folders.into_iter().collect();
    folders.sort();
    folders
}

/// Each folder's own entries in the last commit (not what's inside them), for the top ("")
/// and `folders`.
fn committed_entries(repo: &gix::Repository, folders: &[String]) -> HashMap<String, Vec<String>> {
    let mut entries = HashMap::new();
    let Some(top) = repo
        .head_commit()
        .ok()
        .and_then(|commit| commit.tree().ok())
    else {
        return entries;
    };
    let names_of = |tree: &gix::Tree<'_>| -> Vec<String> {
        tree.iter()
            .filter_map(Result::ok)
            .map(|entry| entry.filename().to_str_lossy().into_owned())
            .collect()
    };
    entries.insert(String::new(), names_of(&top));
    for folder in folders {
        let tree = top
            .lookup_entry_by_path(folder)
            .ok()
            .flatten()
            .filter(|entry| entry.mode().is_tree())
            .and_then(|entry| entry.object().ok())
            .and_then(|object| object.try_into_tree().ok());
        if let Some(tree) = tree {
            entries.insert(folder.clone(), names_of(&tree));
        }
    }
    entries
}

/// The trouble with the names of `files` (changed files, relative to the repository's top)
/// that aren't in the last commit.
pub(super) fn name_problems(repo: &gix::Repository, files: &[&str]) -> Vec<NameProblem> {
    let files: Vec<&str> = files.iter().copied().take(MOST_FILES).collect();
    if files.is_empty() {
        return Vec::new();
    }
    let existing = committed_entries(repo, &folders_of(&files));
    let new_files: Vec<&str> = files
        .into_iter()
        .filter(|file| {
            let (folder, name) = file.rsplit_once('/').unwrap_or(("", file));
            !existing
                .get(folder)
                .is_some_and(|names| names.iter().any(|known| known == name))
        })
        .collect();
    let mut problems: Vec<NameProblem> = new_files
        .iter()
        .filter_map(|file| path_problem(file))
        .collect();
    let flagged: HashSet<String> = problems.iter().map(|p| p.path.clone()).collect();
    problems.extend(
        case_clashes(&new_files, &existing)
            .into_iter()
            .filter(|problem| !flagged.contains(&problem.path)),
    );
    problems.sort_by(|a, b| a.path.cmp(&b.path));
    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_names_windows_cannot_have() {
        let problem = |path: &str| path_problem(path).map(|p| (p.problem, p.detail));
        assert_eq!(problem("Content/Hero.uasset"), None);
        assert_eq!(
            problem("docs/con.txt"),
            Some((Problem::Reserved, "con.txt".into()))
        );
        assert_eq!(
            problem("AUX/readme.md"),
            Some((Problem::Reserved, "AUX".into()))
        );
        assert_eq!(
            problem("logs/com1"),
            Some((Problem::Reserved, "com1".into()))
        );
        assert_eq!(problem("logs/com0"), None);
        assert_eq!(problem("console.txt"), None);
        assert_eq!(problem("What?.png"), Some((Problem::Character, "?".into())));
        assert_eq!(problem("a:b/c.txt"), Some((Problem::Character, ":".into())));
        assert_eq!(
            problem("notes./a.txt"),
            Some((Problem::TrailingDot, "notes.".into()))
        );
        assert_eq!(problem("draft .txt"), None);
        assert_eq!(
            problem("draft.txt "),
            Some((Problem::TrailingDot, "draft.txt ".into()))
        );
        let long = format!("Content/{}.uasset", "Very".repeat(50));
        assert_eq!(
            path_problem(&long).map(|p| p.problem),
            Some(Problem::TooLong)
        );
    }

    #[test]
    fn finds_names_that_differ_only_in_capitals() {
        let existing: HashMap<String, Vec<String>> = HashMap::from([
            ("".into(), vec!["Content".into(), "README.md".into()]),
            ("Content".into(), vec!["Maps".into()]),
        ]);
        let clashes = case_clashes(
            &[
                "content/Hero.png",
                "Content/maps/Arena.umap",
                "Readme.md",
                "Content/New.png",
                "a.txt",
                "A.txt",
            ],
            &existing,
        );
        let found: Vec<(&str, &str)> = clashes
            .iter()
            .map(|c| (c.path.as_str(), c.detail.as_str()))
            .collect();
        assert_eq!(
            found,
            vec![
                ("content/Hero.png", "Content"),
                ("Content/maps/Arena.umap", "Content/Maps"),
                ("Readme.md", "README.md"),
                ("a.txt", "A.txt"),
                ("A.txt", "a.txt"),
            ]
        );
        assert_eq!(folders_of(&["a/b/c.txt", "a/d.txt"]), vec!["a", "a/b"]);
    }
}
