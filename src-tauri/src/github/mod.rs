//! Open pull requests on GitHub, for the branch labels: their number, and whether their
//! checks passed. GitHub is asked with the token git uses for github.com, when it has one
//! (see [`account`] for signing in).

pub mod account;
pub(crate) mod ci;
pub(crate) mod controls;
pub(crate) mod issues;
pub(crate) mod pulls;
pub(crate) mod reviews;

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::git::Git;
use crate::links::Host;

/// GitHub's host, for git's credential helper.
pub(crate) const HOST: &str = "github.com";

/// An HTTP client for GitHub's API.
pub(crate) fn client() -> Result<reqwest::Client> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent("Tributary")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| Error::Message(e.to_string()))
}

/// A request to GitHub's API, with the token when there is one.
pub(crate) fn api_request(
    client: &reqwest::Client,
    url: String,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    match token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

/// At most this many pull requests get their checks looked up.
const MAX_CHECKED: usize = 25;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// The remote it's on, like "origin".
    pub remote: String,
    /// Its branch on that remote, like "feat/menu".
    pub branch: String,
    pub draft: bool,
    pub author: String,
    /// None when it has no checks (or they couldn't be read).
    pub checks: Option<CheckState>,
    /// Where it is: a pull request on GitHub, or a merge request on GitLab.
    pub forge: Forge,
}

/// The site a pull (or merge) request is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Forge {
    GitHub,
    GitLab,
}

/// The open pull requests on GitHub, or merge requests on GitLab, of whichever the
/// repository's remotes are on.
pub async fn open_requests(path: &Path) -> Result<Vec<PullRequest>, Error> {
    let pulls = pull_requests(path).await?;
    if !pulls.is_empty() {
        return Ok(pulls);
    }
    crate::gitlab::merge_requests(path).await
}

/// How a pull request's checks (GitHub Actions and others) went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckState {
    Success,
    Failure,
    Pending,
}

#[derive(Deserialize)]
struct RawPull {
    number: u64,
    title: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    user: Option<RawUser>,
    head: RawHead,
}

#[derive(Deserialize)]
struct RawUser {
    login: String,
}

#[derive(Deserialize)]
struct RawHead {
    #[serde(rename = "ref")]
    branch: String,
    sha: String,
    repo: Option<RawRepo>,
}

#[derive(Deserialize)]
struct RawRepo {
    full_name: String,
}

#[derive(Deserialize)]
struct CheckRuns {
    #[serde(default)]
    check_runs: Vec<CheckRun>,
}

#[derive(Deserialize)]
struct CheckRun {
    status: String,
    conclusion: Option<String>,
}

#[derive(Deserialize)]
struct CombinedStatus {
    state: String,
    #[serde(default)]
    total_count: u64,
}

/// The GitHub repository behind the repository's remotes: (remote, "owner/name").
pub(crate) fn github_repository(path: &Path) -> Result<Option<(String, String)>, Error> {
    let repo = crate::repo::open(path)?;
    let remotes = crate::repo::web_remotes(&repo);
    let github: Vec<_> = remotes
        .into_iter()
        .filter(|remote| remote.host == Host::GitHub)
        .collect();
    let chosen = github
        .iter()
        .find(|remote| remote.name == "origin")
        .or_else(|| github.first());
    Ok(chosen.and_then(|remote| {
        let full_name = remote
            .url
            .strip_prefix("https://github.com/")?
            .trim_end_matches('/');
        (full_name.split('/').count() == 2).then(|| (remote.name.clone(), full_name.to_owned()))
    }))
}

/// Combine the results of a commit's checks: any failure fails, anything still running is pending.
fn summarize(runs: &[CheckRun]) -> Option<CheckState> {
    if runs.is_empty() {
        return None;
    }
    let failed = runs.iter().any(|run| {
        matches!(
            run.conclusion.as_deref(),
            Some("failure" | "timed_out" | "cancelled" | "action_required" | "startup_failure")
        )
    });
    let running = runs.iter().any(|run| run.status != "completed");
    Some(if failed {
        CheckState::Failure
    } else if running {
        CheckState::Pending
    } else {
        CheckState::Success
    })
}

