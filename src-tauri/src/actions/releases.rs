//! Release notes: what went into a release, between the tag before it and its own. Each
//! change on the main line once: a pull request merged into it (by its title and number),
//! or a commit made on it directly; and who contributed.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::validate::revision_name;
use crate::error::{Error, Result};
use crate::git::Git;

/// At most this many changes are listed.
const MOST_ITEMS: usize = 500;

/// What went into a release, between the tag before it and its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotes {
    /// The tag (or commit) they start after; None when there's no earlier tag.
    pub from: Option<String>,
    pub to: String,
    /// The earlier tags in its history, newest first, to start from instead.
    pub earlier: Vec<String>,
    /// Each change on the main line, newest first.
    pub items: Vec<ReleaseItem>,
    /// Who made its commits, most commits first.
    pub contributors: Vec<String>,
    /// How many commits it has in all.
    pub commits: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseItem {
    pub title: String,
    /// Its pull request's number (GitHub `#12`) or merge request's (GitLab `!12`).
    pub number: Option<String>,
    pub author: String,
    /// The commit (a merge, or the change itself).
    pub id: String,
    /// The rest of its message, for issue keys mentioned there.
    pub body: String,
}

/// A change on the main line, from its commit's summary and body; None for merges that
/// aren't pull requests ("Merge branch 'main' into …"), which are bookkeeping.
fn item(id: &str, summary: &str, body: &str, author: &str, parents: usize) -> Option<ReleaseItem> {
    let first_line = body.lines().map(str::trim).find(|line| !line.is_empty());
    let make = |title: &str, number: Option<String>| ReleaseItem {
        title: title.trim().to_owned(),
        number,
        author: author.to_owned(),
        id: id.to_owned(),
        body: body.trim().to_owned(),
    };
    // GitHub: "Merge pull request #12 from studio/fix-door", titled in the body.
    if let Some(rest) = summary.strip_prefix("Merge pull request #") {
        let (number, from) = rest.split_once(' ').unwrap_or((rest, ""));
        let branch = from.trim().strip_prefix("from ").unwrap_or(from);
        return Some(make(
            first_line.unwrap_or(branch),
            Some(format!("#{number}")),
        ));
    }
    if parents > 1 {
        // GitLab: "Merge branch 'fix-door' into 'main'", with "See merge request group/feast!12".
        let request = body
            .lines()
            .find_map(|line| line.trim().strip_prefix("See merge request "))
            .and_then(|link| link.rsplit_once('!'))
            .map(|(_, number)| format!("!{}", number.trim()));
        return request.map(|number| {
            let title = body
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && !line.starts_with("See merge request"))
                .unwrap_or(summary);
            make(title, Some(number))
        });
    }
    // A squash merge: "Make the door creak (#12)".
    if let Some((title, number)) = summary
        .trim_end()
        .strip_suffix(')')
        .and_then(|s| s.rsplit_once(" (#"))
        && !number.is_empty()
        && number.chars().all(|c| c.is_ascii_digit())
    {
        return Some(make(title, Some(format!("#{number}"))));
    }
    Some(make(summary, None))
}

/// `git log --format=%H%x1f%P%x1f%an%x1f%s%x1f%b%x1e` as changes. A pull request merged
/// without a title in its message also comes with the range of its own commits, to name it
/// by the first of them.
fn items_from(log: &str) -> Vec<(ReleaseItem, Option<String>)> {
    log.split('\x1e')
        .filter_map(|entry| {
            let mut parts = entry.trim_start_matches('\n').splitn(5, '\x1f');
            let (id, parents, author, summary, body) = (
                parts.next()?,
                parts.next()?,
                parts.next()?,
                parts.next()?,
                parts.next().unwrap_or(""),
            );
            if id.is_empty() {
                return None;
            }
            let parents: Vec<&str> = parents.split_whitespace().collect();
            let item = item(id, summary, body, author, parents.len())?;
            let untitled = summary.starts_with("Merge pull request #") && body.trim().is_empty();
            let range = match parents.as_slice() {
                [main, merged] if untitled => Some(format!("{main}..{merged}")),
                _ => None,
            };
            Some((item, range))
        })
        .take(MOST_ITEMS)
        .collect()
}

