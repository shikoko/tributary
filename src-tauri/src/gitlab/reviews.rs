//! A merge request's conversation on GitLab, and reviewing, commenting on and merging it.

use serde::Deserialize;
use serde_json::{Value, json};

use super::{Project, auth_mode, get};
use crate::error::Result;
use crate::github::client;
use crate::requests::error_message;
use crate::reviews::{
    Comment, Conversation, MergeMethod, MergeRequestOptions, ReviewVerdict, in_threads,
};

#[derive(Deserialize)]
struct RawUser {
    username: String,
}

#[derive(Deserialize)]
struct RawDiscussion {
    id: String,
    #[serde(default)]
    notes: Vec<RawNote>,
}

#[derive(Deserialize)]
struct RawNote {
    id: u64,
    author: Option<RawUser>,
    #[serde(default)]
    body: String,
    created_at: String,
    /// Notes GitLab writes itself, like "added 2 commits".
    #[serde(default)]
    system: bool,
    #[serde(default)]
    position: Option<RawPosition>,
}

#[derive(Deserialize)]
struct RawPosition {
    new_path: Option<String>,
    old_path: Option<String>,
    new_line: Option<u64>,
    old_line: Option<u64>,
}

#[derive(Deserialize)]
struct RawProject {
    #[serde(default)]
    squash_option: Option<String>,
}

/// The token's way in (header or bearer), or why GitLab won't take it.
async fn bearer(client: &reqwest::Client, project: &Project, token: &str) -> Result<bool> {
    auth_mode(client, project, token).await?.ok_or_else(|| {
        "GitLab didn't accept the token git keeps for it. Push or fetch to sign in again, or open it on GitLab.".into()
    })
}

/// Turn a discussion into comments: its first note, then the replies to it.
fn discussion_comments(discussion: RawDiscussion) -> Vec<Comment> {
    let mut comments = Vec::new();
    for (index, note) in discussion
        .notes
        .into_iter()
        .filter(|note| !note.system)
        .enumerate()
    {
        let position = note.position;
        comments.push(Comment {
            id: note.id.to_string(),
            author: note
                .author
                .map(|author| author.username)
                .unwrap_or_default(),
            body: note.body,
            created: note.created_at,
            review: None,
            path: position.as_ref().and_then(|position| {
                position
                    .new_path
                    .clone()
                    .or_else(|| position.old_path.clone())
            }),
            line: position
                .as_ref()
                .and_then(|position| position.new_line.or(position.old_line)),
            hunk: None,
            thread: Some(discussion.id.clone()),
            reply: index > 0,
        });
    }
    comments
}

/// Merge request `iid`'s conversation: its comments and threads (without GitLab's own notes).
pub(crate) async fn conversation(
    project: &Project,
    token: Option<&str>,
    iid: u64,
) -> Result<Conversation> {
    let client = client()?;
    let bearer = match token {
        Some(token) => auth_mode(&client, project, token).await?,
        None => None,
    };
    let token = bearer.and(token);
    let bearer = bearer.unwrap_or(false);
    let answer = get(
        &client,
        &format!(
            "{}/merge_requests/{iid}/discussions?per_page=100",
            project.api
        ),
        token,
        bearer,
    )
    .await
    .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
    if !answer.status().is_success() {
        return Err(format!("GitLab didn't show the comments ({}).", answer.status()).into());
    }
    let discussions: Vec<RawDiscussion> = answer.json().await.unwrap_or_default();
    let comments = discussions
        .into_iter()
        .flat_map(discussion_comments)
        .collect();

    let you = match token {
        Some(_) => match get(
            &client,
            &format!("{}/user", api_root(project)),
            token,
            bearer,
        )
        .await
        {
            Ok(answer) if answer.status().is_success() => answer
                .json::<RawUser>()
                .await
                .ok()
                .map(|user| user.username),
            _ => None,
        },
        None => None,
    };
    let squash = match get(&client, &project.api, token, bearer).await {
        Ok(answer) if answer.status().is_success() => answer
            .json::<RawProject>()
            .await
            .ok()
            .and_then(|project| project.squash_option),
        _ => None,
    };
    // How the project merges (merge commit, fast-forward…) is its own setting: only
    // squashing or not is up to the one merging, when the project lets them choose.
    let merge_methods = match squash.as_deref() {
        Some("always") => vec![MergeMethod::Squash],
        Some("never") => vec![MergeMethod::Merge],
        Some("default_on") => vec![MergeMethod::Squash, MergeMethod::Merge],
        _ => vec![MergeMethod::Merge, MergeMethod::Squash],
    };
    Ok(Conversation {
        comments: in_threads(comments),
        you,
        merge_methods,
        can_request_changes: false,
    })
}

/// The API's root, like `https://gitlab.com/api/v4`.
fn api_root(project: &Project) -> &str {
    project
        .api
        .split_once("/projects/")
        .map_or(project.api.as_str(), |(root, _)| root)
}

