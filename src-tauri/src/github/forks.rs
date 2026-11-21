//! Your forks on GitHub, how far each is behind the repository it was forked from, and
//! syncing one with it. Syncing is GitHub's own Sync fork: GitHub brings the original's new
//! commits into the fork's branch on its side, so nothing is downloaded.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::{HOST, api_request, client};
use crate::accounts::stored_token;
use crate::error::{Error, Result};
use crate::requests::error_message;

/// At most this many pages of your repositories (100 each) are looked through for forks.
const MOST_PAGES: u32 = 5;
/// At most this many of the original's new commits are listed for a fork: the newest.
const MOST_COMMITS: usize = 20;

/// One of your forks on GitHub.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Fork {
    pub owner: String,
    pub name: String,
    /// The branch that's synced: the fork's default branch.
    pub branch: String,
    pub private: bool,
    /// Its page on GitHub.
    pub url: String,
    /// When something was last pushed to it, a sync included (ISO 8601).
    pub pushed: Option<String>,
    /// The repository it's a fork of.
    pub parent: ForkParent,
}

/// The repository a fork was forked from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ForkParent {
    pub owner: String,
    pub name: String,
    /// Its default branch, which the fork's branch is compared with.
    pub branch: String,
    pub url: String,
}

/// Your forks, when you're signed in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Forks {
    /// Whether git keeps a token for GitHub: without one, there's nobody to list forks of.
    pub signed_in: bool,
    /// By name.
    pub forks: Vec<Fork>,
}

/// How a fork's branch compares with its original's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ForkStatus {
    /// The original's commits that the fork doesn't have yet.
    pub new: u32,
    /// The fork's own commits, which the original doesn't have.
    pub own: u32,
    /// The newest of the new commits, the newest first (at most 20).
    pub commits: Vec<ForkCommit>,
}

/// One of the original's commits that a fork doesn't have.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ForkCommit {
    pub id: String,
    /// Its message's first line.
    pub summary: String,
    pub author: String,
    pub email: String,
    /// When it was written (ISO 8601).
    pub date: String,
}

/// What syncing a fork did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SyncOutcome {
    /// Its branch moved on to the original's: it had nothing of its own.
    FastForward,
    /// The original's commits were merged into it with a merge commit: it had its own.
    Merged,
    /// It already had all of the original's commits.
    UpToDate,
    /// Its own changes clash with the original's, so GitHub can't sync it by itself.
    Conflict,
    /// GitHub didn't sync it for another reason, which the message says.
    Refused,
}

/// What syncing a fork did, and GitHub's own words about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ForkSync {
    pub outcome: SyncOutcome,
    pub message: String,
}

#[derive(Deserialize)]
struct RawOwner {
    login: String,
}

#[derive(Deserialize)]
struct RawListed {
    full_name: String,
    #[serde(default)]
    fork: bool,
}

#[derive(Deserialize)]
struct RawRepo {
    name: String,
    owner: RawOwner,
    default_branch: String,
    #[serde(default)]
    private: bool,
    html_url: String,
    pushed_at: Option<String>,
    parent: Option<RawParent>,
}

#[derive(Deserialize)]
struct RawParent {
    name: String,
    owner: RawOwner,
    default_branch: String,
    html_url: String,
}

#[derive(Deserialize)]
struct RawComparison {
    ahead_by: u32,
    behind_by: u32,
    #[serde(default)]
    commits: Vec<RawCommit>,
}

#[derive(Deserialize)]
struct RawCommit {
    sha: String,
    commit: RawCommitInfo,
}

#[derive(Deserialize)]
struct RawCommitInfo {
    message: String,
    author: Option<RawSignature>,
}

#[derive(Deserialize)]
struct RawSignature {
    name: Option<String>,
    email: Option<String>,
    date: Option<String>,
}

/// A repository's own page, as a fork: None when it isn't one.
fn fork_from(raw: RawRepo) -> Option<Fork> {
    let parent = raw.parent?;
    Some(Fork {
        owner: raw.owner.login,
        name: raw.name,
        branch: raw.default_branch,
        private: raw.private,
        url: raw.html_url,
        pushed: raw.pushed_at,
        parent: ForkParent {
            owner: parent.owner.login,
            name: parent.name,
            branch: parent.default_branch,
            url: parent.html_url,
        },
    })
}

