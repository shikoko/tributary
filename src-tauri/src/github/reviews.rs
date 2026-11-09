//! A pull request's conversation on GitHub, and reviewing, commenting on and merging it.

use serde::Deserialize;
use serde_json::{Value, json};

use super::{api_request, client};
use crate::error::Result;
use crate::requests::{ReviewState, error_message};
use crate::reviews::{
    Comment, Conversation, MergeMethod, MergeRequestOptions, ReviewVerdict, in_threads,
};

#[derive(Deserialize)]
struct Login {
    login: String,
}

#[derive(Deserialize)]
struct RawComment {
    id: u64,
    user: Option<Login>,
    #[serde(default)]
    body: Option<String>,
    created_at: String,
}

#[derive(Deserialize)]
struct RawReview {
    id: u64,
    user: Option<Login>,
    #[serde(default)]
    body: Option<String>,
    state: String,
    #[serde(default)]
    submitted_at: Option<String>,
}

#[derive(Deserialize)]
struct RawLineComment {
    id: u64,
    user: Option<Login>,
    #[serde(default)]
    body: Option<String>,
    created_at: String,
    path: String,
    line: Option<u64>,
    original_line: Option<u64>,
    #[serde(default)]
    diff_hunk: Option<String>,
    in_reply_to_id: Option<u64>,
}

#[derive(Deserialize)]
struct RawRepository {
    #[serde(default = "yes")]
    allow_merge_commit: bool,
    #[serde(default = "yes")]
    allow_squash_merge: bool,
    #[serde(default = "yes")]
    allow_rebase_merge: bool,
}

fn yes() -> bool {
    true
}

/// The last few lines of a diff hunk: the line commented on, and some before it.
fn hunk_tail(hunk: &str) -> String {
    let lines: Vec<&str> = hunk
        .lines()
        .filter(|line| !line.starts_with("@@"))
        .collect();
    lines[lines.len().saturating_sub(4)..].join("\n")
}

/// Pull request `number`'s conversation: its comments, reviews (with what they said), and
/// comments on lines with their replies.
pub(crate) async fn conversation(
    full_name: &str,
    token: Option<&str>,
    number: u64,
) -> Result<Conversation> {
    let client = client()?;
    let base = format!("https://api.github.com/repos/{full_name}");
    let get = |url: String| api_request(&client, url, token).send();
    let read =
        |what: &str, answer: reqwest::Result<reqwest::Response>| -> Result<reqwest::Response> {
            let answer = answer.map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
            if !answer.status().is_success() {
                return Err(format!("GitHub didn't show the {what} ({}).", answer.status()).into());
            }
            Ok(answer)
        };
    let comments: Vec<RawComment> = read(
        "comments",
        get(format!("{base}/issues/{number}/comments?per_page=100")).await,
    )?
    .json()
    .await
    .unwrap_or_default();
    let reviews: Vec<RawReview> = read(
        "reviews",
        get(format!("{base}/pulls/{number}/reviews?per_page=100")).await,
    )?
    .json()
    .await
    .unwrap_or_default();
    let lines: Vec<RawLineComment> = read(
        "comments on lines",
        get(format!("{base}/pulls/{number}/comments?per_page=100")).await,
    )?
    .json()
    .await
    .unwrap_or_default();

    let mut all = Vec::new();
    let author = |user: Option<Login>| {
        user.map(|user| user.login)
            .unwrap_or_else(|| "ghost".into())
    };
    for comment in comments {
        all.push(Comment {
            id: format!("c{}", comment.id),
            author: author(comment.user),
            body: comment.body.unwrap_or_default(),
            created: comment.created_at,
            review: None,
            path: None,
            line: None,
            hunk: None,
            thread: None,
            reply: false,
        });
    }
    for review in reviews {
        let state = match review.state.as_str() {
            "APPROVED" => ReviewState::Approved,
            "CHANGES_REQUESTED" => ReviewState::ChangesRequested,
            "COMMENTED" => ReviewState::Commented,
            _ => continue,
        };
        let body = review.body.unwrap_or_default();
        // A review that's only comments on lines says nothing of its own.
        if state == ReviewState::Commented && body.trim().is_empty() {
            continue;
        }
        all.push(Comment {
            id: format!("r{}", review.id),
            author: author(review.user),
            body,
            created: review.submitted_at.unwrap_or_default(),
            review: Some(state),
            path: None,
            line: None,
            hunk: None,
            thread: None,
            reply: false,
        });
    }
    for comment in lines {
        let thread = comment.in_reply_to_id.unwrap_or(comment.id);
        all.push(Comment {
            id: format!("l{}", comment.id),
            author: author(comment.user),
            body: comment.body.unwrap_or_default(),
            created: comment.created_at,
            review: None,
            path: Some(comment.path),
            line: comment.line.or(comment.original_line),
            hunk: comment.diff_hunk.as_deref().map(hunk_tail),
            thread: Some(thread.to_string()),
            reply: comment.in_reply_to_id.is_some(),
        });
    }

    let you = match token {
        Some(_) => match get("https://api.github.com/user".into()).await {
            Ok(answer) if answer.status().is_success() => {
                answer.json::<Login>().await.ok().map(|user| user.login)
            }
            _ => None,
        },
        None => None,
    };
    let merge_methods = match get(base.clone()).await {
        Ok(answer) if answer.status().is_success() => {
            let repository: RawRepository = answer.json().await.unwrap_or(RawRepository {
                allow_merge_commit: true,
                allow_squash_merge: true,
                allow_rebase_merge: true,
            });
            [
                (repository.allow_merge_commit, MergeMethod::Merge),
                (repository.allow_squash_merge, MergeMethod::Squash),
                (repository.allow_rebase_merge, MergeMethod::Rebase),
            ]
            .into_iter()
            .filter_map(|(allowed, method)| allowed.then_some(method))
            .collect()
        }
        _ => vec![MergeMethod::Merge, MergeMethod::Squash, MergeMethod::Rebase],
    };
    Ok(Conversation {
        comments: in_threads(all),
        you,
        merge_methods,
        can_request_changes: true,
    })
}

