//! What changed on the remote branches you follow since you last had a repository open:
//! how many commits arrived and who wrote them, the pull (or merge) requests merged, and
//! which of your locked files changed. Asked of git rather than worked out from the commits
//! the list has loaded, so it's right however many arrived.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::git::Git;

/// At most this many people are named, merged requests and changed files listed, and
/// locked files asked about.
const MOST_PEOPLE: usize = 20;
const MOST_MERGED: usize = 20;
const MOST_PATHS: usize = 200;

/// Where a remote branch pointed when you last had the repository open.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SeenTip {
    /// Like "origin/main".
    pub branch: String,
    pub commit: String,
}

/// What arrived on a remote branch since you saw it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SinceThen {
    /// Like "origin/main".
    pub branch: String,
    /// Where it pointed then: where you left off.
    pub was: String,
    /// Where it points now.
    pub tip: String,
    /// How many commits it has that it didn't then, not counting yours.
    pub commits: u32,
    /// Who wrote them, most commits first (the first few), and how many people did.
    pub people: Vec<SincePerson>,
    pub people_count: u32,
    /// The pull (or merge) requests merged into it, newest first.
    pub merged: Vec<SinceMerged>,
    /// Which of the files asked about someone else changed, and in which commit (its newest).
    pub changed: Vec<SinceChangedFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SincePerson {
    pub name: String,
    pub commits: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SinceMerged {
    /// "#" for a GitHub pull request, "!" for a GitLab merge request.
    pub sign: String,
    pub number: u64,
    pub title: String,
    /// The commit that merged it.
    pub commit: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SinceChangedFile {
    pub path: String,
    pub commit: String,
    pub author: String,
}

fn is_commit_id(id: &str) -> bool {
    id.len() == 40 && id.chars().all(|c| c.is_ascii_hexdigit())
}

/// What arrived on each of `seen`'s branches since it pointed where `seen` says, with which
/// of `paths` (your locked files) changed. Branches that haven't moved, that are gone, or
/// whose old commit git no longer has, are left out.
pub fn since_then(path: &Path, seen: Vec<SeenTip>, paths: Vec<String>) -> Result<Vec<SinceThen>> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    // Your own commits (pushed from here or elsewhere) aren't news.
    let me = git
        .run(&["config", "user.email"])
        .map(|email| email.trim().to_lowercase())
        .unwrap_or_default();
    let paths: Vec<&str> = paths
        .iter()
        .map(String::as_str)
        .filter(|path| !path.is_empty() && !path.starts_with('-'))
        .take(MOST_PATHS)
        .collect();
    let mut found = Vec::new();
    for SeenTip {
        branch,
        commit: was,
    } in seen
    {
        if !is_commit_id(&was) || branch.starts_with('-') || branch.contains("..") {
            continue;
        }
        let Ok(tip) = git.run(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/remotes/{branch}^{{commit}}"),
        ]) else {
            continue;
        };
        let tip = tip.trim().to_owned();
        if tip == was
            || git
                .run(&["cat-file", "-e", &format!("{was}^{{commit}}")])
                .is_err()
        {
            continue;
        }
        let range = format!("{was}..{tip}");
        let all: u32 = git
            .run(&["rev-list", "--count", &range])?
            .trim()
            .parse()
            .unwrap_or(0);
        let (people, people_count, mine) =
            people(&git.run(&["shortlog", "-s", "-n", "-e", &range])?, &me);
        let commits = all.saturating_sub(mine);
        if commits == 0 {
            continue;
        }
        let merged = merged(&git.run(&[
            "log",
            "--first-parent",
            "--format=%H%x1f%s%x1f%b%x1e",
            &range,
        ])?);
        let changed = if paths.is_empty() {
            Vec::new()
        } else {
            let mut args = vec![
                "log",
                "--format=%x1e%H%x1f%aN%x1f%aE",
                "--name-only",
                &range,
                "--",
            ];
            args.extend(paths.iter().copied());
            changed(&git.run(&args)?, &me)
        };
        found.push(SinceThen {
            branch,
            was,
            tip,
            commits,
            people,
            people_count,
            merged,
            changed,
        });
    }
    Ok(found)
}

