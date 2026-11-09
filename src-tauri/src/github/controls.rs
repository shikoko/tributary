//! Changing an open pull request on GitHub from the app: ready for review or back to a
//! draft, asking more people to review it, and auto-merge (merging by itself once its
//! checks pass). Drafts and auto-merge are only in GitHub's GraphQL API.

use serde::Deserialize;

use super::{api_request, client};
use crate::error::Result;
use crate::requests::RequestChange;

#[derive(Deserialize)]
struct Node {
    node_id: String,
    #[serde(default)]
    user: Option<User>,
}

#[derive(Deserialize)]
struct User {
    login: String,
}

/// The pull request's GraphQL id, and its author.
async fn node(
    client: &reqwest::Client,
    full_name: &str,
    token: &str,
    number: u64,
) -> Result<(String, String)> {
    let answer = api_request(
        client,
        format!("https://api.github.com/repos/{full_name}/pulls/{number}"),
        Some(token),
    )
    .send()
    .await
    .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
    let node: Node = answer
        .json()
        .await
        .map_err(|e| format!("Couldn't read pull request #{number} ({e})"))?;
    Ok((
        node.node_id,
        node.user.map(|user| user.login).unwrap_or_default(),
    ))
}

/// Run a GraphQL mutation; GitHub's own message when it refuses.
async fn mutate(
    client: &reqwest::Client,
    token: &str,
    query: &str,
    variables: serde_json::Value,
) -> Result<()> {
    let answer: serde_json::Value = client
        .post("https://api.github.com/graphql")
        .bearer_auth(token)
        .json(&serde_json::json!({ "query": query, "variables": variables }))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub ({e})"))?
        .json()
        .await
        .map_err(|e| format!("Couldn't read GitHub's answer ({e})"))?;
    match answer["errors"]
        .as_array()
        .and_then(|errors| errors.first())
    {
        Some(error) => Err(format!(
            "GitHub refused: {}",
            error["message"].as_str().unwrap_or("no reason given")
        )
        .into()),
        None => Ok(()),
    }
}

/// GraphQL's name for a merge method.
fn merge_method(method: Option<&str>) -> &'static str {
    match method {
        Some("squash") => "SQUASH",
        Some("rebase") => "REBASE",
        _ => "MERGE",
    }
}

pub(crate) async fn change(
    full_name: &str,
    token: &str,
    number: u64,
    change: RequestChange,
) -> Result<String> {
    let client = client()?;
    match change {
        RequestChange::Draft { draft } => {
            let (id, _) = node(&client, full_name, token, number).await?;
            let query = if draft {
                "mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { clientMutationId } }"
            } else {
                "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }"
            };
            mutate(&client, token, query, serde_json::json!({ "id": id })).await?;
            Ok(if draft {
                format!("#{number} is a draft again")
            } else {
                format!("#{number} is ready for review")
            })
        }
        RequestChange::AutoMerge { on, method } => {
            let (id, _) = node(&client, full_name, token, number).await?;
            if on {
                let query = "mutation($id: ID!, $method: PullRequestMergeMethod!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { clientMutationId } }";
                mutate(
                    &client,
                    token,
                    query,
                    serde_json::json!({ "id": id, "method": merge_method(method.as_deref()) }),
                )
                .await?;
                Ok(format!("#{number} merges by itself once its checks pass"))
            } else {
                let query = "mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }";
                mutate(&client, token, query, serde_json::json!({ "id": id })).await?;
                Ok(format!("#{number} won't merge by itself"))
            }
        }
        RequestChange::Reviewers { reviewers } => {
            let (_, author) = node(&client, full_name, token, number).await?;
            let wanted: Vec<String> = reviewers
                .iter()
                .map(|name| name.trim())
                .filter(|name| !name.is_empty())
                .map(|name| {
                    if name.starts_with('@') {
                        name.to_owned()
                    } else {
                        format!("@{name}")
                    }
                })
                .collect();
            let (people, teams) = super::pulls::reviewers_and_teams(full_name, &wanted, &author);
            if people.is_empty() && teams.is_empty() {
                return Err("Name someone to ask (not the pull request's author), like maya or @studio/art.".into());
            }
            let answer = client
                .post(format!(
                    "https://api.github.com/repos/{full_name}/pulls/{number}/requested_reviewers"
                ))
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .bearer_auth(token)
                .json(&serde_json::json!({ "reviewers": people, "team_reviewers": teams }))
                .send()
                .await
                .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
            if !answer.status().is_success() {
                let body: serde_json::Value = answer.json().await.unwrap_or_default();
                let message = crate::requests::error_message(&body)
                    .unwrap_or_else(|| "no reason given".into());
                return Err(format!("GitHub didn't ask them: {message}").into());
            }
            Ok(format!(
                "Asked {} to review #{number}",
                people
                    .iter()
                    .chain(&teams)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn names_merge_methods_as_graphql_does() {
        assert_eq!(super::merge_method(Some("squash")), "SQUASH");
        assert_eq!(super::merge_method(None), "MERGE");
    }
}
