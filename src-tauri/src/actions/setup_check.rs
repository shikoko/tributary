//! Is the repository set up the way a game project needs? Most "git broke our project"
//! stories start here: the engine's generated folders committed, art not in Git LFS (or not
//! lockable), line endings left to each computer's settings, paths too long for Windows, or
//! two names that differ only in capitals. Each check says what it found and, where it can,
//! offers a fix.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::support::{LITERAL, in_batches};
use crate::error::{Error, Result};
use crate::git::Git;

/// Files this big, outside Git LFS, are worth moving into it.
const BIG: u64 = 10_000_000;
/// Paths longer than this (in the repository) leave little room on Windows, where a clone
/// in a folder like C:\Users\someone\Documents\Projects\ already takes 40 or more of 260.
const LONG_PATH: usize = 180;
/// How many examples a check lists.
const EXAMPLES: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Engine {
    Unreal,
    Unity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CheckStatus {
    Good,
    Warning,
    Problem,
}

/// A change that puts a check right.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SetupFix {
    /// Add these lines to .gitignore.
    Ignore { patterns: Vec<String> },
    /// Stop tracking these folders (their files stay on disk; the next commit removes them
    /// from the repository).
    Untrack { folders: Vec<String> },
    /// Store files like these with Git LFS.
    Track { patterns: Vec<String> },
    /// Make files like these lockable (Git LFS's locks; changing one then needs its lock).
    Lockable { patterns: Vec<String> },
    /// Let git keep text files' line endings the same for everyone (`* text=auto`).
    TextAuto,
    /// Let git on Windows use paths longer than 260 characters, in this repository.
    LongPaths,
    /// Set up Git LFS in this repository (`git lfs install --local`).
    InstallLfs,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheck {
    /// Stable, for the frontend ("ignore", "lfs", …).
    pub id: String,
    pub status: CheckStatus,
    pub title: String,
    pub detail: String,
    /// Some of what was found (file names, patterns).
    pub examples: Vec<String>,
    pub fix: Option<SetupFix>,
    /// What the fix does, for its button.
    pub fix_label: Option<String>,
}

/// How a repository is set up for a game project, check by check.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSetup {
    pub engine: Option<Engine>,
    /// The project's folder in the repository ("" for the top), like "Game".
    pub project: Option<String>,
    pub checks: Vec<SetupCheck>,
}

/// Where the engine's project is: the folder of an Unreal `.uproject`, or of a Unity
/// project (`Assets` beside `ProjectSettings`), at the top or one folder down.
pub fn find_project(files: &[&str]) -> Option<(Engine, String)> {
    let folder = |path: &str| {
        path.rsplit_once('/')
            .map_or(String::new(), |(dir, _)| dir.to_owned())
    };
    let depth = |path: &str| path.matches('/').count();
    if let Some(project) = files
        .iter()
        .filter(|path| path.ends_with(".uproject") && depth(path) <= 1)
        .min_by_key(|path| depth(path))
    {
        return Some((Engine::Unreal, folder(project)));
    }
    files
        .iter()
        .filter(|path| path.ends_with("ProjectSettings/ProjectVersion.txt") && depth(path) <= 2)
        .min_by_key(|path| depth(path))
        .map(|path| {
            // The folder ProjectSettings is in.
            let settings = folder(path);
            (Engine::Unity, folder(&settings))
        })
}

/// The folders the engine makes on each computer, which don't belong in the repository.
pub fn generated_folders(engine: Engine) -> &'static [&'static str] {
    match engine {
        Engine::Unreal => &[
            "Binaries",
            "DerivedDataCache",
            "Intermediate",
            "Saved",
            ".vs",
        ],
        Engine::Unity => &[
            "Library",
            "Temp",
            "Obj",
            "Logs",
            "UserSettings",
            "MemoryCaptures",
            "Build",
            "Builds",
        ],
    }
}

