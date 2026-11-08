//! Opening a merge request on GitLab, and reading one in full: its approvals and pipeline.

use serde::Deserialize;

use super::{Project, RawAuthor, RawMergeRequest, auth_mode, from_project, get};
use crate::error::Result;
use crate::github::{CheckState, Forge, PullRequest, client};
use crate::requests::{
    Check, Mergeable, NewRequest, RequestDetails, RequestState, Review, ReviewState, error_message,
    sort_checks,
};

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
