//! Git LFS: locking files, tracking files with LFS, cleaning up local copies, and checking
//! changed files for big ones that aren't in LFS.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::LockRef;
use super::support::{LITERAL, describe_files, file_name, in_batches};
use super::validate::check_file_paths;
use crate::error::{Error, Result};
use crate::git::Git;

/// Lock files with Git LFS, so nobody else can push changes to them.
pub(super) fn lock_files(git: &Git, paths: Vec<String>) -> Result<String> {
    let paths = check_file_paths(&paths)?;
    each_file(&paths, "lock", |path| {
        let output = git.run(&["lfs", "lock", "--json", "--", path])?;
        if let Some(owner) = crate::locks::owner_of_new_lock(&output) {
            crate::locks::remember_owner(git.workdir(), &owner);
        }
        Ok(())
    })
}

/// Release Git LFS locks, by id (the file may not exist here). `force` releases
/// someone else's lock.
pub(super) fn unlock_files(git: &Git, locks: Vec<LockRef>, force: bool) -> Result<String> {
    if locks.is_empty() {
        return Err("No files given.".into());
    }
    let paths: Vec<&str> = locks.iter().map(|lock| lock.path.as_str()).collect();
    let by_path: std::collections::HashMap<&str, &LockRef> = locks
        .iter()
        .map(|lock| (lock.path.as_str(), lock))
        .collect();
    each_file(&paths, "unlock", |path| {
        let Some(lock) = by_path.get(path) else {
            return Err(format!("{path} isn't locked").into());
        };
        if lock.id.is_empty() || lock.id.starts_with('-') {
            return Err(format!("Unknown lock {}", lock.id).into());
        }
        let id = format!("--id={}", lock.id);
        // Git LFS makes a file read-only again once it's unlocked, and gives up
        // when the file isn't in this working tree (deleted, or on another branch).
        let missing = !git.workdir().join(&lock.path).exists();
        let mut args = if missing {
            vec![
                "-c",
                "lfs.setlockablereadonly=false",
                "lfs",
                "unlock",
                id.as_str(),
            ]
        } else {
            vec!["lfs", "unlock", id.as_str()]
        };
        if force {
            args.push("--force");
        }
        git.run(&args).map(|_| ())
    })
}

/// Store files matching `patterns` (like `*.psd`) with Git LFS from now on, and turn
/// the staged `paths` among them into LFS files.
pub(super) fn track_with_lfs(
    git: &Git,
    patterns: Vec<String>,
    paths: Vec<String>,
) -> Result<String> {
    let patterns: Vec<&str> = patterns
        .iter()
        .map(|pattern| pattern.trim())
        .filter(|pattern| !pattern.is_empty())
        .collect();
    if patterns.is_empty()
        || patterns
            .iter()
            .any(|p| p.starts_with('-') || p.contains('\n'))
    {
        return Err("Choose which files to track with Git LFS.".into());
    }
    // Without Git LFS's filters set up, files would still go into git itself.
    if git.run(&["config", "--get", "filter.lfs.clean"]).is_err() {
        git.run(&["lfs", "install", "--local"])?;
    }
    let mut args = vec!["lfs", "track", "--"];
    args.extend(&patterns);
    git.run(&args)?;
    git.run(&["add", "--", ".gitattributes"])?;
    let paths = if paths.is_empty() {
        Vec::new()
    } else {
        check_file_paths(&paths)?
    };
    // Staged files are added again, as LFS files this time.
    for batch in in_batches(&paths) {
        let mut args = vec!["add", "--renormalize", "--"];
        args.extend(batch);
        git.run_with_env(&args, &LITERAL)?;
    }
    Ok(format!(
        "{} {} with Git LFS",
        if paths.is_empty() {
            "Tracking"
        } else {
            "Now storing"
        },
        patterns.join(", ")
    ))
}

/// Delete local copies of Git LFS files that aren't needed any more (`git lfs prune`).
pub(super) fn prune_lfs(git: &Git) -> Result<String> {
    let before = lfs_storage(git).map(|storage| storage.bytes).unwrap_or(0);
    git.run(&["lfs", "prune"])?;
    let after = lfs_storage(git).map(|storage| storage.bytes).unwrap_or(0);
    Ok(format!(
        "Freed {} of Git LFS files",
        crate::git::lfs_progress::format_bytes(before.saturating_sub(after))
    ))
}

/// Lock or unlock files one by one: Git LFS takes one path at a time. Reports the ones
/// that failed, after doing the rest.
pub(super) fn each_file(
    paths: &[&str],
    verb: &str,
    mut run: impl FnMut(&str) -> Result<(), Error>,
) -> Result<String, Error> {
    let mut done = Vec::new();
    let mut failed = Vec::new();
    for &path in paths {
        match run(path) {
            Ok(()) => done.push(path),
            Err(error) => failed.push(format!("{}: {}", file_name(path), error.to_string().trim())),
        }
    }
    let past = if verb == "lock" { "Locked" } else { "Unlocked" };
    if failed.is_empty() {
        return Ok(format!("{past} {}", describe_files(&done)));
    }
    let failures = failed.join("\n");
    if done.is_empty() {
        return Err(if paths.len() == 1 {
            format!("Couldn't {verb} {failures}").into()
        } else {
            format!("Couldn't {verb} these files:\n{failures}").into()
        });
    }
    Err(format!(
        "{past} {}, but couldn't {verb} these:\n{failures}",
        describe_files(&done)
    )
    .into())
}