/// The kinds of file Git LFS should store, for the engine.
fn lfs_kinds(engine: Option<Engine>) -> Vec<&'static str> {
    let mut kinds = vec![
        "png", "jpg", "jpeg", "tga", "psd", "exr", "hdr", "tif", "tiff", "dds", "fbx", "obj",
        "blend", "abc", "ma", "mb", "max", "wav", "mp3", "ogg", "flac", "mp4", "mov", "ttf", "otf",
        "zip",
    ];
    match engine {
        Some(Engine::Unreal) => kinds.extend(["uasset", "umap", "ubulk", "uexp", "upk"]),
        Some(Engine::Unity) => kinds.extend(["cubemap", "unitypackage", "bank"]),
        None => {}
    }
    kinds
}

/// The kinds of file that can't be merged and should be lockable, so two people don't
/// change one at once.
fn lockable_kinds(engine: Option<Engine>) -> Vec<&'static str> {
    let mut kinds = vec!["psd", "blend", "fbx", "ma", "mb", "max"];
    if engine == Some(Engine::Unreal) {
        kinds.extend(["uasset", "umap"]);
    }
    kinds
}

/// The extension of `path`, lower-case.
fn extension(path: &str) -> Option<String> {
    let name = path.rsplit('/').next()?;
    let (stem, extension) = name.rsplit_once('.')?;
    (!stem.is_empty()).then(|| extension.to_ascii_lowercase())
}

/// Names that differ only in capitals: one file or folder on Windows and macOS.
pub fn case_clashes(files: &[&str]) -> Vec<String> {
    let mut names: HashMap<String, BTreeSet<String>> = HashMap::new();
    for path in files {
        let mut prefix = String::new();
        for part in path.split('/') {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            names
                .entry(prefix.to_lowercase())
                .or_default()
                .insert(prefix.clone());
        }
    }
    let mut clashes: Vec<String> = names
        .into_values()
        .filter(|spellings| spellings.len() > 1)
        .map(|spellings| spellings.into_iter().collect::<Vec<_>>().join(" and "))
        .collect();
    clashes.sort();
    clashes
}

/// The value of attribute `name` for each of `paths` ("set", "unset", "unspecified" or a value).
fn attributes(git: &Git, name: &str, paths: &[&str]) -> HashMap<String, String> {
    let mut found = HashMap::new();
    for batch in in_batches(paths) {
        let mut args = vec!["check-attr", "-z", name, "--"];
        args.extend(batch);
        let Ok(output) = git.run_with_env(&args, &LITERAL) else {
            continue;
        };
        let parts: Vec<&str> = output.split('\0').collect();
        for record in parts.chunks(3) {
            if let [file, _, value] = record {
                found.insert((*file).to_owned(), (*value).to_owned());
            }
        }
    }
    found
}

fn check(
    id: &str,
    status: CheckStatus,
    title: impl Into<String>,
    detail: impl Into<String>,
) -> SetupCheck {
    SetupCheck {
        id: id.to_owned(),
        status,
        title: title.into(),
        detail: detail.into(),
        examples: Vec::new(),
        fix: None,
        fix_label: None,
    }
}

impl SetupCheck {
    fn with_fix(mut self, fix: SetupFix, label: &str) -> Self {
        self.fix = Some(fix);
        self.fix_label = Some(label.to_owned());
        self
    }

    fn with_examples(mut self, examples: impl IntoIterator<Item = String>) -> Self {
        self.examples = examples.into_iter().take(EXAMPLES).collect();
        self
    }
}

fn plural(count: usize, word: &str) -> String {
    format!("{count} {word}{}", if count == 1 { "" } else { "s" })
}

/// "1 kind of file", "2 kinds of files".
fn kinds(count: usize) -> String {
    if count == 1 {
        "1 kind of file".to_owned()
    } else {
        format!("{count} kinds of files")
    }
}

