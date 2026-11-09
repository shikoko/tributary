//! What the team has been doing lately: who committed where, on which branches, and how
//! far those branches are from the main one.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::git::Git;

/// At most this many branches are looked at, the most recently changed first.
const MAX_BRANCHES: usize = 40;
/// At most this many commit times are kept for each person and branch.
const MAX_TIMES: usize = 2000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamActivity {
    /// Since when (seconds since the Unix epoch), and over how many days.
    pub since: i64,
    pub days: u32,
    /// The branch the others are compared with, like "origin/main".
    pub main: String,
    /// Everyone who committed since then, the most recently active first.
    pub people: Vec<TeamPerson>,
    /// Branches with commits since then (other than `main`), the most recent first.
    pub branches: Vec<BranchActivity>,
    /// Commits on `main` itself since then.
    pub main_commits: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPerson {
    pub name: String,
    pub email: String,
    pub commits: usize,
    /// When they last committed.
    pub latest: i64,
    /// The branches they committed to (`main` included).
    pub branches: Vec<String>,
    /// When each of their commits was made, the newest first.
    pub times: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchActivity {
    /// Like "origin/feature/export", or a local branch that isn't pushed.
    pub name: String,
    pub tip: String,
    pub latest: i64,
    /// Commits it has that `main` doesn't, and the other way round.
    pub ahead: usize,
    pub behind: usize,
    /// How many files it changed since it split from `main`.
    pub files: usize,
    /// Who committed to it since then, the busiest first.
    pub people: Vec<BranchPerson>,
    /// When each of its own commits since then was made, the newest first.
    pub times: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPerson {
    pub name: String,
    pub email: String,
    pub commits: usize,
}

/// The branch to compare the others with: the remote's default, or main or master.
fn main_branch(git: &Git) -> String {
    if let Ok(name) = git.run(&[
        "symbolic-ref",
        "--quiet",
        "--short",
        "refs/remotes/origin/HEAD",
    ]) {
        let name = name.trim();
        if !name.is_empty() {
            return name.to_owned();
        }
    }
    for candidate in ["origin/main", "origin/master", "main", "master"] {
        if git
            .run(&[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{candidate}^{{commit}}"),
            ])
            .is_ok()
        {
            return candidate.to_owned();
        }
    }
    "HEAD".to_owned()
}

/// One commit: id, author's name and email, and when.
fn commits(git: &Git, args: &[&str]) -> Vec<(String, String, String, i64)> {
    let mut all = vec!["log", "--format=%H%x1f%an%x1f%ae%x1f%at"];
    all.extend(args);
    let Ok(output) = git.run(&all) else {
        return Vec::new();
    };
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\u{1f}');
            Some((
                parts.next()?.to_owned(),
                parts.next()?.to_owned(),
                parts.next()?.to_owned(),
                parts.next()?.parse().ok()?,
            ))
        })
        .collect()
}

/// Who committed where in the last `days` days.
pub fn team_activity(path: &Path, days: u32) -> Result<TeamActivity, Error> {
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
    let since_arg = format!("--since=@{since}");
    let main = main_branch(&git);
    let main_full = git
        .run(&["rev-parse", "--symbolic-full-name", &main])
        .map(|name| name.trim().to_owned())
        .unwrap_or_default();

    // Branches changed lately: remote ones, and local ones that aren't on a remote.
    let refs = git.run(&[
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(committerdate:unix)%00%(symref)",
        "refs/remotes",
        "refs/heads",
    ])?;
    let mut remote_names: BTreeSet<String> = BTreeSet::new();
    let mut candidates: Vec<(String, String, String, i64)> = Vec::new();
    for line in refs.lines() {
        let parts: Vec<&str> = line.split('\0').collect();
        let [full, short, id, time, symref] = parts[..] else {
            continue;
        };
        if !symref.is_empty() || full == main_full || short == main {
            continue;
        }
        let time: i64 = time.parse().unwrap_or(0);
        if let Some(rest) = full.strip_prefix("refs/remotes/") {
            // "origin/feature" → "feature", to leave out its local copy.
            remote_names.insert(
                rest.split_once('/')
                    .map_or(rest, |(_, name)| name)
                    .to_owned(),
            );
        }
        candidates.push((full.to_owned(), short.to_owned(), id.to_owned(), time));
    }
    let mut branches = Vec::new();
    let mut people: HashMap<String, TeamPerson> = HashMap::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut count = |id: &str,
                     name: &str,
                     email: &str,
                     time: i64,
                     branch: &str,
                     people: &mut HashMap<String, TeamPerson>| {
        let key = email.to_lowercase();
        let person = people.entry(key).or_insert_with(|| TeamPerson {
            name: name.to_owned(),
            email: email.to_owned(),
            commits: 0,
            latest: 0,
            branches: Vec::new(),
            times: Vec::new(),
        });
        if seen.insert(id.to_owned()) {
            person.commits += 1;
            if person.times.len() < MAX_TIMES {
                person.times.push(time);
            }
        }
        person.latest = person.latest.max(time);
        if !person.branches.iter().any(|b| b == branch) {
            person.branches.push(branch.to_owned());
        }
    };

    for (full, short, tip, latest) in candidates {
        if latest < since || branches.len() >= MAX_BRANCHES {
            continue;
        }
        if full.starts_with("refs/heads/") && remote_names.contains(&short) {
            continue;
        }
        let range = format!("{main}..{tip}");
        let found = commits(&git, &[&since_arg, &range]);
        if found.is_empty() {
            continue;
        }
        let mut by_person: HashMap<String, BranchPerson> = HashMap::new();
        for (id, name, email, time) in &found {
            count(id, name, email, *time, &short, &mut people);
            by_person
                .entry(email.to_lowercase())
                .or_insert_with(|| BranchPerson {
                    name: name.clone(),
                    email: email.clone(),
                    commits: 0,
                })
                .commits += 1;
        }
        let mut branch_people: Vec<BranchPerson> = by_person.into_values().collect();
        branch_people.sort_by(|a, b| b.commits.cmp(&a.commits).then_with(|| a.name.cmp(&b.name)));
        let (behind, ahead) = git
            .run(&[
                "rev-list",
                "--left-right",
                "--count",
                &format!("{main}...{tip}"),
            ])
            .ok()
            .and_then(|counts| {
                let mut numbers = counts.split_whitespace().map(|n| n.parse::<usize>().ok());
                Some((numbers.next()??, numbers.next()??))
            })
            .unwrap_or((0, 0));
        let files = git
            .run(&[
                "diff",
                "--name-only",
                "--no-renames",
                &format!("{main}...{tip}"),
            ])
            .map(|names| names.lines().filter(|line| !line.is_empty()).count())
            .unwrap_or(0);
        let times = found.iter().map(|commit| commit.3).take(MAX_TIMES).collect();
        branches.push(BranchActivity {
            name: short,
            tip,
            latest,
            ahead,
            behind,
            files,
            people: branch_people,
            times,
        });
    }

    let on_main = commits(&git, &[&since_arg, &main]);
    for (id, name, email, time) in &on_main {
        count(id, name, email, *time, &main, &mut people);
    }
    let mut people: Vec<TeamPerson> = people.into_values().collect();
    for person in &mut people {
        person.times.sort_unstable_by(|a, b| b.cmp(a));
    }
    people.sort_by(|a, b| b.latest.cmp(&a.latest).then_with(|| a.name.cmp(&b.name)));
    Ok(TeamActivity {
        since,
        days: days.clamp(1, 365),
        main,
        people,
        branches,
        main_commits: on_main.len(),
    })
}
