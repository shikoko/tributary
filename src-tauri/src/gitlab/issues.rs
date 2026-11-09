//! Issues on GitLab: the ones commit messages mention (#12), and those assigned to you.

use serde::Deserialize;

use super::{Project, auth_mode, get};
use crate::error::Result;
use crate::github::client;
use crate::issues::Issue;

#[derive(Deserialize)]
struct RawIssue {
    iid: u64,
    title: String,
    state: String,
    web_url: String,
}

fn issue(raw: RawIssue) -> Issue {
    Issue {
        key: format!("#{}", raw.iid),
        title: raw.title,
        status: Some(
            if raw.state == "closed" {
                "Closed"
            } else {
                "Open"
            }
            .to_owned(),
        ),
        done: raw.state == "closed",
        url: raw.web_url,
    }
}

/// The token and how to send it, when GitLab takes it.
async fn auth(
    client: &reqwest::Client,
    project: &Project,
    token: Option<&str>,
) -> Result<(Option<String>, bool)> {
    let Some(token) = token else {
        return Ok((None, false));
    };
    Ok(match auth_mode(client, project, token).await? {
        Some(bearer) => (Some(token.to_owned()), bearer),
        None => (None, false),
    })
}

/// Issues `numbers` (their numbers in the project), the ones that can be found.
pub(crate) async fn issues(
    project: &Project,
    token: Option<&str>,
    numbers: &[u64],
) -> Result<Vec<Issue>> {
    let client = client()?;
    let (token, bearer) = auth(&client, project, token).await?;
    let mut found = Vec::new();
    for number in numbers {
        let url = format!("{}/issues/{number}", project.api);
        if let Ok(answer) = get(&client, &url, token.as_deref(), bearer).await
            && answer.status().is_success()
            && let Ok(raw) = answer.json::<RawIssue>().await
        {
            found.push(issue(raw));
        }
    }
    Ok(found)
}

/// The open issues in the project assigned to you, most recently updated first.
pub(crate) async fn assigned(project: &Project, token: &str) -> Result<Vec<Issue>> {
    let client = client()?;
    let (token, bearer) = auth(&client, project, Some(token)).await?;
    let token = token.ok_or(
        "GitLab didn't accept the token git keeps for it: push or fetch to sign in again.",
    )?;
    let url = format!(
        "{}/issues?scope=assigned_to_me&state=opened&order_by=updated_at&per_page=50",
        project.api
    );
    let answer = get(&client, &url, Some(&token), bearer)
        .await
        .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
    if !answer.status().is_success() {
        return Err(format!("GitLab couldn't list your issues ({}).", answer.status()).into());
    }
    let raw: Vec<RawIssue> = answer
        .json()
        .await
        .map_err(|e| format!("Couldn't read GitLab's answer ({e})"))?;
    Ok(raw.into_iter().map(issue).collect())
}