/// How the repository at `path` is set up for a game project, check by check.
pub fn project_setup(path: &Path) -> Result<ProjectSetup, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    let listed = git.run(&["ls-files", "-z"]).unwrap_or_default();
    let files: Vec<&str> = listed.split('\0').filter(|path| !path.is_empty()).collect();
    let found = find_project(&files);
    let (engine, project) = match &found {
        Some((engine, project)) => (Some(*engine), Some(project.clone())),
        None => (None, None),
    };
    let under = |name: &str| match project.as_deref() {
        Some("") | None => name.to_owned(),
        Some(project) => format!("{project}/{name}"),
    };
    let mut checks = Vec::new();

    // The engine's generated folders: ignored, and not committed.
    if let Some(engine) = engine {
        let folders: Vec<String> = generated_folders(engine)
            .iter()
            .map(|name| under(name))
            .collect();
        let samples: Vec<String> = folders.iter().map(|folder| format!("{folder}/x")).collect();
        let sample_refs: Vec<&str> = samples.iter().map(String::as_str).collect();
        let mut args = vec!["check-ignore", "--no-index", "--"];
        args.extend(sample_refs.iter().copied());
        let ignored: BTreeSet<String> = git
            .run_status(&args)
            .map(|(_, output)| output.lines().map(str::to_owned).collect())
            .unwrap_or_default();
        let missing: Vec<String> = folders
            .iter()
            .filter(|folder| !ignored.contains(&format!("{folder}/x")))
            .map(|folder| format!("/{folder}/"))
            .collect();
        checks.push(if missing.is_empty() {
            check("ignore", CheckStatus::Good, "The engine's own folders are ignored", "What the engine makes on each computer (caches, builds, logs) stays out of the repository.")
        } else {
            check(
                "ignore",
                CheckStatus::Problem,
                format!("{} the engine makes {} ignored", plural(missing.len(), "folder"), if missing.len() == 1 { "isn't" } else { "aren't" }),
                "Caches, builds and logs the engine makes on each computer would be offered for committing, and they're big and change all the time.",
            )
            .with_examples(missing.clone())
            .with_fix(SetupFix::Ignore { patterns: missing }, "Add them to .gitignore")
        });
        let committed: Vec<(String, usize)> = folders
            .iter()
            .map(|folder| {
                (
                    folder.clone(),
                    files
                        .iter()
                        .filter(|path| path.starts_with(&format!("{folder}/")))
                        .count(),
                )
            })
            .filter(|(_, count)| *count > 0)
            .collect();
        if !committed.is_empty() {
            let total: usize = committed.iter().map(|(_, count)| count).sum();
            checks.push(
                check(
                    "committed",
                    CheckStatus::Problem,
                    format!("{} of the engine's own are committed", plural(total, "file")),
                    "They're rebuilt on each computer, so they only cause conflicts and make clones bigger. Stopping tracking them keeps them on your disk; the next commit takes them out of the repository.",
                )
                .with_examples(committed.iter().map(|(folder, count)| format!("{folder}/ ({})", plural(*count, "file"))))
                .with_fix(SetupFix::Untrack { folders: committed.into_iter().map(|(folder, _)| folder).collect() }, "Stop tracking them"),
            );
        }
    }

    // Git LFS: installed, set up here, and storing the kinds of file that need it.
    let lfs_installed = git.run(&["lfs", "version"]).is_ok();
    let lfs_here = git.run(&["config", "--get", "filter.lfs.process"]).is_ok();
    if !lfs_installed {
        checks.push(check(
            "lfs-installed",
            CheckStatus::Problem,
            "Git LFS isn't installed",
            "Game projects keep their art, audio and levels in Git LFS. Install it from git-lfs.com, then check again.",
        ));
    } else if !lfs_here {
        checks.push(
            check("lfs-installed", CheckStatus::Warning, "Git LFS isn't set up here", "Without it, files stored in Git LFS check out as small pointer files instead of their content.")
                .with_fix(SetupFix::InstallLfs, "Set up Git LFS"),
        );
    }
    let mut by_kind: HashMap<String, Vec<&str>> = HashMap::new();
    for path in &files {
        if let Some(kind) = extension(path) {
            by_kind.entry(kind).or_default().push(path);
        }
    }
    let present: Vec<&str> = lfs_kinds(engine)
        .into_iter()
        .filter(|kind| by_kind.contains_key(*kind))
        .collect();
    let samples: Vec<String> = present
        .iter()
        .map(|kind| by_kind[*kind][0].to_owned())
        .collect();
    let sample_refs: Vec<&str> = samples.iter().map(String::as_str).collect();
    let filters = attributes(&git, "filter", &sample_refs);
    let untracked_kinds: Vec<&str> = present
        .iter()
        .zip(&samples)
        .filter(|(_, sample)| filters.get(*sample).map(String::as_str) != Some("lfs"))
        .map(|(kind, _)| *kind)
        .collect();
    if !present.is_empty() {
        checks.push(if untracked_kinds.is_empty() {
            check("lfs", CheckStatus::Good, "Art, audio and assets are stored with Git LFS", "Clones stay small: big files' old versions are downloaded only when they're needed.")
        } else {
            check(
                "lfs",
                CheckStatus::Problem,
                format!("{} not stored with Git LFS", kinds(untracked_kinds.len())),
                "Every version of these stays in every clone forever. Tracking them stores new versions with Git LFS (Repository size can move the old ones too).",
            )
            .with_examples(untracked_kinds.iter().map(|kind| format!("*.{kind} ({})", plural(by_kind[*kind].len(), "file"))))
            .with_fix(SetupFix::Track { patterns: untracked_kinds.iter().map(|kind| format!("*.{kind}")).collect() }, "Store them with Git LFS")
        });
    }
    let lockable_present: Vec<&str> = lockable_kinds(engine)
        .into_iter()
        .filter(|kind| by_kind.contains_key(*kind))
        .collect();
    let lock_samples: Vec<String> = lockable_present
        .iter()
        .map(|kind| by_kind[*kind][0].to_owned())
        .collect();
    let lock_refs: Vec<&str> = lock_samples.iter().map(String::as_str).collect();
    let lockable = attributes(&git, "lockable", &lock_refs);
    let not_lockable: Vec<&str> = lockable_present
        .iter()
        .zip(&lock_samples)
        .filter(|(_, sample)| lockable.get(*sample).map(String::as_str) != Some("set"))
        .map(|(kind, _)| *kind)
        .collect();
    if !lockable_present.is_empty() {
        checks.push(if not_lockable.is_empty() {
            check("lockable", CheckStatus::Good, "Files that can't be merged are lockable", "Locking one before changing it keeps two people from changing it at once.")
        } else {
            check(
                "lockable",
                CheckStatus::Warning,
                format!("{} that can't be merged {} lockable", kinds(not_lockable.len()), if not_lockable.len() == 1 { "isn't" } else { "aren't" }),
                "When two people change one of these at once, one of them loses their work. Lockable files are read-only until locked, so nobody starts without the lock.",
            )
            .with_examples(not_lockable.iter().map(|kind| format!("*.{kind}")))
            .with_fix(SetupFix::Lockable { patterns: not_lockable.iter().map(|kind| format!("*.{kind}")).collect() }, "Make them lockable")
        });
    }

    // Big files outside Git LFS, in the checked-out commit.
    let tree = git
        .run(&["ls-tree", "-r", "-l", "-z", "HEAD"])
        .unwrap_or_default();
    let mut big: Vec<(u64, &str)> = tree
        .split('\0')
        .filter_map(|entry| {
            let (meta, path) = entry.split_once('\t')?;
            let size: u64 = meta.split_whitespace().nth(3)?.parse().ok()?;
            (size >= BIG).then_some((size, path))
        })
        .collect();
    big.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    if !big.is_empty() {
        checks.push(
            check(
                "big",
                CheckStatus::Warning,
                format!("{} over 10 MB {} in git, not Git LFS", plural(big.len(), "file"), if big.len() == 1 { "is" } else { "are" }),
                "Every clone downloads every version of them. Repository size can move them into Git LFS.",
            )
            .with_examples(big.iter().map(|(size, path)| format!("{path} ({} MB)", size / 1_000_000))),
        );
    }

    // Line endings.
    let text_sample = files
        .iter()
        .find(|path| {
            matches!(
                extension(path).as_deref(),
                Some("cpp" | "h" | "cs" | "ini" | "txt" | "json" | "md")
            )
        })
        .copied()
        .unwrap_or("Source/x.cpp");
    let text = attributes(&git, "text", &[text_sample]);
    let decided = text
        .get(text_sample)
        .is_some_and(|value| value != "unspecified");
    checks.push(if decided {
        check("text", CheckStatus::Good, "Line endings are the same for everyone", ".gitattributes says how text files' line endings are kept.")
    } else {
        check(
            "text",
            CheckStatus::Warning,
            "Line endings depend on each computer's settings",
            "Between Windows and macOS this shows whole files as changed when nothing did. \"* text=auto\" in .gitattributes keeps them the same for everyone.",
        )
        .with_fix(SetupFix::TextAuto, "Add * text=auto")
    });

    // Paths too long for Windows.
    let mut long: Vec<&str> = files
        .iter()
        .copied()
        .filter(|path| path.len() > LONG_PATH)
        .collect();
    long.sort_by_key(|path| std::cmp::Reverse(path.len()));
    let long_paths_on = git
        .run(&["config", "--get", "core.longpaths"])
        .is_ok_and(|value| value.trim() == "true");
    if !long.is_empty() {
        let mut item = check(
            "long-paths",
            if long_paths_on { CheckStatus::Good } else { CheckStatus::Warning },
            format!("{} longer than {LONG_PATH} characters", plural(long.len(), "path")),
            if long_paths_on {
                "Long paths are turned on here. On Windows, everyone else needs \"git config --global core.longpaths true\" too, and to clone into a short folder."
            } else {
                "On Windows, paths over 260 characters (counting the folder it's cloned into) fail to check out. Turning long paths on fixes it on this computer; everyone on Windows needs it too."
            },
        )
        .with_examples(long.iter().map(|path| format!("{path} ({})", path.len())));
        if !long_paths_on {
            item = item.with_fix(SetupFix::LongPaths, "Turn long paths on here");
        }
        checks.push(item);
    }

    // Names that differ only in capitals.
    let clashes = case_clashes(&files);
    if !clashes.is_empty() {
        checks.push(
            check(
                "case",
                CheckStatus::Problem,
                format!("{} differ only in capitals", plural(clashes.len(), "name")),
                "On Windows and macOS they're the same file or folder, so one overwrites the other. Rename one of each (then commit).",
            )
            .with_examples(clashes),
        );
    }

    Ok(ProjectSetup {
        engine,
        project,
        checks,
    })
}

