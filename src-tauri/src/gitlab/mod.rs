//! Open merge requests on GitLab (its name for pull requests), for the branch labels: their
//! number (like !12) and how their latest pipeline went. GitLab is asked with the token git
//! keeps for the GitLab server, when it has one; public projects work without.

use std::path::Path;

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::git::Git;
use crate::github::{CheckState, Forge, PullRequest, client};
use crate::links::Host;

pub(crate) mod ci;
pub(crate) mod controls;
/// Opening a merge request, and reading one in full.
pub(crate) mod issues;
mod requests;
pub(crate) mod reviews;
pub(crate) use requests::{create, details, publish_release};

/// At most this many merge requests get their pipeline looked up.
const MAX_CHECKED: usize = 25;

#[derive(Deserialize)]
struct RawMergeRequest {
    iid: u64,
    title: String,
    web_url: String,
    source_branch: String,
    #[serde(default)]
    draft: bool,
    /// What GitLab called drafts before version 14.
    #[serde(default)]
    work_in_progress: bool,
    author: Option<RawAuthor>,
    project_id: u64,
    source_project_id: u64,
}

#[derive(Deserialize)]
struct RawAuthor {
    username: String,
}

#[derive(Deserialize)]
struct RawPipeline {
    status: String,
}

/// A GitLab project behind one of the repository's remotes.
#[derive(Clone)]
pub(crate) struct Project {
    pub(crate) remote: String,
    /// The server, like "gitlab.com", for git's credential helper.
    pub(crate) host: String,
    /// Its API address, like `https://gitlab.com/api/v4/projects/group%2Fapp`.
    pub(crate) api: String,
}

/// The GitLab project behind the repository's remotes (origin, if it's on GitLab).
pub(crate) fn gitlab_project(path: &Path) -> Result<Option<Project>, Error> {
    let repo = crate::repo::open(path)?;
    let remotes = crate::repo::web_remotes(&repo);
    let gitlab: Vec<_> = remotes
        .into_iter()
        .filter(|remote| remote.host == Host::GitLab)
        .collect();
    let chosen = gitlab
        .iter()
        .find(|remote| remote.name == "origin")
        .or_else(|| gitlab.first());
    Ok(chosen.and_then(|remote| {
        let (base, project) = split_project_url(&remote.url)?;
        let host = base.split_once("://")?.1.to_owned();
        Some(Project {
            remote: remote.name.clone(),
            host,
            api: format!("{base}/api/v4/projects/{}", encode_path(project)),
        })
    }))
}

/// `https://gitlab.com/group/sub/app` → ("https://gitlab.com", "group/sub/app").
fn split_project_url(url: &str) -> Option<(&str, &str)> {
    let (scheme, rest) = url.split_once("://")?;
    let (authority, project) = rest.split_once('/')?;
    let project = project.trim_matches('/');
    (project.contains('/') && !project.contains("/-/"))
        .then(|| (&url[..scheme.len() + 3 + authority.len()], project))
}

/// A project's path as one URL path segment (GitLab takes `group/app` as `group%2Fapp`),
/// or any text as a query value: everything but letters, digits and `-_.~` is escaped.
pub(crate) fn encode_path(path: &str) -> String {
    path.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// How a pipeline went, for the badge's dot.
pub(super) fn pipeline_state(status: &str) -> Option<CheckState> {
    match status {
        "success" => Some(CheckState::Success),
        "failed" | "canceled" => Some(CheckState::Failure),
        "created" | "waiting_for_resource" | "preparing" | "pending" | "running" | "scheduled" => {
            Some(CheckState::Pending)
        }
        // Skipped, or waiting for someone to start it by hand.
        _ => None,
    }
}

/// The merge requests whose branches are on this project (not on forks).
fn from_project(raw: Vec<RawMergeRequest>, remote: &str) -> Vec<(PullRequest, u64)> {
    raw.into_iter()
        .filter(|request| request.source_project_id == request.project_id)
        .map(|request| {
            let iid = request.iid;
            let pull = PullRequest {
                number: iid,
                title: request.title,
                url: request.web_url,
                remote: remote.to_owned(),
                branch: request.source_branch,
                draft: request.draft || request.work_in_progress,
                author: request.author.map(|a| a.username).unwrap_or_default(),
                checks: None,
                forge: Forge::GitLab,
            };
            (pull, iid)
        })
        .collect()
}

/// A GET from GitLab's API. GitLab takes personal access tokens in a header of its own,
/// and OAuth tokens (which Git Credential Manager keeps) as bearer tokens.
async fn get(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
    bearer: bool,
) -> reqwest::Result<reqwest::Response> {
    let request = client.get(url);
    let request = match token {
        Some(token) if bearer => request.bearer_auth(token),
        Some(token) => request.header("PRIVATE-TOKEN", token),
        None => request,
    };
    request.send().await
}

/// The way to send git's token that GitLab accepts: as a personal access token, or as an
/// OAuth token (which Git Credential Manager keeps). None when it accepts neither.
async fn auth_mode(
    client: &reqwest::Client,
    project: &Project,
    token: &str,
) -> Result<Option<bool>> {
    for bearer in [false, true] {
        let answer = get(client, &project.api, Some(token), bearer)
            .await
            .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
        if answer.status().is_success() {
            return Ok(Some(bearer));
        }
        if answer.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(None);
        }
    }
    Ok(None)
}