/// `git shortlog -s -n -e`'s lines ("    12\tRosa Bell <rosa@example.com>") as people, most
/// commits first, without you (`me`, your address): the first few, how many there are, and
/// how many commits are yours.
fn people(shortlog: &str, me: &str) -> (Vec<SincePerson>, u32, u32) {
    let mut by_name: Vec<SincePerson> = Vec::new();
    let mut mine = 0;
    for line in shortlog.lines() {
        let Some((count, who)) = line.trim().split_once('\t') else {
            continue;
        };
        let Ok(commits) = count.trim().parse::<u32>() else {
            continue;
        };
        let (name, email) = who.rsplit_once(" <").unwrap_or((who, ""));
        if !me.is_empty() && email.trim_end_matches('>').eq_ignore_ascii_case(me) {
            mine += commits;
            continue;
        }
        let name = name.trim();
        match by_name.iter_mut().find(|person| person.name == name) {
            Some(person) => person.commits += commits,
            None => by_name.push(SincePerson {
                name: name.to_owned(),
                commits,
            }),
        }
    }
    by_name.sort_by(|a, b| b.commits.cmp(&a.commits).then_with(|| a.name.cmp(&b.name)));
    let count = by_name.len() as u32;
    by_name.truncate(MOST_PEOPLE);
    (by_name, count, mine)
}