/// A comparison of the fork's branch (as the base) with the original's (as the head): what
/// the head has that the base doesn't is new to the fork. GitHub lists those commits oldest
/// first, so the newest are at the end.
fn status_from(raw: RawComparison) -> ForkStatus {
    let commits = raw
        .commits
        .into_iter()
        .rev()
        .take(MOST_COMMITS)
        .map(|commit| {
            let author = commit.commit.author;
            ForkCommit {
                id: commit.sha,
                summary: commit
                    .commit
                    .message
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .to_owned(),
                author: author
                    .as_ref()
                    .and_then(|a| a.name.clone())
                    .unwrap_or_default(),
                email: author
                    .as_ref()
                    .and_then(|a| a.email.clone())
                    .unwrap_or_default(),
                date: author.and_then(|a| a.date).unwrap_or_default(),
            }
        })
        .collect();
    ForkStatus {
        new: raw.ahead_by,
        own: raw.behind_by,
        commits,
    }
}

/// What GitHub's answer to syncing a fork means: `status` and its body. Only a missing or
/// refused token is an error; a fork that can't be synced is an outcome, said beside it.
fn sync_from(status: u16, body: &Value) -> Result<ForkSync> {
    let said = error_message(body).or_else(|| body["message"].as_str().map(str::to_owned));
    match status {
        200..=299 => {
            let outcome = match body["merge_type"].as_str() {
                Some("fast-forward") => SyncOutcome::FastForward,
                Some("merge") => SyncOutcome::Merged,
                _ => SyncOutcome::UpToDate,
            };
            Ok(ForkSync {
                outcome,
                message: said.unwrap_or_default(),
            })
        }
        401 => Err("GitHub didn't accept the token git keeps: sign in again in Settings.".into()),
        409 => Ok(ForkSync {
            outcome: SyncOutcome::Conflict,
            message: said.unwrap_or_else(|| "Its own changes clash with the original's.".into()),
        }),
        403 | 404 => Ok(ForkSync {
            outcome: SyncOutcome::Refused,
            message: format!(
                "GitHub didn't let you sync it ({}). The token git keeps may not be allowed to write to it.",
                said.unwrap_or_else(|| status.to_string())
            ),
        }),
        _ => Ok(ForkSync {
            outcome: SyncOutcome::Refused,
            message: said.unwrap_or_else(|| format!("GitHub said {status}.")),
        }),
    }
}

/// A user's or repository's name as GitHub allows it, so it can go in a request's path.
fn plain_name(name: &str) -> Result<&str> {
    if !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && name != "."
        && name != ".."
    {
        Ok(name)
    } else {
        Err(Error::Message(format!("{name:?} isn't a GitHub name.")))
    }
}

