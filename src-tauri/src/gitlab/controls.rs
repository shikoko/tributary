//! Changing an open merge request on GitLab from the app: ready or a draft (by its title's
//! "Draft:"), more reviewers, and merging when its pipeline succeeds.

use serde::Deserialize;

use super::requests::reviewer_ids;
use super::{Project, auth_mode, get};
use crate::error::Result;
use crate::github::client;
use crate::requests::RequestChange;

#[derive(Deserialize)]
struct Raw {
    title: String,
    #[serde(default)]
    reviewers: Vec<RawUser>,
}

#[derive(Deserialize)]
struct RawUser {
    id: u64,
}

/// The title as a draft, or not.
fn draft_title(title: &str, draft: bool) -> String {
    let bare = title.trim();
    let bare = ["Draft:", "[Draft]", "(Draft)", "WIP:"]
        .iter()
        .find_map(|prefix| {
            bare.get(..prefix.len())
                .filter(|start| start.eq_ignore_ascii_case(prefix))
                .map(|_| bare[prefix.len()..].trim_start())
        })
        .unwrap_or(bare);
    if draft {
        format!("Draft: {bare}")
    } else {
        bare.to_owned()
    }
}

pub(crate) async fn change(
    project: &Project,
    token: &str,
    iid: u64,
    change: RequestChange,
) -> Result<String> {
    let client = client()?;
    let bearer = auth_mode(&client, project, token).await?.ok_or(
        "GitLab didn't accept the token git keeps for it. Push or fetch to sign in again.",
    )?;
    let url = format!("{}/merge_requests/{iid}", project.api);
    let send = |request: reqwest::RequestBuilder| {
        let request = if bearer {
            request.bearer_auth(token)
        } else {
            request.header("PRIVATE-TOKEN", token)
        };
        request.send()
    };
    let current: Raw = get(&client, &url, Some(token), bearer)
        .await
        .map_err(|e| format!("Couldn't reach GitLab ({e})"))?
        .json()
        .await
        .map_err(|e| format!("Couldn't read merge request !{iid} ({e})"))?;
    let refused =
        |what: &str, status: reqwest::StatusCode| format!("GitLab didn't {what} ({status}).");
    match change {
        RequestChange::Draft { draft } => {
            let answer = send(
                client
                    .put(&url)
                    .json(&serde_json::json!({ "title": draft_title(&current.title, draft) })),
            )
            .await
            .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
            if !answer.status().is_success() {
                return Err(refused("change it", answer.status()).into());
            }
            Ok(if draft {
                format!("!{iid} is a draft again")
            } else {
                format!("!{iid} is ready for review")
            })
        }
        RequestChange::Reviewers { reviewers } => {
            let wanted: Vec<String> = reviewers
                .iter()
                .map(|name| name.trim().trim_start_matches('@').to_owned())
                .filter(|name| !name.is_empty())
                .map(|name| format!("@{name}"))
                .collect();
            let mut ids: Vec<u64> = current.reviewers.iter().map(|user| user.id).collect();
            let found = reviewer_ids(&client, project, token, bearer, &wanted).await;
            if found.is_empty() {
                return Err("GitLab doesn't know anyone by those names.".into());
            }
            ids.extend(
                found
                    .iter()
                    .filter(|id| !ids.contains(id))
                    .copied()
                    .collect::<Vec<_>>(),
            );
            let answer = send(
                client
                    .put(&url)
                    .json(&serde_json::json!({ "reviewer_ids": ids })),
            )
            .await
            .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
            if !answer.status().is_success() {
                return Err(refused("ask them", answer.status()).into());
            }
            Ok(format!("Asked {} to review !{iid}", wanted.join(", ")))
        }
        RequestChange::AutoMerge { on, .. } => {
            let answer = if on {
                send(
                    client
                        .put(format!("{url}/merge"))
                        .json(&serde_json::json!({ "merge_when_pipeline_succeeds": true })),
                )
            } else {
                send(client.post(format!("{url}/cancel_merge_when_pipeline_succeeds")))
            }
            .await
            .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
            if !answer.status().is_success() {
                return Err(refused(
                    if on {
                        "set it to merge"
                    } else {
                        "stop it merging"
                    },
                    answer.status(),
                )
                .into());
            }
            Ok(if on {
                format!("!{iid} merges when its pipeline succeeds")
            } else {
                format!("!{iid} won't merge by itself")
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_drafts_by_their_title() {
        assert_eq!(
            draft_title("Make the door creak", true),
            "Draft: Make the door creak"
        );
        assert_eq!(
            draft_title("Draft: Make the door creak", false),
            "Make the door creak"
        );
        assert_eq!(
            draft_title("WIP: Make the door creak", true),
            "Draft: Make the door creak"
        );
    }
}