/// Put one check right.
pub(super) fn fix_setup(git: &Git, workdir: &Path, fix: SetupFix) -> Result<String> {
    match fix {
        SetupFix::Ignore { patterns } => {
            let file = workdir.join(".gitignore");
            let mut text = std::fs::read_to_string(&file).unwrap_or_default();
            if !text.is_empty() && !text.ends_with('\n') {
                text.push('\n');
            }
            text.push_str(
                "\n# The engine's own folders, made on each computer (added by Tributary)\n",
            );
            for pattern in &patterns {
                text.push_str(pattern);
                text.push('\n');
            }
            std::fs::write(&file, text).map_err(|e| format!("Couldn't write .gitignore: {e}"))?;
            Ok(format!(
                "Added {} to .gitignore: commit it to share it",
                plural(patterns.len(), "folder")
            ))
        }
        SetupFix::Untrack { folders } => {
            let mut args = vec!["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--"];
            args.extend(folders.iter().map(String::as_str));
            git.run_with_env(&args, &LITERAL)?;
            Ok(format!(
                "Stopped tracking {}: they're still on disk, and the next commit takes them out of the repository",
                plural(folders.len(), "folder")
            ))
        }
        SetupFix::Track { patterns } => super::lfs::track_with_lfs(git, patterns, Vec::new()),
        SetupFix::Lockable { patterns } => {
            let file = workdir.join(".gitattributes");
            let text = std::fs::read_to_string(&file).unwrap_or_default();
            let text = with_lockable(&text, &patterns);
            std::fs::write(&file, text)
                .map_err(|e| format!("Couldn't write .gitattributes: {e}"))?;
            Ok(format!(
                "Made {} lockable: commit .gitattributes to share it",
                patterns.join(", ")
            ))
        }
        SetupFix::TextAuto => {
            let file = workdir.join(".gitattributes");
            let text = std::fs::read_to_string(&file).unwrap_or_default();
            // First, so the lines after it (Git LFS's) still apply to their files.
            std::fs::write(&file, format!("* text=auto\n{text}"))
                .map_err(|e| format!("Couldn't write .gitattributes: {e}"))?;
            Ok("Text files' line endings are now the same for everyone: commit .gitattributes to share it".into())
        }
        SetupFix::LongPaths => {
            git.run(&["config", "--local", "core.longpaths", "true"])?;
            Ok("Turned long paths on in this repository".into())
        }
        SetupFix::InstallLfs => {
            git.run(&["lfs", "install", "--local"])?;
            Ok("Set up Git LFS in this repository".into())
        }
    }
}