/// Changed files to look at before committing.
#[derive(Debug, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileChecks {
    /// Big files that aren't stored with Git LFS: committed like this, everyone who
    /// clones the repository downloads them forever.
    pub large: Vec<LargeFile>,
    /// Files marked `lockable` in `.gitattributes`.
    pub lockable: Vec<String>,
    /// The repository uses Git LFS.
    pub uses_lfs: bool,
    /// New files whose names will cause trouble on Windows or macOS.
    pub names: Vec<super::NameProblem>,
    /// In a Unity project: files whose `.meta` is missing, orphaned or left behind.
    pub metas: Vec<super::MetaProblem>,
}

/// A big file that isn't stored with Git LFS.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LargeFile {
    pub path: String,
    /// In bytes.
    pub size: u64,
}

/// Look at changed `files` (paths in the repository): which are at least `threshold`
/// bytes and not in Git LFS, which are lockable, whose names won't work everywhere, and in
/// a Unity project, whose `.meta` files are wrong (with the `deleted` files too).
pub fn file_checks(
    path: &Path,
    files: &[String],
    deleted: &[String],
    threshold: u64,
) -> Result<FileChecks, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let Some(workdir) = repo.workdir().map(Path::to_owned) else {
        return Ok(FileChecks::default());
    };
    let uses_lfs = crate::locks::uses_lfs(&workdir);
    let git = Git::find(workdir.clone())?;
    // A new folder is listed as one entry: look at the new files inside it.
    let folders: Vec<&str> = files
        .iter()
        .map(String::as_str)
        .filter(|file| file.ends_with('/') && !file.starts_with('-'))
        .collect();
    let mut inside = String::new();
    for batch in in_batches(&folders) {
        let mut args = vec!["ls-files", "--others", "--exclude-standard", "-z", "--"];
        args.extend(batch);
        inside.push_str(&git.run_with_env(&args, &LITERAL).unwrap_or_default());
    }
    let files: Vec<&str> = files
        .iter()
        .map(String::as_str)
        .chain(inside.split('\0').take(5000))
        .filter(|file| !file.is_empty() && !file.ends_with('/') && !file.starts_with('-'))
        .collect();
    if files.is_empty() {
        return Ok(FileChecks {
            uses_lfs,
            ..FileChecks::default()
        });
    }
    let mut in_lfs = std::collections::HashSet::new();
    let mut lockable = Vec::new();
    for batch in in_batches(&files) {
        let mut args = vec!["check-attr", "-z", "filter", "lockable", "--"];
        args.extend(batch);
        let output = git.run(&args)?;
        // "<path>\0<attribute>\0<value>\0" for each path and attribute.
        let parts: Vec<&str> = output.split('\0').collect();
        for record in parts.chunks(3) {
            if let [file, attribute, value] = record {
                match (*attribute, *value) {
                    ("filter", "lfs") => {
                        in_lfs.insert(file.to_string());
                    }
                    ("lockable", "set") => lockable.push(file.to_string()),
                    _ => {}
                }
            }
        }
    }
    let names = super::file_names::name_problems(&repo, &files);
    let metas = match super::unity::find_project(&workdir) {
        Some((project, _)) => {
            let assets = project
                .join("Assets")
                .strip_prefix(&workdir)
                .map(|rel| rel.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            let deleted: Vec<&str> = deleted.iter().map(String::as_str).collect();
            super::unity_meta::meta_problems(&workdir, &assets, &files, &deleted)
        }
        None => Vec::new(),
    };
    let large = files
        .iter()
        .filter(|file| !in_lfs.contains(**file))
        .filter_map(|file| {
            let size = std::fs::metadata(workdir.join(file)).ok()?.len();
            (size >= threshold).then(|| LargeFile {
                path: (*file).to_owned(),
                size,
            })
        })
        .collect();
    Ok(FileChecks {
        large,
        lockable,
        uses_lfs,
        names,
        metas,
    })
}

/// The Git LFS files kept on this computer.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LfsStorage {
    pub bytes: u64,
    pub files: u64,
    /// Where they are.
    pub folder: String,
}

/// How much space the local copies of Git LFS files take, if the repository uses LFS.
pub fn lfs_storage_of(path: &Path) -> Result<Option<LfsStorage>, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let Some(workdir) = repo.workdir().map(Path::to_owned) else {
        return Ok(None);
    };
    if !crate::locks::uses_lfs(&workdir) {
        return Ok(None);
    }
    Ok(lfs_storage(&Git::find(workdir)?))
}

pub(super) fn lfs_storage(git: &Git) -> Option<LfsStorage> {
    let env = git.run(&["lfs", "env"]).ok()?;
    let folder = env
        .lines()
        .find_map(|line| line.trim().strip_prefix("LocalMediaDir="))?
        .trim()
        .to_owned();
    fn walk(dir: &Path, total: &mut (u64, u64)) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                walk(&entry.path(), total);
            } else if kind.is_file()
                && let Ok(metadata) = entry.metadata()
            {
                total.0 += metadata.len();
                total.1 += 1;
            }
        }
    }
    let mut total = (0, 0);
    walk(Path::new(&folder), &mut total);
    Some(LfsStorage {
        bytes: total.0,
        files: total.1,
        folder,
    })
}