/// Send `body` to GitLab with `method`, and read its answer, or what went wrong.
async fn send(
    project: &Project,
    token: &str,
    method: reqwest::Method,
    url: String,
    body: Value,
    doing: &str,
) -> Result<Value> {
    let client = client()?;
    let bearer = bearer(&client, project, token).await?;
    let request = client.request(method, url);
    let request = if bearer {
        request.bearer_auth(token)
    } else {
        request.header("PRIVATE-TOKEN", token)
    };
    let request = if body.is_null() {
        request
    } else {
        request.json(&body)
    };
    let response = request
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitLab ({e})"))?;
    let status = response.status();
    let answer: Value = response.json().await.unwrap_or_default();
    if status.is_success() {
        return Ok(answer);
    }
    let message = error_message(&answer).unwrap_or_else(|| status.to_string());
    Err(match status.as_u16() {
        401 | 403 | 404 => format!(
            "GitLab didn't let you {doing} ({message}). The token may not be allowed to write merge requests here."
        )
        .into(),
        _ => format!("GitLab couldn't {doing}: {message}").into(),
    })
}

/// Comment on merge request `iid`, or reply in a thread (a discussion).
pub(crate) async fn comment(
    project: &Project,
    token: &str,
    iid: u64,
    body: &str,
    thread: Option<&str>,
) -> Result<String> {
    let url = match thread {
        Some(thread) => format!(
            "{}/merge_requests/{iid}/discussions/{thread}/notes",
            project.api
        ),
        None => format!("{}/merge_requests/{iid}/notes", project.api),
    };
    send(
        project,
        token,
        reqwest::Method::POST,
        url,
        json!({ "body": body }),
        "comment on it",
    )
    .await?;
    Ok(if thread.is_some() {
        "Replied"
    } else {
        "Commented"
    }
    .to_owned())
}

/// Review merge request `iid`: approve it (with a comment, if any), or comment.
pub(crate) async fn review(
    project: &Project,
    token: &str,
    iid: u64,
    verdict: ReviewVerdict,
    body: &str,
) -> Result<String> {
    match verdict {
        ReviewVerdict::RequestChanges => {
            Err("GitLab doesn't take requests for changes from here: say what should change in a comment.".into())
        }
        ReviewVerdict::Comment => comment(project, token, iid, body, None).await,
        ReviewVerdict::Approve => {
            send(
                project,
                token,
                reqwest::Method::POST,
                format!("{}/merge_requests/{iid}/approve", project.api),
                json!({}),
                "approve it",
            )
            .await?;
            if !body.is_empty() {
                comment(project, token, iid, body, None).await?;
            }
            Ok(format!("Approved !{iid}"))
        }
    }
}

/// Merge merge request `iid`, squashed or not, deleting its branch if asked.
pub(crate) async fn merge(
    project: &Project,
    token: &str,
    iid: u64,
    options: &MergeRequestOptions,
) -> Result<String> {
    let squash = options.method == MergeMethod::Squash;
    let mut payload = json!({
        "squash": squash,
        "should_remove_source_branch": options.delete_branch,
    });
    let title = options.title.trim();
    if !title.is_empty() {
        let message = if options.message.trim().is_empty() {
            title.to_owned()
        } else {
            format!("{title}\n\n{}", options.message.trim())
        };
        payload[if squash {
            "squash_commit_message"
        } else {
            "merge_commit_message"
        }] = json!(message);
    }
    send(
        project,
        token,
        reqwest::Method::PUT,
        format!("{}/merge_requests/{iid}/merge", project.api),
        payload,
        "merge it",
    )
    .await?;
    Ok(format!(
        "Merged !{iid}{}",
        if options.delete_branch {
            " and deleted its branch"
        } else {
            ""
        }
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_threads_without_gitlab_s_own_notes() {
        let discussion: RawDiscussion = serde_json::from_value(json!({
            "id": "abc",
            "notes": [
                { "id": 1, "author": { "username": "theo" }, "body": "added 2 commits", "created_at": "2026-01-01", "system": true },
                { "id": 2, "author": { "username": "rosa" }, "body": "Why 2K?", "created_at": "2026-01-02",
                  "position": { "new_path": "Content/Barber.uasset", "old_path": "Content/Barber.uasset", "new_line": 12, "old_line": null } },
                { "id": 3, "author": { "username": "theo" }, "body": "Budget.", "created_at": "2026-01-03" }
            ]
        }))
        .unwrap_or_else(|e| panic!("{e}"));
        let comments = discussion_comments(discussion);
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].path.as_deref(), Some("Content/Barber.uasset"));
        assert_eq!(comments[0].line, Some(12));
        assert!(!comments[0].reply);
        assert!(comments[1].reply);
        assert_eq!(comments[1].thread.as_deref(), Some("abc"));
    }

    #[test]
    fn finds_the_api_root() {
        let project = Project {
            remote: "origin".into(),
            host: "gitlab.com".into(),
            api: "https://gitlab.com/api/v4/projects/group%2Fapp".into(),
        };
        assert_eq!(api_root(&project), "https://gitlab.com/api/v4");
    }
}
