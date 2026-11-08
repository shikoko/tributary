//! Open merge requests on GitLab (its name for pull requests), for the branch labels: their
//! number (like !12) and how their latest pipeline went. GitLab is asked with the token git
//! keeps for the GitLab server, when it has one; public projects work without.

use std::path::Path;

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::git::Git;
use crate::github::{CheckState, Forge, PullRequest, client};
use crate::links::Host;
use crate::requests::{
    Check, Mergeable, NewRequest, RequestDetails, RequestState, Review, ReviewState, error_message,
    sort_checks,
};

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
fn pipeline_state(status: &str) -> Option<CheckState> {
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

/// Open a merge request from `request.branch` into `request.base`.
pub(crate) async fn create(
    project: &Project,
    token: &str,
    request: &NewRequest,
) -> Result<PullRequest> {
    let client = client()?;
    let bearer = auth_mode(&client, project, token).await?.ok_or(
        "GitLab didn't accept the token git keeps for it. Push or fetch to sign in again, or open it in the browser.",
    )?;
    let title = request.title.trim();
    // GitLab marks drafts by their title.
    let title = if request.draft && !title.to_lowercase().starts_with("draft:") {
        format!("Draft: {title}")
    } else {
        title.to_owned()
    };
    let body = serde_json::json!({
        "source_branch": request.branch,
        "target_branch": request.base,
        "title": title,
        "description": request.body,
    });
    let post = client
        .post(format!("{}/merge_requests", project.api))
        .json(&body);
    let post = if bearer {
        post.bearer_auth(token)
    } else {
        post.header("PRIVATE-TOKEN", token)
    };
    let response = post
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
    let status = response.status();
    if !status.is_success() {
        let answer: serde_json::Value = response.json().await.unwrap_or_default();
        let message = error_message(&answer).unwrap_or_else(|| status.to_string());
        return Err(match status.as_u16() {
            403 | 404 => format!(
                "GitLab didn't let you open it ({message}). The token may not be allowed to write merge requests here."
            )
            .into(),
            _ => format!("GitLab didn't open it: {message}").into(),
        });
    }
    let raw: RawMergeRequest = response
        .json()
        .await
        .map_err(|e| format!("Couldn't read GitLab's answer ({e})"))?;
    let (pull, _) = from_project(vec![raw], &project.remote)
        .into_iter()
        .next()
        .ok_or("GitLab opened it, but from another project.")?;
    Ok(pull)
}

#[derive(Deserialize)]
struct RawDetails {
    iid: u64,
    title: String,
    web_url: String,
    #[serde(default)]
    description: Option<String>,
    state: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    work_in_progress: bool,
    author: Option<RawAuthor>,
    source_branch: String,
    target_branch: String,
    created_at: String,
    #[serde(default)]
    detailed_merge_status: Option<String>,
    #[serde(default)]
    has_conflicts: bool,
    #[serde(default)]
    user_notes_count: u64,
    /// How many files changed, as text ("12", or "1000+").
    #[serde(default)]
    changes_count: Option<String>,
    #[serde(default)]
    reviewers: Vec<RawAuthor>,
    head_pipeline: Option<RawHeadPipeline>,
}

#[derive(Deserialize)]
struct RawHeadPipeline {
    id: u64,
}

#[derive(Deserialize)]
struct RawApprovals {
    #[serde(default)]
    approved_by: Vec<RawApprover>,
}

#[derive(Deserialize)]
struct RawApprover {
    user: RawAuthor,
}

#[derive(Deserialize)]
struct RawJob {
    name: String,
    stage: Option<String>,
    status: String,
    #[serde(default)]
    allow_failure: bool,
    web_url: Option<String>,
}

/// Whether GitLab would merge it now, from its `detailed_merge_status`.
fn merge_status(status: Option<&str>, has_conflicts: bool) -> Option<Mergeable> {
    if has_conflicts {
        return Some(Mergeable::Conflicts);
    }
    Some(match status? {
        "mergeable" => Mergeable::Ready,
        "conflict" | "broken_status" => Mergeable::Conflicts,
        "need_rebase" => Mergeable::Behind,
        "checking" | "unchecked" | "preparing" | "approvals_syncing" => Mergeable::Checking,
        "draft_status" | "not_open" => return None,
        _ => Mergeable::Blocked,
    })
}

fn job_check(job: RawJob) -> Check {
    let state = match job.status.as_str() {
        "success" => Some(CheckState::Success),
        // A job allowed to fail doesn't hold anything up.
        "failed" if job.allow_failure => None,
        "failed" | "canceled" => Some(CheckState::Failure),
        "created" | "waiting_for_resource" | "preparing" | "pending" | "running" | "scheduled" => {
            Some(CheckState::Pending)
        }
        _ => None,
    };
    Check {
        name: job.name,
        state,
        url: job.web_url,
        detail: job.stage,
    }
}

/// Approvals first, then reviewers asked who haven't approved.
fn approvals(approved: Vec<String>, reviewers: Vec<String>) -> Vec<Review> {
    let mut result: Vec<Review> = approved
        .iter()
        .map(|author| Review {
            author: author.clone(),
            state: ReviewState::Approved,
        })
        .collect();
    for reviewer in reviewers {
        if !approved.contains(&reviewer) {
            result.push(Review {
                author: reviewer,
                state: ReviewState::Requested,
            });
        }
    }
    result
}

/// Merge request `iid` in full.
pub(crate) async fn details(
    project: &Project,
    token: Option<&str>,
    iid: u64,
) -> Result<RequestDetails> {
    let client = client()?;
    let bearer = match token {
        Some(token) => auth_mode(&client, project, token).await?,
        None => None,
    };
    let token = bearer.and(token);
    let bearer = bearer.unwrap_or(false);
    let fetch = |url: String| {
        let client = client.clone();
        async move { get(&client, &url, token, bearer).await }
    };
    let response = fetch(format!("{}/merge_requests/{iid}", project.api))
        .await
        .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 404 => format!("GitLab didn't show merge request !{iid}: it isn't there, or this project is private and git has no token for it.").into(),
            _ => format!("GitLab didn't show merge request !{iid} ({}).", response.status()).into(),
        });
    }
    let request: RawDetails = response
        .json()
        .await
        .map_err(|e| format!("Couldn't read merge request !{iid} ({e})"))?;

    let approved: Vec<String> =
        match fetch(format!("{}/merge_requests/{iid}/approvals", project.api)).await {
            Ok(answer) if answer.status().is_success() => answer
                .json::<RawApprovals>()
                .await
                .map(|raw| {
                    raw.approved_by
                        .into_iter()
                        .map(|a| a.user.username)
                        .collect()
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        };
    let mut checks: Vec<Check> = match &request.head_pipeline {
        Some(pipeline) => match fetch(format!(
            "{}/pipelines/{}/jobs?per_page=100",
            project.api, pipeline.id
        ))
        .await
        {
            Ok(answer) if answer.status().is_success() => answer
                .json::<Vec<RawJob>>()
                .await
                .map(|jobs| jobs.into_iter().map(job_check).collect())
                .unwrap_or_default(),
            _ => Vec::new(),
        },
        None => Vec::new(),
    };
    sort_checks(&mut checks);

    let draft = request.draft || request.work_in_progress;
    let state = match request.state.as_str() {
        "merged" => RequestState::Merged,
        "closed" | "locked" => RequestState::Closed,
        _ if draft => RequestState::Draft,
        _ => RequestState::Open,
    };
    Ok(RequestDetails {
        number: request.iid,
        title: request.title,
        url: request.web_url,
        body: request.description.unwrap_or_default(),
        author: request.author.map(|a| a.username).unwrap_or_default(),
        mergeable: if state == RequestState::Open {
            merge_status(
                request.detailed_merge_status.as_deref(),
                request.has_conflicts,
            )
        } else {
            None
        },
        state,
        base: request.target_branch,
        branch: request.source_branch,
        created: request.created_at,
        additions: None,
        deletions: None,
        files: request
            .changes_count
            .and_then(|count| count.trim_end_matches('+').parse().ok()),
        comments: request.user_notes_count,
        reviews: approvals(
            approved,
            request.reviewers.into_iter().map(|r| r.username).collect(),
        ),
        checks,
        forge: Forge::GitLab,
    })
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
    fn reads_a_merge_requests_details() {
        assert_eq!(
            merge_status(Some("mergeable"), false),
            Some(Mergeable::Ready)
        );
        assert_eq!(
            merge_status(Some("mergeable"), true),
            Some(Mergeable::Conflicts)
        );
        assert_eq!(
            merge_status(Some("not_approved"), false),
            Some(Mergeable::Blocked)
        );
        assert_eq!(
            merge_status(Some("need_rebase"), false),
            Some(Mergeable::Behind)
        );
        assert_eq!(merge_status(Some("draft_status"), false), None);
        let job = |status: &str, allow_failure| RawJob {
            name: "test".into(),
            stage: Some("verify".into()),
            status: status.into(),
            allow_failure,
            web_url: None,
        };
        assert_eq!(
            job_check(job("failed", false)).state,
            Some(CheckState::Failure)
        );
        assert_eq!(job_check(job("failed", true)).state, None);
        assert_eq!(
            job_check(job("running", false)).state,
            Some(CheckState::Pending)
        );
        assert_eq!(
            job_check(job("manual", false)).detail.as_deref(),
            Some("verify")
        );
        let reviews = approvals(vec!["lena".into()], vec!["lena".into(), "theo".into()]);
        assert_eq!(
            reviews,
            [
                Review {
                    author: "lena".into(),
                    state: ReviewState::Approved
                },
                Review {
                    author: "theo".into(),
                    state: ReviewState::Requested
                },
            ]
        );
    }

    #[test]
    fn sums_up_pipelines() {
        assert_eq!(pipeline_state("success"), Some(CheckState::Success));
        assert_eq!(pipeline_state("failed"), Some(CheckState::Failure));
        assert_eq!(pipeline_state("running"), Some(CheckState::Pending));
        assert_eq!(pipeline_state("manual"), None);
    }
}