/// The open pull requests of the repository's GitHub remote. Empty for other remotes.
pub async fn pull_requests(path: &Path) -> Result<Vec<PullRequest>, Error> {
    let path = path.to_owned();
    let (found, token) = tauri::async_runtime::spawn_blocking(move || {
        let found = github_repository(&path)?;
        let token = found.as_ref().and_then(|_| {
            let git = Git::find(path.clone()).ok()?;
            git.stored_password(HOST)
        });
        Ok::<_, Error>((found, token))
    })
    .await
    .map_err(|e| e.to_string())??;
    let Some((remote, full_name)) = found else {
        return Ok(Vec::new());
    };

    let client = client()?;
    let get = |url: String| api_request(&client, url, token.as_deref()).send();

    let response = get(format!(
        "https://api.github.com/repos/{full_name}/pulls?state=open&per_page=100"
    ))
    .await
    .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
    if !response.status().is_success() {
        // No access (a private repository without a token), or rate limited: no badges.
        return Ok(Vec::new());
    }
    let pulls: Vec<RawPull> = response
        .json()
        .await
        .map_err(|e| format!("Couldn't read the pull requests ({e})"))?;

    let mut result = Vec::new();
    for (index, pull) in pulls.into_iter().enumerate() {
        // Pull requests from forks have branches that aren't on this remote.
        if pull.head.repo.as_ref().map(|repo| repo.full_name.as_str()) != Some(full_name.as_str()) {
            continue;
        }
        // Without a token, GitHub allows few requests: just the list then.
        let checks = if token.is_some() && index < MAX_CHECKED {
            check_state(&get, &full_name, &pull.head.sha).await
        } else {
            None
        };
        result.push(PullRequest {
            number: pull.number,
            title: pull.title,
            url: pull.html_url,
            remote: remote.clone(),
            branch: pull.head.branch,
            draft: pull.draft,
            author: pull.user.map(|user| user.login).unwrap_or_default(),
            checks,
            forge: Forge::GitHub,
        });
    }
    Ok(result)
}

/// A commit's checks (GitHub Actions and other apps), or else its commit statuses.
async fn check_state<F, R>(get: &F, full_name: &str, sha: &str) -> Option<CheckState>
where
    F: Fn(String) -> R,
    R: std::future::Future<Output = reqwest::Result<reqwest::Response>>,
{
    let runs: Option<CheckRuns> = match get(format!(
        "https://api.github.com/repos/{full_name}/commits/{sha}/check-runs?per_page=100"
    ))
    .await
    {
        Ok(response) if response.status().is_success() => response.json().await.ok(),
        _ => None,
    };
    if let Some(state) = runs.and_then(|runs| summarize(&runs.check_runs)) {
        return Some(state);
    }
    let status: CombinedStatus = get(format!(
        "https://api.github.com/repos/{full_name}/commits/{sha}/status"
    ))
    .await
    .ok()?
    .json()
    .await
    .ok()?;
    if status.total_count == 0 {
        return None;
    }
    match status.state.as_str() {
        "success" => Some(CheckState::Success),
        "pending" => Some(CheckState::Pending),
        "failure" | "error" => Some(CheckState::Failure),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(status: &str, conclusion: Option<&str>) -> CheckRun {
        CheckRun {
            status: status.into(),
            conclusion: conclusion.map(Into::into),
        }
    }

    #[test]
    fn sums_up_checks() {
        assert_eq!(summarize(&[]), None);
        assert_eq!(
            summarize(&[
                run("completed", Some("success")),
                run("completed", Some("skipped"))
            ]),
            Some(CheckState::Success)
        );
        assert_eq!(
            summarize(&[run("completed", Some("success")), run("in_progress", None)]),
            Some(CheckState::Pending)
        );
        assert_eq!(
            summarize(&[run("in_progress", None), run("completed", Some("failure"))]),
            Some(CheckState::Failure)
        );
    }
}