/// The number in "#12" or "!12" at the start of `text`.
fn number_after(text: &str) -> Option<u64> {
    let digits: String = text.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// The pull (or merge) requests that first-parent commits merged, by their messages:
/// GitHub's "Merge pull request #12 from …" (its title on the next line), a squashed one's
/// "Title (#12)", and GitLab's "See merge request group/project!12" (its title first).
fn merged(log: &str) -> Vec<SinceMerged> {
    let mut found = Vec::new();
    for record in log.split('\u{1e}') {
        let mut fields = record.trim_start_matches('\n').splitn(3, '\u{1f}');
        let (Some(commit), Some(subject), body) =
            (fields.next(), fields.next(), fields.next().unwrap_or(""))
        else {
            continue;
        };
        let first_line = body.lines().map(str::trim).find(|line| !line.is_empty());
        let request = if let Some(rest) = subject.strip_prefix("Merge pull request #") {
            number_after(rest).map(|number| ("#", number, first_line.unwrap_or(subject).to_owned()))
        } else if let Some(at) = body.find("See merge request ") {
            let reference = &body[at + "See merge request ".len()..];
            reference
                .split_once('!')
                .and_then(|(_, rest)| number_after(rest))
                .map(|number| {
                    let title = first_line
                        .filter(|line| !line.starts_with("See merge request"))
                        .unwrap_or(subject);
                    ("!", number, title.to_owned())
                })
        } else if let Some(open) = subject.rfind(" (#")
            && subject.ends_with(')')
        {
            number_after(&subject[open + 3..])
                .map(|number| ("#", number, subject[..open].to_owned()))
        } else {
            None
        };
        if let Some((sign, number, title)) = request {
            found.push(SinceMerged {
                sign: sign.to_owned(),
                number,
                title,
                commit: commit.trim().to_owned(),
            });
        }
        if found.len() == MOST_MERGED {
            break;
        }
    }
    found
}

/// For each file `git log --format=%x1e%H%x1f%aN%x1f%aE --name-only` names, its newest
/// commit by someone other than you (`me`, your address).
fn changed(log: &str, me: &str) -> Vec<SinceChangedFile> {
    let mut newest: HashMap<String, SinceChangedFile> = HashMap::new();
    let mut order = Vec::new();
    for record in log.split('\u{1e}') {
        let mut lines = record.lines();
        let Some(head) = lines.next() else {
            continue;
        };
        let mut fields = head.split('\u{1f}');
        let (Some(commit), Some(author), email) =
            (fields.next(), fields.next(), fields.next().unwrap_or(""))
        else {
            continue;
        };
        if !me.is_empty() && email.eq_ignore_ascii_case(me) {
            continue;
        }
        for path in lines.map(str::trim).filter(|line| !line.is_empty()) {
            if !newest.contains_key(path) {
                order.push(path.to_owned());
                newest.insert(
                    path.to_owned(),
                    SinceChangedFile {
                        path: path.to_owned(),
                        commit: commit.to_owned(),
                        author: author.to_owned(),
                    },
                );
            }
        }
    }
    order
        .into_iter()
        .filter_map(|path| newest.remove(&path))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_each_persons_commits_most_first_without_yours() {
        let shortlog = "    12\tTheo Park <theo@example.com>\n     5\tSam Okafor <Sam@Example.com>\n     4\tRosa Bell <rosa@example.com>\n     2\tTheo Park <theo@studio.example>\n";
        let person = |name: &str, commits| SincePerson {
            name: name.into(),
            commits,
        };
        assert_eq!(
            people(shortlog, "sam@example.com"),
            (vec![person("Theo Park", 14), person("Rosa Bell", 4)], 2, 5)
        );
        assert_eq!(people(shortlog, "").1, 3);
    }

    #[test]
    fn finds_merged_pull_and_merge_requests() {
        let log = "a1\u{1f}Merge pull request #11 from example/stool\u{1f}A sturdier stool\n\u{1e}\n\
            b2\u{1f}Paint the tavern sign (#9)\u{1f}\u{1e}\n\
            c3\u{1f}Merge branch 'door' into 'main'\u{1f}Make the door creak\n\nSee merge request feast/tavern!7\u{1e}\n\
            d4\u{1f}Furnish the tavern\u{1f}\u{1e}\n";
        assert_eq!(
            merged(log),
            vec![
                SinceMerged {
                    sign: "#".into(),
                    number: 11,
                    title: "A sturdier stool".into(),
                    commit: "a1".into()
                },
                SinceMerged {
                    sign: "#".into(),
                    number: 9,
                    title: "Paint the tavern sign".into(),
                    commit: "b2".into()
                },
                SinceMerged {
                    sign: "!".into(),
                    number: 7,
                    title: "Make the door creak".into(),
                    commit: "c3".into()
                },
            ]
        );
    }

    #[test]
    fn keeps_each_files_newest_change_by_someone_else() {
        let log = "\u{1e}n0\u{1f}Sam Okafor\u{1f}sam@example.com\n\nContent/Barber.uasset\n\n\
            \u{1e}n1\u{1f}Theo Park\u{1f}theo@example.com\n\nContent/Barber.uasset\n\n\
            \u{1e}n2\u{1f}Rosa Bell\u{1f}rosa@example.com\n\nContent/Barber.uasset\nMaps/Tavern.umap\n";
        let file = |path: &str, commit: &str, author: &str| SinceChangedFile {
            path: path.into(),
            commit: commit.into(),
            author: author.into(),
        };
        assert_eq!(
            changed(log, "sam@example.com"),
            vec![
                file("Content/Barber.uasset", "n1", "Theo Park"),
                file("Maps/Tavern.umap", "n2", "Rosa Bell"),
            ]
        );
    }

    /// git in `dir`, as someone made up, without the machine's own settings.
    fn git(dir: &Path, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Rosa Bell")
            .env("GIT_AUTHOR_EMAIL", "rosa@example.com")
            .env("GIT_COMMITTER_NAME", "Rosa Bell")
            .env("GIT_COMMITTER_EMAIL", "rosa@example.com")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    #[test]
    fn says_what_arrived_on_a_remote_branch() {
        let folder = std::env::temp_dir().join(format!("tributary-since-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        let dir = folder.as_path();
        git(dir, &["init", "-q", "-b", "main"]);
        // Whoever runs the tests isn't anyone who wrote these commits.
        git(dir, &["config", "user.email", "sam@example.com"]);
        std::fs::write(dir.join("Barber.uasset"), "v1").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "Add the barber"]);
        let was = git(dir, &["rev-parse", "HEAD"]);
        git(
            dir,
            &[
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "Paint the tavern sign (#9)",
            ],
        );
        std::fs::write(dir.join("Barber.uasset"), "v2").unwrap();
        git(dir, &["commit", "-q", "-am", "Shorter beard"]);
        let tip = git(dir, &["rev-parse", "HEAD"]);
        git(dir, &["update-ref", "refs/remotes/origin/main", &tip]);
        let seen = |commit: &str| {
            vec![SeenTip {
                branch: "origin/main".into(),
                commit: commit.into(),
            }]
        };
        let found = since_then(
            dir,
            seen(&was),
            vec!["Barber.uasset".into(), "Tavern.umap".into()],
        )
        .unwrap();
        assert_eq!(found.len(), 1);
        let since = &found[0];
        assert_eq!(
            (since.was.as_str(), since.tip.as_str(), since.commits),
            (was.as_str(), tip.as_str(), 2)
        );
        assert_eq!(
            since.people,
            vec![SincePerson {
                name: "Rosa Bell".into(),
                commits: 2
            }]
        );
        assert_eq!(
            since.merged.iter().map(|m| m.number).collect::<Vec<_>>(),
            [9]
        );
        assert_eq!(
            since
                .changed
                .iter()
                .map(|c| (c.path.as_str(), c.commit.as_str()))
                .collect::<Vec<_>>(),
            [("Barber.uasset", tip.as_str())]
        );
        // Nothing moved, a branch that isn't there, and an old commit that isn't a commit id.
        assert!(since_then(dir, seen(&tip), vec![]).unwrap().is_empty());
        let gone = vec![SeenTip {
            branch: "origin/gone".into(),
            commit: was.clone(),
        }];
        assert!(since_then(dir, gone, vec![]).unwrap().is_empty());
        assert!(since_then(dir, seen("--all"), vec![]).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&folder);
    }
}