/// .gitattributes with `lockable` added to each of `patterns`' lines (or a new Git LFS line
/// for a pattern it doesn't have).
pub fn with_lockable(text: &str, patterns: &[String]) -> String {
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    for pattern in patterns {
        let found = lines
            .iter_mut()
            .rfind(|line| line.split_whitespace().next() == Some(pattern.as_str()));
        match found {
            Some(line) if line.split_whitespace().any(|word| word == "lockable") => {}
            Some(line) => line.push_str(" lockable"),
            None => lines.push(format!(
                "{pattern} filter=lfs diff=lfs merge=lfs -text lockable"
            )),
        }
    }
    let mut text = lines.join("\n");
    text.push('\n');
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_engines_project() {
        assert_eq!(
            find_project(&["Game/Game.uproject", "Game/Content/A.uasset"]),
            Some((Engine::Unreal, "Game".into()))
        );
        assert_eq!(
            find_project(&["Tavern.uproject"]),
            Some((Engine::Unreal, String::new()))
        );
        assert_eq!(
            find_project(&["ProjectSettings/ProjectVersion.txt", "Assets/A.png"]),
            Some((Engine::Unity, String::new()))
        );
        assert_eq!(
            find_project(&["Client/ProjectSettings/ProjectVersion.txt"]),
            Some((Engine::Unity, "Client".into()))
        );
        assert_eq!(
            find_project(&["README.md", "deep/down/x/Thing.uproject"]),
            None
        );
    }

    #[test]
    fn finds_names_that_differ_only_in_capitals() {
        let clashes = case_clashes(&[
            "Content/Props/Chair.uasset",
            "Content/props/Stool.uasset",
            "README.md",
            "readme.md",
        ]);
        assert_eq!(
            clashes,
            vec!["Content/Props and Content/props", "README.md and readme.md"]
        );
        assert!(case_clashes(&["a/b.txt", "a/c.txt"]).is_empty());
    }

    #[test]
    fn makes_patterns_lockable() {
        let text = "* text=auto\n*.uasset filter=lfs diff=lfs merge=lfs -text\n*.png filter=lfs diff=lfs merge=lfs -text lockable\n";
        let result = with_lockable(text, &["*.uasset".into(), "*.png".into(), "*.umap".into()]);
        assert_eq!(
            result,
            "* text=auto\n*.uasset filter=lfs diff=lfs merge=lfs -text lockable\n*.png filter=lfs diff=lfs merge=lfs -text lockable\n*.umap filter=lfs diff=lfs merge=lfs -text lockable\n"
        );
    }
}
