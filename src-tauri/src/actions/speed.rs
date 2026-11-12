//! Git's own speed-ups for big repositories, which it leaves off by default: a file watcher
//! (so checking for changes looks only at files that changed), a cache of folders without
//! new files, a commit graph (for history, counts and merges), and background maintenance.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::support::count;
use crate::error::{Error, Result};
use crate::git::{Git, Progress};

/// From this many files, the speed-ups make a difference worth having.
pub const BIG: u64 = 20_000;

/// One of git's speed-ups.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SpeedUp {
    /// `core.fsmonitor`: git's file watcher (Windows and macOS).
    FileWatcher,
    /// `core.untrackedCache`.
    UntrackedCache,
    /// A commit graph, written now and by each fetch.
    CommitGraph,
    /// `git maintenance start`: tidying in the background, with the system's scheduler.
    Maintenance,
}

/// How big the repository is, and which speed-ups are on.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SpeedSettings {
    /// Files in the index.
    pub files: u64,
    /// Big enough for the speed-ups to matter.
    pub big: bool,
    /// None where git has no file watcher of its own (Linux, or git before 2.36).
    pub file_watcher: Option<bool>,
    pub untracked_cache: bool,
    pub commit_graph: bool,
    pub maintenance: bool,
    /// Like "2.45.1".
    pub git_version: String,
}

/// git's version, as numbers: "git version 2.45.1.windows.1" is [2, 45, 1].
pub(super) fn version(git: &Git) -> (String, Vec<u32>) {
    let text = git.run(&["--version"]).unwrap_or_default();
    let number = text
        .trim()
        .strip_prefix("git version ")
        .unwrap_or("")
        .split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .next()
        .unwrap_or("")
        .trim_end_matches('.')
        .to_owned();
    let parts = number
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect();
    (number, parts)
}

/// Whether git has a file watcher of its own here.
fn has_file_watcher(parts: &[u32]) -> bool {
    (cfg!(windows) || cfg!(target_os = "macos")) && parts >= [2, 36].as_slice()
}

fn config(git: &Git, key: &str) -> Option<String> {
    git.run(&["config", "--get", key])
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn is_true(value: Option<String>) -> bool {
    value.is_some_and(|value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "true" | "yes" | "on" | "1"
        )
    })
}

fn git_dir(git: &Git) -> Result<std::path::PathBuf> {
    let dir = git.run(&["rev-parse", "--git-common-dir"])?;
    Ok(git.workdir().join(dir.trim()))
}

/// The repository's size and speed-ups.
pub fn speed_settings(path: &Path) -> Result<SpeedSettings> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let files = repo
        .index_or_empty()
        .map(|index| index.entries().len() as u64)
        .unwrap_or(0);
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree.")?
        .to_owned();
    let git = Git::find(workdir.clone())?.in_background();
    let (git_version, parts) = version(&git);
    let objects = git_dir(&git)?.join("objects").join("info");
    let graph_written =
        objects.join("commit-graph").is_file() || objects.join("commit-graphs").is_dir();
    let maintained = git
        .run(&["config", "--global", "--get-all", "maintenance.repo"])
        .is_ok_and(|repos| {
            repos.lines().any(|line| {
                Path::new(line.trim()).canonicalize().ok() == workdir.canonicalize().ok()
            })
        });
    Ok(SpeedSettings {
        files,
        big: files >= BIG,
        file_watcher: has_file_watcher(&parts).then(|| is_true(config(&git, "core.fsmonitor"))),
        untracked_cache: is_true(config(&git, "core.untrackedCache")),
        commit_graph: graph_written && is_true(config(&git, "fetch.writeCommitGraph")),
        maintenance: maintained,
        git_version,
    })
}

/// Turn a speed-up on or off in this repository.
pub(super) fn set_speed_up(
    git: &Git,
    which: SpeedUp,
    on: bool,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    match (which, on) {
        (SpeedUp::FileWatcher, true) => {
            let (_, parts) = version(git);
            if !has_file_watcher(&parts) {
                return Err("git has no file watcher of its own here: it needs git 2.36 or later, on Windows or macOS.".into());
            }
            git.run(&["config", "core.fsmonitor", "true"])?;
            Ok("git watches this repository's files now".to_owned())
        }
        (SpeedUp::FileWatcher, false) => {
            let _ = git.run(&["config", "--unset", "core.fsmonitor"]);
            // Its watcher stops (it isn't running when there's none).
            let _ = git.run(&["fsmonitor--daemon", "stop"]);
            Ok("git stopped watching this repository's files".to_owned())
        }
        (SpeedUp::UntrackedCache, true) => {
            git.run(&["config", "core.untrackedCache", "true"])?;
            Ok("git remembers where new files can be now".to_owned())
        }
        (SpeedUp::UntrackedCache, false) => {
            git.run(&["config", "core.untrackedCache", "false"])?;
            Ok("git looks everywhere for new files again".to_owned())
        }
        (SpeedUp::CommitGraph, true) => {
            git.run(&["config", "fetch.writeCommitGraph", "true"])?;
            git.run_progress_with_env(
                &[
                    "commit-graph",
                    "write",
                    "--reachable",
                    "--changed-paths",
                    "--progress",
                ],
                &[],
                on_progress,
            )?;
            Ok("Wrote the commit graph, and fetches keep it up to date".to_owned())
        }
        (SpeedUp::CommitGraph, false) => {
            let _ = git.run(&["config", "--unset", "fetch.writeCommitGraph"]);
            Ok("Fetches don't update the commit graph any more".to_owned())
        }
        (SpeedUp::Maintenance, true) => {
            git.run(&["maintenance", "start"]).map_err(|error| {
                Error::from(format!(
                    "git couldn't schedule its maintenance here: {error}"
                ))
            })?;
            Ok("git tidies this repository in the background now".to_owned())
        }
        (SpeedUp::Maintenance, false) => {
            git.run(&["maintenance", "unregister"])?;
            Ok("git doesn't tidy this repository in the background any more".to_owned())
        }
    }
}

/// Every speed-up there is here, turned on.
pub(super) fn speed_up_all(
    git: &Git,
    path: &Path,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    let settings = speed_settings(path)?;
    let mut turned_on = 0;
    let mut problems = Vec::new();
    let wanted = [
        (SpeedUp::FileWatcher, settings.file_watcher == Some(false)),
        (SpeedUp::UntrackedCache, !settings.untracked_cache),
        (SpeedUp::CommitGraph, !settings.commit_graph),
        (SpeedUp::Maintenance, !settings.maintenance),
    ];
    for (which, off) in wanted {
        if !off {
            continue;
        }
        match set_speed_up(git, which, true, on_progress) {
            Ok(_) => turned_on += 1,
            Err(error) => problems.push(error.to_string()),
        }
    }
    match (turned_on, problems.first()) {
        (0, Some(problem)) => Err(problem.clone().into()),
        (_, Some(problem)) => Ok(format!(
            "Turned on {} ({problem})",
            count(turned_on, "speed-up")
        )),
        _ => Ok(format!("Turned on {}", count(turned_on, "speed-up"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_truthy_settings() {
        assert!(is_true(Some("True".into())));
        assert!(is_true(Some("1".into())));
        assert!(!is_true(Some("false".into())));
        assert!(!is_true(None));
    }

    #[test]
    fn knows_where_git_has_a_file_watcher() {
        let here = cfg!(windows) || cfg!(target_os = "macos");
        assert_eq!(has_file_watcher(&[2, 45, 1]), here);
        assert!(!has_file_watcher(&[2, 35, 9]));
    }
}
