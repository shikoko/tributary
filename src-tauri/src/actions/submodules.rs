//! Submodules: other repositories kept inside this one, each at a commit this
//! repository records. After a pull or a checkout changes that commit, git leaves the
//! submodule where it was until it's updated, which is easy to miss.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

use super::support::LITERAL;
use super::validate::check_file_paths;
use crate::error::{Error, Result};
use crate::git::{Git, Progress};

/// Where a submodule is, compared with the commit this repository records for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SubmoduleState {
    /// Not cloned and checked out yet (`git submodule update --init` does that).
    NotSetUp,
    /// At the recorded commit.
    UpToDate,
    /// Behind the recorded commit: a pull or checkout moved it, and it wasn't updated.
    Behind,
    /// Ahead of it: new commits in the submodule, to record here with a commit.
    Ahead,
    /// Somewhere else entirely.
    Different,
    /// The recorded commit conflicts (a merge or rebase changed it on both sides).
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    /// Its name in `.gitmodules` (usually its path).
    pub name: String,
    /// Its folder, relative to this repository's.
    pub path: String,
    pub url: Option<String>,
    pub state: SubmoduleState,
    /// The commit this repository records for it.
    pub recorded: Option<String>,
    /// The commit checked out in it.
    pub current: Option<String>,
    /// Commits the recorded one has that the checked-out one doesn't, and the other way round.
    pub behind: u32,
    pub ahead: u32,
    /// It has uncommitted changes of its own.
    pub changed: bool,
}

/// The submodules of the repository at `path`, in the order `.gitmodules` lists them.
pub fn submodules(path: &Path) -> Result<Vec<Submodule>, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let Some(workdir) = repo.workdir().map(Path::to_owned) else {
        return Ok(Vec::new());
    };
    if !workdir.join(".gitmodules").is_file() {
        return Ok(Vec::new());
    }
    let git = Git::find(workdir.clone())?.in_background();
    let declared = declared(&git)?;
    let recorded = recorded(&git, &declared);
    let mut list = Vec::new();
    for (name, path, url) in declared {
        let stages = recorded.get(&path).cloned().unwrap_or_default();
        // A submodule's own repository: a `.git` file (or folder) in its folder.
        let folder = workdir.join(&path);
        let inside = folder
            .join(".git")
            .exists()
            .then(|| Git::find(folder.clone()).map(|git| git.in_background()))
            .and_then(Result::ok);
        let current = inside.as_ref().and_then(|git| {
            git.run(&["rev-parse", "--verify", "--quiet", "HEAD"])
                .ok()
                .map(|id| id.trim().to_owned())
        });
        let recorded = stages.first().cloned();
        let mut submodule = Submodule {
            name,
            path,
            url,
            state: SubmoduleState::UpToDate,
            recorded: recorded.clone(),
            current: current.clone(),
            behind: 0,
            ahead: 0,
            changed: false,
        };
        submodule.state = match (&inside, &current, &recorded) {
            _ if stages.len() > 1 => SubmoduleState::Conflicted,
            (Some(inside), Some(current), Some(recorded)) => {
                submodule.changed = inside
                    .run(&["status", "--porcelain", "--ignore-submodules=dirty"])
                    .is_ok_and(|status| !status.trim().is_empty());
                if current == recorded {
                    SubmoduleState::UpToDate
                } else {
                    let (behind, ahead) = distance(inside, recorded, current);
                    submodule.behind = behind;
                    submodule.ahead = ahead;
                    match (behind, ahead) {
                        // (0, 0) too: the recorded commit isn't fetched yet.
                        (_, 0) => SubmoduleState::Behind,
                        (0, _) => SubmoduleState::Ahead,
                        _ => SubmoduleState::Different,
                    }
                }
            }
            _ => SubmoduleState::NotSetUp,
        };
        list.push(submodule);
    }
    Ok(list)
}

/// The submodules `.gitmodules` declares: (name, path, url).
fn declared(git: &Git) -> Result<Vec<(String, String, Option<String>)>> {
    // "submodule.<name>.<key>\n<value>\0" for each setting. Names can have dots in them.
    let listing = git
        .run(&[
            "config",
            "--file",
            ".gitmodules",
            "--null",
            "--get-regexp",
            r"^submodule\..*\.(path|url)$",
        ])
        .unwrap_or_default();
    let mut order: Vec<String> = Vec::new();
    let mut settings: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    for entry in listing.split('\0') {
        let Some((key, value)) = entry.split_once('\n') else {
            continue;
        };
        let Some(rest) = key.strip_prefix("submodule.") else {
            continue;
        };
        let Some((name, setting)) = rest.rsplit_once('.') else {
            continue;
        };
        if !settings.contains_key(name) {
            order.push(name.to_owned());
        }
        let entry = settings.entry(name.to_owned()).or_default();
        match setting {
            "path" => entry.0 = Some(value.trim_end_matches('/').to_owned()),
            "url" => entry.1 = Some(value.to_owned()),
            _ => {}
        }
    }
    Ok(order
        .into_iter()
        .filter_map(|name| {
            let (path, url) = settings.remove(&name)?;
            Some((name, path?, url))
        })
        .collect())
}

/// The commits recorded for each submodule's path: one, or more while it's conflicted.
fn recorded(
    git: &Git,
    declared: &[(String, String, Option<String>)],
) -> HashMap<String, Vec<String>> {
    let mut args = vec!["ls-files", "--stage", "-z", "--"];
    args.extend(declared.iter().map(|(_, path, _)| path.as_str()));
    let listing = git.run_with_env(&args, &LITERAL).unwrap_or_default();
    let mut found: HashMap<String, Vec<String>> = HashMap::new();
    // "<mode> <id> <stage>\t<path>\0"
    for entry in listing.split('\0') {
        let Some((info, path)) = entry.split_once('\t') else {
            continue;
        };
        let mut parts = info.split(' ');
        if let (Some("160000"), Some(id)) = (parts.next(), parts.next()) {
            found
                .entry(path.to_owned())
                .or_default()
                .push(id.to_owned());
        }
    }
    found
}

/// How far `current` is behind and ahead of `recorded`. (0, 0) when they can't be
/// compared (the recorded commit isn't in the submodule yet).
fn distance(inside: &Git, recorded: &str, current: &str) -> (u32, u32) {
    let range = format!("{recorded}...{current}");
    let Ok(counts) = inside.run(&["rev-list", "--left-right", "--count", &range]) else {
        return (0, 0);
    };
    let mut numbers = counts.split_whitespace().map(|n| n.parse().unwrap_or(0));
    (numbers.next().unwrap_or(0), numbers.next().unwrap_or(0))
}

/// Check out the recorded commit in each of `paths` (every submodule, when empty),
/// cloning those that aren't set up yet, and their own submodules too.
pub(super) fn update_submodules(
    git: &Git,
    paths: Vec<String>,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    let paths = if paths.is_empty() {
        Vec::new()
    } else {
        check_file_paths(&paths)?
    };
    let mut args = vec![
        "submodule",
        "update",
        "--init",
        "--recursive",
        "--progress",
        "--",
    ];
    args.extend(paths.iter().copied());
    git.run_progress(&args, on_progress)?;
    Ok(match paths.as_slice() {
        [] => "Updated the submodules".to_owned(),
        [one] => format!("Updated {}", super::support::file_name(one)),
        many => format!("Updated {} submodules", many.len()),
    })
}