/// What went into `to` (a tag, branch or commit) since `from` (the tag before it when None).
pub fn release_notes(path: &Path, to: &str, from: Option<&str>) -> Result<ReleaseNotes> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    let to = revision_name(&repo, to)?;
    // The tags in its history before it, newest first (its own isn't one of them).
    let own: Vec<String> = git
        .run(&["tag", "--points-at", &to])
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect();
    let earlier: Vec<String> = git
        .run(&["tag", "--merged", &to, "--sort=-creatordate"])
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .filter(|tag| !tag.is_empty() && !own.contains(tag) && !tag.starts_with('-'))
        .take(30)
        .collect();
    let from = match from {
        Some(from) => Some(revision_name(&repo, from)?),
        None => earlier.first().cloned(),
    };
    let range = match &from {
        Some(from) => format!("{from}..{to}"),
        None => to.clone(),
    };
    let log = git.run(&[
        "log",
        "--first-parent",
        "--format=%H%x1f%P%x1f%an%x1f%s%x1f%b%x1e",
        &format!("--max-count={MOST_ITEMS}"),
        &range,
        "--",
    ])?;
    let authors = git
        .run(&["shortlog", "-sn", "--no-merges", &range, "--"])
        .unwrap_or_default();
    let contributors: Vec<String> = authors
        .lines()
        .filter_map(|line| {
            line.trim()
                .split_once('\t')
                .map(|(_, name)| name.trim().to_owned())
        })
        .collect();
    let commits = git
        .run(&["rev-list", "--count", &range, "--"])
        .ok()
        .and_then(|n| n.trim().parse().ok())
        .unwrap_or(0);
    let items = items_from(&log)
        .into_iter()
        .map(|(mut item, range)| {
            // Untitled: named by its branch's first commit.
            if let Some(range) = range {
                let first = git
                    .run(&[
                        "log",
                        "--reverse",
                        "--no-merges",
                        "--format=%s",
                        &range,
                        "--",
                    ])
                    .ok()
                    .and_then(|log| log.lines().next().map(str::to_owned))
                    .filter(|summary| !summary.trim().is_empty());
                if let Some(first) = first {
                    item.title = first;
                }
            }
            item
        })
        .collect();
    Ok(ReleaseNotes {
        from,
        to,
        earlier,
        items,
        contributors,
        commits,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_pull_requests_merges_and_squashes() {
        let pr = item(
            "a",
            "Merge pull request #18 from studio/feature/sync",
            "Sync notes between devices\n",
            "Maya Chen",
            2,
        )
        .unwrap();
        assert_eq!(
            (pr.title.as_str(), pr.number.as_deref()),
            ("Sync notes between devices", Some("#18"))
        );
        let gitlab = item(
            "b",
            "Merge branch 'fix-door' into 'main'",
            "Make the door creak\n\nSee merge request studio/feast!12",
            "Theo Park",
            2,
        )
        .unwrap();
        assert_eq!(
            (gitlab.title.as_str(), gitlab.number.as_deref()),
            ("Make the door creak", Some("!12"))
        );
        assert!(
            item(
                "c",
                "Merge branch 'main' into feature/sync",
                "",
                "Diego Ramos",
                2
            )
            .is_none()
        );
        let squash = item("d", "Pad the stool's seat (#21)", "", "Rosa Bell", 1).unwrap();
        assert_eq!(
            (squash.title.as_str(), squash.number.as_deref()),
            ("Pad the stool's seat", Some("#21"))
        );
        let plain = item(
            "e",
            "Fix the counter (in the sidebar)",
            "",
            "Lena Fischer",
            1,
        )
        .unwrap();
        assert_eq!(
            (plain.title.as_str(), plain.number),
            ("Fix the counter (in the sidebar)", None)
        );
    }
}