/// The open merge requests of the repository's GitLab remote. Empty for other remotes.
pub async fn merge_requests(path: &Path) -> Result<Vec<PullRequest>, Error> {
    let path = path.to_owned();
    let (project, token) = tauri::async_runtime::spawn_blocking(move || {
        let project = gitlab_project(&path)?;
        let token = project.as_ref().and_then(|project| {
            let git = Git::find(path.clone()).ok()?;
            git.stored_password(&project.host)
        });
        Ok::<_, Error>((project, token))
    })
    .await
    .map_err(|e| e.to_string())??;
    let Some(project) = project else {
        return Ok(Vec::new());
    };

    let client = client()?;
    let list = format!("{}/merge_requests?state=opened&per_page=100", project.api);
    // The kind of token git keeps isn't known: try it as a personal access token, then as
    // an OAuth token, then go without (a public project still answers).
    let mut auth: Option<(&str, bool)> = None;
    let mut response = None;
    let tries: Vec<Option<(&str, bool)>> = match token.as_deref() {
        Some(token) => vec![Some((token, false)), Some((token, true)), None],
        None => vec![None],
    };
    for attempt in tries {
        let (token, bearer) = attempt.map_or((None, false), |(t, b)| (Some(t), b));
        let answer = get(&client, &list, token, bearer)
            .await
            .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
        if answer.status().is_success() {
            auth = attempt;
            response = Some(answer);
            break;
        }
        if answer.status() != reqwest::StatusCode::UNAUTHORIZED {
            // No access (a private project without a token), or rate limited: no badges.
            return Ok(Vec::new());
        }
    }
    let Some(response) = response else {
        return Ok(Vec::new());
    };
    let raw: Vec<RawMergeRequest> = response
        .json()
        .await
        .map_err(|e| format!("Couldn't read the merge requests ({e})"))?;

    let mut result = Vec::new();
    for (index, (mut pull, iid)) in from_project(raw, &project.remote).into_iter().enumerate() {
        // Pipelines take a request each: only with a token, and only for the first ones.
        if let Some((token, bearer)) = auth.filter(|_| index < MAX_CHECKED) {
            let url = format!("{}/merge_requests/{iid}/pipelines?per_page=1", project.api);
            if let Ok(answer) = get(&client, &url, Some(token), bearer).await
                && answer.status().is_success()
            {
                let pipelines: Vec<RawPipeline> = answer.json().await.unwrap_or_default();
                pull.checks = pipelines.first().and_then(|p| pipeline_state(&p.status));
            }
        }
        result.push(pull);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_api_address_of_a_project() {
        let (base, project) = split_project_url("https://gitlab.com/group/sub/app").unwrap();
        assert_eq!((base, project), ("https://gitlab.com", "group/sub/app"));
        assert_eq!(encode_path(project), "group%2Fsub%2Fapp");
        assert_eq!(encode_path("me/my.app_2"), "me%2Fmy.app_2");
        // A self-hosted server on a port.
        let (base, _) = split_project_url("https://gitlab.example.com:8443/team/app").unwrap();
        assert_eq!(base, "https://gitlab.example.com:8443");
        // Not a project.
        assert!(split_project_url("https://gitlab.com/just-a-user").is_none());
    }

    #[test]
    fn reads_merge_requests_and_leaves_out_forks() {
        let raw: Vec<RawMergeRequest> = serde_json::from_str(
            r#"[
              {"iid": 12, "title": "Add tags", "web_url": "https://gitlab.com/g/app/-/merge_requests/12",
               "source_branch": "feature/tags", "draft": false, "author": {"username": "lena"},
               "project_id": 7, "source_project_id": 7},
              {"iid": 13, "title": "Old style draft", "web_url": "https://gitlab.com/g/app/-/merge_requests/13",
               "source_branch": "wip", "work_in_progress": true, "author": null,
               "project_id": 7, "source_project_id": 7},
              {"iid": 14, "title": "From a fork", "web_url": "https://gitlab.com/g/app/-/merge_requests/14",
               "source_branch": "main", "project_id": 7, "source_project_id": 99}
            ]"#,
        )
        .unwrap();
        let found = from_project(raw, "origin");
        assert_eq!(found.len(), 2);
        let (tags, iid) = &found[0];
        assert_eq!(
            (tags.number, *iid, tags.branch.as_str()),
            (12, 12, "feature/tags")
        );
        assert_eq!((tags.author.as_str(), tags.forge), ("lena", Forge::GitLab));
        assert!(found[1].0.draft);
    }

    #[test]
    fn sums_up_pipelines() {
        assert_eq!(pipeline_state("success"), Some(CheckState::Success));
        assert_eq!(pipeline_state("failed"), Some(CheckState::Failure));
        assert_eq!(pipeline_state("running"), Some(CheckState::Pending));
        assert_eq!(pipeline_state("manual"), None);
    }
}
