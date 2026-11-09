//! CI on GitLab for any commit: its latest pipeline's state, its jobs, and retrying it.

use serde::Deserialize;

use super::requests::{RawJob, job_check};
use super::{Project, auth_mode, get, pipeline_state};
use crate::error::Result;
use crate::github::{CheckState, client};
use crate::requests::{Check, sort_checks};

#[derive(Deserialize)]
struct RawCommit {
    last_pipeline: Option<RawPipeline>,
}

#[derive(Deserialize)]
struct RawPipeline {
    id: u64,
    status: String,
}

/// How to send the token: as a personal access token or an OAuth token (None: without).
async fn bearer(
    client: &reqwest::Client,
    project: &Project,
    token: Option<&str>,
) -> (Option<String>, bool) {
    match token {
        Some(token) => match auth_mode(client, project, token).await {
            Ok(Some(bearer)) => (Some(token.to_owned()), bearer),
            _ => (None, false),
        },
        None => (None, false),
    }
}

async fn last_pipeline(
    client: &reqwest::Client,
    project: &Project,
    token: Option<&str>,
    bearer: bool,
    sha: &str,
) -> Option<RawPipeline> {
    if !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let url = format!("{}/repository/commits/{sha}", project.api);
    let answer = get(client, &url, token, bearer).await.ok()?;
    if !answer.status().is_success() {
        return None;
    }
    answer.json::<RawCommit>().await.ok()?.last_pipeline
}

/// The latest pipeline's state for each of `shas` that has one.
pub(crate) async fn commit_states(
    project: &Project,
    token: Option<&str>,
    shas: &[String],
) -> Vec<(String, CheckState)> {
    let Ok(client) = client() else {
        return Vec::new();
    };
    let (token, bearer) = bearer(&client, project, token).await;
    let mut tasks = Vec::new();
    for sha in shas {
        let (client, project, token, sha) =
            (client.clone(), project.clone(), token.clone(), sha.clone());
        tasks.push(tauri::async_runtime::spawn(async move {
            let pipeline = last_pipeline(&client, &project, token.as_deref(), bearer, &sha).await;
            pipeline
                .and_then(|p| pipeline_state(&p.status))
                .map(|state| (sha, state))
        }));
    }
    let mut states = Vec::new();
    for task in tasks {
        if let Ok(Some(found)) = task.await {
            states.push(found);
        }
    }
    states
}

/// The jobs of `sha`'s latest pipeline, failures first.
pub(crate) async fn commit_checks(project: &Project, token: Option<&str>, sha: &str) -> Vec<Check> {
    let Ok(client) = client() else {
        return Vec::new();
    };
    let (token, bearer) = bearer(&client, project, token).await;
    let Some(pipeline) = last_pipeline(&client, project, token.as_deref(), bearer, sha).await
    else {
        return Vec::new();
    };
    let url = format!(
        "{}/pipelines/{}/jobs?per_page=100",
        project.api, pipeline.id
    );
    let mut checks: Vec<Check> = match get(&client, &url, token.as_deref(), bearer).await {
        Ok(answer) if answer.status().is_success() => answer
            .json::<Vec<RawJob>>()
            .await
            .map(|jobs| jobs.into_iter().map(job_check).collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    sort_checks(&mut checks);
    checks
}

/// Retry the failed jobs of `sha`'s latest pipeline.
pub(crate) async fn retry_pipeline(project: &Project, token: &str, sha: &str) -> Result<usize> {
    let client = client()?;
    let (token, bearer) = bearer(&client, project, Some(token)).await;
    let token = token.ok_or(
        "GitLab didn't accept the token git keeps for it. Push or fetch to sign in again.",
    )?;
    let pipeline = last_pipeline(&client, project, Some(&token), bearer, sha)
        .await
        .ok_or("That commit has no pipeline on GitLab.")?;
    let post = client.post(format!("{}/pipelines/{}/retry", project.api, pipeline.id));
    let post = if bearer {
        post.bearer_auth(&token)
    } else {
        post.header("PRIVATE-TOKEN", &token)
    };
    let answer = post
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
    if !answer.status().is_success() {
        return Err(format!("GitLab didn't retry it ({}).", answer.status()).into());
    }
    Ok(1)
}
