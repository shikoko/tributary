//! Reviewing a pull (or merge) request in the app: its conversation (comments, reviews and
//! comments on lines), commenting and replying, approving or asking for changes, and
//! merging it. GitHub's and GitLab's sides are in `github/reviews.rs` and
//! `gitlab/reviews.rs`.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::requests::{ReviewState, Site, site};

/// One comment in a request's conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: String,
    /// As written (Markdown).
    pub body: String,
    /// When (RFC 3339).
    pub created: String,
    /// A review's verdict, when the comment is one.
    pub review: Option<ReviewState>,
    /// The file and line it's on, for a comment on the changes.
    pub path: Option<String>,
    pub line: Option<u64>,
    /// The lines it's about, from the diff (GitHub).
    pub hunk: Option<String>,
    /// The thread it's in: replies go to it. None when it can't be replied to.
    pub thread: Option<String>,
    /// It answers an earlier comment in its thread.
    pub reply: bool,
}

/// How to merge a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeMethod {
    /// With a merge commit.
    Merge,
    /// All its commits as one.
    Squash,
    /// Its commits replayed on top, one by one (GitHub).
    Rebase,
}

/// What a review says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewVerdict {
    Approve,
    RequestChanges,
    Comment,
}

/// A request's conversation, and what you can do with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    /// Oldest first; replies follow their thread's first comment.
    pub comments: Vec<Comment>,
    /// Who you are on the site, when git has a token for it.
    pub you: Option<String>,
    /// The ways it can be merged here, the site's default first.
    pub merge_methods: Vec<MergeMethod>,
    /// Asking for changes is possible (GitHub).
    pub can_request_changes: bool,
}

/// Comments in reading order: each thread's first comment where it was written, its
/// replies right after it, oldest first.
pub(crate) fn in_threads(mut comments: Vec<Comment>) -> Vec<Comment> {
    comments.sort_by(|a, b| a.created.cmp(&b.created));
    let (replies, firsts): (Vec<Comment>, Vec<Comment>) =
        comments.into_iter().partition(|comment| comment.reply);
    let mut ordered = Vec::with_capacity(firsts.len() + replies.len());
    for first in firsts {
        let thread = first.thread.clone();
        ordered.push(first);
        if thread.is_some() {
            ordered.extend(
                replies
                    .iter()
                    .filter(|reply| reply.thread == thread)
                    .cloned(),
            );
        }
    }
    // Replies whose first comment wasn't found (deleted, say) go last.
    let shown: std::collections::HashSet<String> =
        ordered.iter().map(|comment| comment.id.clone()).collect();
    ordered.extend(
        replies
            .into_iter()
            .filter(|reply| !shown.contains(&reply.id)),
    );
    ordered
}

async fn site_of(path: &Path) -> Result<Site> {
    let path = path.to_owned();
    tauri::async_runtime::spawn_blocking(move || site(&path))
        .await
        .map_err(|e| Error::Message(e.to_string()))?
}

const GITHUB_SIGN_IN: &str = "Sign in to GitHub first (Settings, Accounts), or open it on GitHub.";
const GITLAB_SIGN_IN: &str = "Git has no token for this GitLab server yet: push or fetch once to sign in, or open it on GitLab.";

/// Request `number`'s conversation.
pub async fn conversation(path: &Path, number: u64) -> Result<Conversation> {
    match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => crate::github::reviews::conversation(&full_name, token.as_deref(), number).await,
        Site::GitLab { project, token } => {
            crate::gitlab::reviews::conversation(&project, token.as_deref(), number).await
        }
    }
}

/// Comment on request `number`, or reply in a thread.
pub async fn comment(
    path: &Path,
    number: u64,
    body: String,
    thread: Option<String>,
) -> Result<String> {
    if body.trim().is_empty() {
        return Err("Write something first.".into());
    }
    match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => {
            let token = token.ok_or(GITHUB_SIGN_IN)?;
            crate::github::reviews::comment(
                &full_name,
                &token,
                number,
                body.trim(),
                thread.as_deref(),
            )
            .await
        }
        Site::GitLab { project, token } => {
            let token = token.ok_or(GITLAB_SIGN_IN)?;
            crate::gitlab::reviews::comment(
                &project,
                &token,
                number,
                body.trim(),
                thread.as_deref(),
            )
            .await
        }
    }
}

/// Review request `number`: approve it, ask for changes, or only comment.
pub async fn review(
    path: &Path,
    number: u64,
    verdict: ReviewVerdict,
    body: String,
) -> Result<String> {
    if verdict != ReviewVerdict::Approve && body.trim().is_empty() {
        return Err(match verdict {
            ReviewVerdict::RequestChanges => "Say what should change.",
            _ => "Write something first.",
        }
        .into());
    }
    match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => {
            let token = token.ok_or(GITHUB_SIGN_IN)?;
            crate::github::reviews::review(&full_name, &token, number, verdict, body.trim()).await
        }
        Site::GitLab { project, token } => {
            let token = token.ok_or(GITLAB_SIGN_IN)?;
            crate::gitlab::reviews::review(&project, &token, number, verdict, body.trim()).await
        }
    }
}

/// What merging a request should do.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequestOptions {
    pub method: MergeMethod,
    /// The merge (or squashed) commit's summary and message; the site's own when empty.
    pub title: String,
    pub message: String,
    /// Delete its branch afterwards.
    pub delete_branch: bool,
}

/// Merge request `number` on the site.
pub async fn merge(path: &Path, number: u64, options: MergeRequestOptions) -> Result<String> {
    match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => {
            let token = token.ok_or(GITHUB_SIGN_IN)?;
            crate::github::reviews::merge(&full_name, &token, number, &options).await
        }
        Site::GitLab { project, token } => {
            let token = token.ok_or(GITLAB_SIGN_IN)?;
            crate::gitlab::reviews::merge(&project, &token, number, &options).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn comment(id: &str, created: &str, thread: Option<&str>, reply: bool) -> Comment {
        Comment {
            id: id.into(),
            author: "rosa-bell".into(),
            body: id.into(),
            created: created.into(),
            review: None,
            path: None,
            line: None,
            hunk: None,
            thread: thread.map(Into::into),
            reply,
        }
    }

    #[test]
    fn puts_replies_after_their_thread() {
        let ordered = in_threads(vec![
            comment("reply", "2026-01-03", Some("1"), true),
            comment("later", "2026-01-02", None, false),
            comment("1", "2026-01-01", Some("1"), false),
            comment("orphan", "2026-01-04", Some("9"), true),
        ]);
        let ids: Vec<&str> = ordered.iter().map(|comment| comment.id.as_str()).collect();
        assert_eq!(ids, ["1", "reply", "later", "orphan"]);
    }
}