/// A branch's name for a request's path: everything but letters, digits, `-._~` and `/`
/// written as %XX.
fn path_branch(branch: &str) -> String {
    let mut out = String::new();
    for byte in branch.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

async fn token() -> Result<String> {
    stored_token(HOST)
        .await?
        .ok_or_else(|| "Sign in to GitHub in Settings to see your forks.".into())
}

/// The answer to `request`, or why there's none: `what` says what was asked, for the error.
async fn answer(request: reqwest::RequestBuilder, what: &str) -> Result<Value> {
    let response = request
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or_default();
    if status.as_u16() == 401 {
        return Err("GitHub didn't accept the token git keeps: sign in again in Settings.".into());
    }
    if !status.is_success() {
        let said = error_message(&body).unwrap_or_else(|| status.to_string());
        return Err(format!("GitHub didn't {what} ({said}).").into());
    }
    Ok(body)
}

/// Your forks on GitHub, by name; none when you aren't signed in. Your repositories are listed
/// first, then each fork's own page is read, together, for what it's a fork of.
pub async fn forks() -> Result<Forks> {
    let Some(token) = stored_token(HOST).await? else {
        return Ok(Forks {
            signed_in: false,
            forks: Vec::new(),
        });
    };
    let client = client()?;
    let mut names = Vec::new();
    for page in 1..=MOST_PAGES {
        let url = format!("https://api.github.com/user/repos?type=owner&per_page=100&page={page}");
        let body = answer(
            api_request(&client, url, Some(&token)),
            "list your repositories",
        )
        .await?;
        let listed: Vec<RawListed> = serde_json::from_value(body)
            .map_err(|e| format!("Couldn't read GitHub's answer ({e})"))?;
        let full = listed.len() == 100;
        names.extend(
            listed
                .into_iter()
                .filter(|repo| repo.fork)
                .map(|repo| repo.full_name),
        );
        if !full {
            break;
        }
    }
    let pages: Vec<_> = names
        .into_iter()
        .map(|full_name| {
            let (client, token) = (client.clone(), token.clone());
            tauri::async_runtime::spawn(async move {
                let url = format!("https://api.github.com/repos/{full_name}");
                let body = answer(
                    api_request(&client, url, Some(&token)),
                    "say what it's a fork of",
                )
                .await?;
                let repo: RawRepo = serde_json::from_value(body)
                    .map_err(|e| format!("Couldn't read GitHub's answer ({e})"))?;
                Ok::<_, Error>(fork_from(repo))
            })
        })
        .collect();
    let mut forks = Vec::new();
    for page in pages {
        if let Some(fork) = page.await.map_err(|e| e.to_string())?? {
            forks.push(fork);
        }
    }
    forks.sort_by_key(|fork| (fork.name.to_lowercase(), fork.owner.to_lowercase()));
    Ok(Forks {
        signed_in: true,
        forks,
    })
}

/// How `fork`'s branch compares with its original's default branch.
pub async fn status(fork: &Fork) -> Result<ForkStatus> {
    let token = token().await?;
    let (owner, name, parent) = (
        plain_name(&fork.owner)?,
        plain_name(&fork.name)?,
        plain_name(&fork.parent.owner)?,
    );
    let url = format!(
        "https://api.github.com/repos/{owner}/{name}/compare/{owner}:{}...{parent}:{}",
        path_branch(&fork.branch),
        path_branch(&fork.parent.branch)
    );
    let what = format!("compare it with {}/{}", fork.parent.owner, fork.parent.name);
    let body = answer(api_request(&client()?, url, Some(&token)), &what).await?;
    let comparison: RawComparison =
        serde_json::from_value(body).map_err(|e| format!("Couldn't read GitHub's answer ({e})"))?;
    Ok(status_from(comparison))
}

/// Sync `fork`'s branch with its original, as its Sync fork button on GitHub does.
pub async fn sync(fork: &Fork) -> Result<ForkSync> {
    let token = token().await?;
    let (owner, name) = (plain_name(&fork.owner)?, plain_name(&fork.name)?);
    let response = client()?
        .post(format!(
            "https://api.github.com/repos/{owner}/{name}/merge-upstream"
        ))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(&token)
        .json(&serde_json::json!({ "branch": fork.branch }))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
    let status = response.status().as_u16();
    let body: Value = response.json().await.unwrap_or_default();
    sync_from(status, &body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn repo(parent: Option<Value>) -> RawRepo {
        let mut page = json!({
            "name": "notebook-sync",
            "owner": { "login": "rosa-bell" },
            "default_branch": "main",
            "private": false,
            "html_url": "https://github.com/rosa-bell/notebook-sync",
            "pushed_at": "2026-10-30T09:00:00Z",
        });
        if let Some(parent) = parent {
            page["parent"] = parent;
        }
        serde_json::from_value(page).unwrap()
    }

    #[test]
    fn reads_a_fork_and_what_it_is_a_fork_of() {
        let parent = json!({
            "name": "notebook-sync",
            "owner": { "login": "mayachen" },
            "default_branch": "trunk",
            "html_url": "https://github.com/mayachen/notebook-sync",
        });
        let fork = fork_from(repo(Some(parent))).unwrap();
        assert_eq!(
            (
                fork.owner.as_str(),
                fork.name.as_str(),
                fork.branch.as_str()
            ),
            ("rosa-bell", "notebook-sync", "main")
        );
        assert_eq!(fork.pushed.as_deref(), Some("2026-10-30T09:00:00Z"));
        assert_eq!(
            (fork.parent.owner.as_str(), fork.parent.branch.as_str()),
            ("mayachen", "trunk")
        );
        // A repository that isn't a fork has no parent.
        assert_eq!(fork_from(repo(None)), None);
    }

    #[test]
    fn counts_the_new_commits_and_lists_the_newest_first() {
        let commit = |n: u32| {
            json!({
                "sha": format!("{n:040}"),
                "commit": {
                    "message": format!("Change {n}\n\nWhy it changed."),
                    "author": { "name": "Maya Chen", "email": "maya@example.com", "date": format!("2026-11-{n:02}T10:00:00Z") },
                },
            })
        };
        // GitHub lists them oldest first.
        let raw: RawComparison = serde_json::from_value(json!({
            "status": "diverged",
            "ahead_by": 25,
            "behind_by": 2,
            "commits": (1..=25).map(commit).collect::<Vec<_>>(),
        }))
        .unwrap();
        let status = status_from(raw);
        assert_eq!((status.new, status.own), (25, 2));
        assert_eq!(status.commits.len(), MOST_COMMITS);
        assert_eq!(status.commits[0].summary, "Change 25");
        assert_eq!(status.commits[0].author, "Maya Chen");
        assert_eq!(status.commits[MOST_COMMITS - 1].summary, "Change 6");
        // Up to date: nothing new, nothing listed.
        let raw: RawComparison = serde_json::from_value(
            json!({ "status": "identical", "ahead_by": 0, "behind_by": 0, "commits": [] }),
        )
        .unwrap();
        assert_eq!(
            status_from(raw),
            ForkStatus {
                new: 0,
                own: 0,
                commits: vec![]
            }
        );
    }

    #[test]
    fn says_what_syncing_did() {
        let said = |status: u16, body: Value| sync_from(status, &body).unwrap();
        let synced = said(
            200,
            json!({ "message": "Successfully fetched and fast-forwarded from upstream mayachen:main.", "merge_type": "fast-forward", "base_branch": "mayachen:main" }),
        );
        assert_eq!(synced.outcome, SyncOutcome::FastForward);
        assert!(synced.message.contains("fast-forwarded"));
        assert_eq!(
            said(200, json!({ "merge_type": "merge" })).outcome,
            SyncOutcome::Merged
        );
        assert_eq!(said(200, json!({ "merge_type": "none", "message": "This branch is not behind the upstream mayachen:main." })).outcome, SyncOutcome::UpToDate);
        let clash = said(409, json!({ "message": "There are merge conflicts" }));
        assert_eq!(
            (clash.outcome, clash.message.as_str()),
            (SyncOutcome::Conflict, "There are merge conflicts")
        );
        let refused = said(422, json!({ "message": "Branch not found" }));
        assert_eq!(
            (refused.outcome, refused.message.as_str()),
            (SyncOutcome::Refused, "Branch not found")
        );
        assert_eq!(
            said(
                403,
                json!({ "message": "Resource not accessible by personal access token" })
            )
            .outcome,
            SyncOutcome::Refused
        );
        // A token GitHub doesn't accept is an error: nothing can be synced.
        assert!(sync_from(401, &json!({ "message": "Bad credentials" })).is_err());
    }

    #[test]
    fn keeps_names_and_branches_safe_in_a_path() {
        assert_eq!(plain_name("rosa-bell").unwrap(), "rosa-bell");
        assert_eq!(plain_name("lantern.ui_2").unwrap(), "lantern.ui_2");
        for bad in ["", "..", "a/b", "a?b", "a b", "a#b"] {
            assert!(plain_name(bad).is_err(), "{bad:?}");
        }
        assert_eq!(path_branch("main"), "main");
        assert_eq!(path_branch("release/2.0"), "release/2.0");
        assert_eq!(path_branch("fix#3 ?x"), "fix%233%20%3Fx");
    }
}