/// Send `body` to GitHub with `method`, and read its answer, or what went wrong (`doing`
/// says what was being done, like "approve it").
async fn send(
    method: reqwest::Method,
    url: String,
    token: &str,
    body: Value,
    doing: &str,
) -> Result<Value> {
    let request = client()?
        .request(method, url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(token);
    let request = if body.is_null() {
        request
    } else {
        request.json(&body)
    };
    let response = request
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
    let status = response.status();
    let answer: Value = response.json().await.unwrap_or_default();
    if status.is_success() {
        return Ok(answer);
    }
    let message = error_message(&answer).unwrap_or_else(|| status.to_string());
    Err(match status.as_u16() {
        401 => "GitHub didn't accept the token git keeps: sign in again in Settings.".into(),
        403 | 404 => format!(
            "GitHub didn't let you {doing} ({message}). The token may not be allowed to write pull requests here."
        )
        .into(),
        _ => format!("GitHub couldn't {doing}: {message}").into(),
    })
}

/// Comment on pull request `number`, or reply to a comment on its lines (`thread`).
pub(crate) async fn comment(
    full_name: &str,
    token: &str,
    number: u64,
    body: &str,
    thread: Option<&str>,
) -> Result<String> {
    let base = format!("https://api.github.com/repos/{full_name}");
    let url = match thread {
        Some(thread) => format!("{base}/pulls/{number}/comments/{thread}/replies"),
        None => format!("{base}/issues/{number}/comments"),
    };
    send(
        reqwest::Method::POST,
        url,
        token,
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

/// Review pull request `number`.
pub(crate) async fn review(
    full_name: &str,
    token: &str,
    number: u64,
    verdict: ReviewVerdict,
    body: &str,
) -> Result<String> {
    let (event, doing, done) = match verdict {
        ReviewVerdict::Approve => ("APPROVE", "approve it", format!("Approved #{number}")),
        ReviewVerdict::RequestChanges => (
            "REQUEST_CHANGES",
            "ask for changes",
            format!("Asked for changes to #{number}"),
        ),
        ReviewVerdict::Comment => ("COMMENT", "review it", format!("Reviewed #{number}")),
    };
    let mut payload = json!({ "event": event });
    if !body.is_empty() {
        payload["body"] = json!(body);
    }
    send(
        reqwest::Method::POST,
        format!("https://api.github.com/repos/{full_name}/pulls/{number}/reviews"),
        token,
        payload,
        doing,
    )
    .await?;
    Ok(done)
}

/// Merge pull request `number`, and delete its branch if asked (when it's in this repository).
pub(crate) async fn merge(
    full_name: &str,
    token: &str,
    number: u64,
    options: &MergeRequestOptions,
) -> Result<String> {
    let base = format!("https://api.github.com/repos/{full_name}");
    let mut payload = json!({
        "merge_method": match options.method {
            MergeMethod::Merge => "merge",
            MergeMethod::Squash => "squash",
            MergeMethod::Rebase => "rebase",
        },
    });
    if !options.title.trim().is_empty() && options.method != MergeMethod::Rebase {
        payload["commit_title"] = json!(options.title.trim());
        payload["commit_message"] = json!(options.message.trim());
    }
    send(
        reqwest::Method::PUT,
        format!("{base}/pulls/{number}/merge"),
        token,
        payload,
        "merge it",
    )
    .await?;
    let mut done = format!("Merged #{number}");
    if options.delete_branch {
        // The branch, if it's in this repository (not a fork's).
        let pull = send(
            reqwest::Method::GET,
            format!("{base}/pulls/{number}"),
            token,
            Value::Null,
            "read it",
        )
        .await;
        let head = pull.ok().and_then(|pull| {
            let branch = pull["head"]["ref"].as_str()?.to_owned();
            let repository = pull["head"]["repo"]["full_name"].as_str()?;
            (repository.eq_ignore_ascii_case(full_name)).then_some(branch)
        });
        if let Some(branch) = head {
            match send(
                reqwest::Method::DELETE,
                format!("{base}/git/refs/heads/{branch}"),
                token,
                Value::Null,
                "delete its branch",
            )
            .await
            {
                Ok(_) => done.push_str(&format!(" and deleted {branch}")),
                Err(error) => done.push_str(&format!(", but its branch is still there: {error}")),
            }
        }
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_end_of_a_hunk() {
        let hunk = "@@ -10,6 +10,7 @@ fn main()\n a\n b\n-c\n+d\n e";
        assert_eq!(hunk_tail(hunk), " b\n-c\n+d\n e");
    }
}
