//! Pull requests (GitHub) and merge requests (GitLab) in the app: what's needed to open
//! one for a branch, opening it, and one request's details: its description, reviews,
//! checks and whether it can be merged. The sites are asked with the token git keeps for
//! them, as for the badges on the branch labels.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::git::Git;
use crate::github::{CheckState, Forge, PullRequest};

/// What the dialog for a new pull request starts from.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NewRequestInfo {
    pub forge: Forge,
    /// The remote on the site, like "origin".
    pub remote: String,
    /// The branches on that remote, to merge into (without the remote's name).
    pub bases: Vec<String>,
    /// The one to suggest: the remote's default branch.
    pub base: Option<String>,
    /// Git keeps a token for the site (without one, the request is opened in the browser).
    pub signed_in: bool,
    /// The branch is on the remote already.
    pub on_remote: bool,
    /// Commits of the local branch that aren't on the remote yet.
    pub unpushed: u32,
    /// The commits the request would bring into the suggested base, oldest first (at most 50).
    pub commits: Vec<CommitMessage>,
    /// Who owns the files it changes, by the repository's CODEOWNERS (most files first).
    pub owners: Vec<String>,
}

/// A commit's message: its first line, and the rest.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CommitMessage {
    pub summary: String,
    pub body: String,
}

/// A pull request to open: `branch` (on the remote) into `base`.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NewRequest {
    pub branch: String,
    pub base: String,
    pub title: String,
    #[ts(as = "Option<_>", optional)]
    #[serde(default)]
    pub body: String,
    #[ts(as = "Option<_>", optional)]
    #[serde(default)]
    pub draft: bool,
    /// People (`@user`) and teams (`@org/team`) to ask for a review.
    #[ts(as = "Option<_>", optional)]
    #[serde(default)]
    pub reviewers: Vec<String>,
}

/// Where a request is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum RequestState {
    Open,
    Draft,
    Merged,
    Closed,
}

/// Whether a request can be merged as it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Mergeable {
    /// Nothing in the way.
    Ready,
    /// Its branch conflicts with the one it goes into.
    Conflicts,
    /// Its branch is behind the one it goes into, which must be merged in first.
    Behind,
    /// Something else must happen first: approvals, passing checks, resolved threads.
    Blocked,
    /// The site is still working it out.
    Checking,
}

/// What a reviewer made of a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ReviewState {
    Approved,
    ChangesRequested,
    Commented,
    /// Asked to review, and hasn't yet.
    Requested,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "RequestReview")]
pub struct Review {
    pub author: String,
    pub state: ReviewState,
}

/// One check (GitHub) or pipeline job (GitLab).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "RequestCheck")]
pub struct Check {
    pub name: String,
    /// None when it was skipped, or neither passed nor failed.
    pub state: Option<CheckState>,
    /// Its page on the site.
    pub url: Option<String>,
    /// A line about it, like the stage of a GitLab job.
    pub detail: Option<String>,
    /// When it started running (RFC 3339), if it has.
    pub started_at: Option<String>,
    /// When it finished (RFC 3339), if it has.
    pub finished_at: Option<String>,
    /// What it's part of, to group it by: its GitHub workflow (or the app that ran it),
    /// or its GitLab stage.
    pub workflow: Option<String>,
    /// What started that, in words, like "on push to develop".
    pub trigger: Option<String>,
    /// Its GitHub check suite, which tells which workflow run it's part of.
    #[serde(skip)]
    pub suite: Option<u64>,
}

/// One pull (or merge) request in full.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RequestDetails {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// Its description, as written (Markdown).
    pub body: String,
    pub author: String,
    pub state: RequestState,
    /// The branch it goes into, and its own.
    pub base: String,
    pub branch: String,
    /// When it was opened (RFC 3339).
    pub created: String,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub files: Option<u64>,
    pub comments: u64,
    /// None when it's closed, merged or a draft.
    pub mergeable: Option<Mergeable>,
    pub reviews: Vec<Review>,
    pub checks: Vec<Check>,
    pub forge: Forge,
    /// The commits it's between: where the branch it goes into is, and its own branch's
    /// last commit (to compare them in the app once they're fetched).
    pub base_sha: Option<String>,
    pub head_sha: Option<String>,
    /// It merges by itself once its checks pass (GitHub's auto-merge, GitLab's "merge when
    /// the pipeline succeeds").
    pub auto_merge: bool,
}

/// The site the repository's pull requests are on, and its token.
pub(crate) enum Site {
    GitHub {
        remote: String,
        full_name: String,
        token: Option<String>,
    },
    GitLab {
        project: crate::gitlab::Project,
        token: Option<String>,
    },
}

/// The repository's site (GitHub before GitLab, like the badges), with the token git keeps.
pub(crate) fn site(path: &Path) -> Result<Site> {
    let git = Git::find(path.to_owned())?;
    if let Some((remote, full_name)) = crate::github::github_repository(path)? {
        let token = git.stored_password(crate::github::HOST);
        return Ok(Site::GitHub {
            remote,
            full_name,
            token,
        });
    }
    if let Some(project) = crate::gitlab::gitlab_project(path)? {
        let token = git.stored_password(&project.host);
        return Ok(Site::GitLab { project, token });
    }
    Err("This repository isn't on GitHub or GitLab.".into())
}

pub(crate) async fn site_of(path: &Path) -> Result<Site> {
    let path = path.to_owned();
    tauri::async_runtime::spawn_blocking(move || site(&path))
        .await
        .map_err(|e| Error::Message(e.to_string()))?
}

/// A pull or merge request, for Team activity's figures.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecentRequest {
    pub number: u64,
    pub title: String,
    /// Its author's login.
    pub author: String,
    pub draft: bool,
    /// When it was opened, merged and closed (RFC 3339).
    pub created: String,
    pub merged: Option<String>,
    pub closed: Option<String>,
}

#[derive(serde::Deserialize)]
struct RawRecentPull {
    number: u64,
    title: String,
    user: Option<RawLogin>,
    #[serde(default)]
    draft: bool,
    created_at: String,
    merged_at: Option<String>,
    closed_at: Option<String>,
}

#[derive(serde::Deserialize)]
struct RawLogin {
    login: String,
}

/// The repository's pull requests (or merge requests) most recently updated, up to 100:
/// enough for a month of most teams. Empty when the site can't be reached.
pub async fn recent_requests(path: &Path) -> Result<Vec<RecentRequest>> {
    match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => {
            let client = crate::github::client()?;
            let url = format!(
                "https://api.github.com/repos/{full_name}/pulls?state=all&sort=updated&direction=desc&per_page=100"
            );
            let response = crate::github::api_request(&client, url, token.as_deref())
                .send()
                .await
                .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
            if !response.status().is_success() {
                return Ok(Vec::new());
            }
            let pulls: Vec<RawRecentPull> = response
                .json()
                .await
                .map_err(|e| format!("Couldn't read the pull requests ({e})"))?;
            Ok(pulls
                .into_iter()
                .map(|pull| RecentRequest {
                    number: pull.number,
                    title: pull.title,
                    author: pull.user.map(|user| user.login).unwrap_or_default(),
                    draft: pull.draft,
                    created: pull.created_at,
                    merged: pull.merged_at,
                    closed: pull.closed_at,
                })
                .collect())
        }
        Site::GitLab { project, token } => {
            crate::gitlab::recent_requests(&project, token.as_deref()).await
        }
    }
}

/// The branches a new request could go into, and which to suggest.
///
/// `branch` is its name on the remote; `local` the local branch, when there is one.
pub async fn new_request_info(
    path: &Path,
    branch: String,
    local: Option<String>,
) -> Result<NewRequestInfo> {
    let site = site_of(path).await?;
    let (forge, remote, signed_in) = match &site {
        Site::GitHub { remote, token, .. } => (Forge::GitHub, remote.clone(), token.is_some()),
        Site::GitLab { project, token } => (Forge::GitLab, project.remote.clone(), token.is_some()),
    };
    let path = path.to_owned();
    let remote_name = remote.clone();
    let (bases, base, on_remote, unpushed, commits, owners) =
        tauri::async_runtime::spawn_blocking(move || {
            let repo = crate::repo::open(&path)?;
            let git = Git::find(path.clone())?;
            let (bases, base) = remote_branches(&repo, &remote_name);
            let remote_ref = format!("refs/remotes/{remote_name}/{branch}");
            let on_remote = git
                .run(&["rev-parse", "--verify", "--quiet", &remote_ref])
                .is_ok();
            let local_ref = local.map(|name| format!("refs/heads/{name}"));
            let unpushed = match (&local_ref, on_remote) {
                (Some(local_ref), true) => count(&git, &format!("{remote_ref}..{local_ref}")),
                (Some(local_ref), false) => match &base {
                    Some(base) => count(
                        &git,
                        &format!("refs/remotes/{remote_name}/{base}..{local_ref}"),
                    ),
                    None => 0,
                },
                (None, _) => 0,
            };
            let head = local_ref.unwrap_or(remote_ref);
            // The files it changes, and who owns them.
            let owners = match &base {
                Some(base) => {
                    let range = format!("refs/remotes/{remote_name}/{base}...{head}");
                    let files = git
                        .run(&["diff", "--name-only", "--no-renames", "-z", &range])
                        .unwrap_or_default();
                    let files: Vec<&str> = files.split('\0').filter(|f| !f.is_empty()).collect();
                    let top = repo.workdir().unwrap_or(&path).to_owned();
                    crate::codeowners::owners_of_all(&top, &files)
                }
                None => Vec::new(),
            };
            let commits = match &base {
                Some(base) => {
                    let range = format!("refs/remotes/{remote_name}/{base}..{head}");
                    git.run(&[
                        "log",
                        "--reverse",
                        "--max-count=50",
                        "--format=%s%x1f%b%x1e",
                        &range,
                    ])
                    .map(|log| messages(&log))
                    .unwrap_or_default()
                }
                None => Vec::new(),
            };
            Ok::<_, Error>((bases, base, on_remote, unpushed, commits, owners))
        })
        .await
        .map_err(|e| Error::Message(e.to_string()))??;
    Ok(NewRequestInfo {
        forge,
        remote,
        bases,
        base,
        signed_in,
        on_remote,
        unpushed,
        commits,
        owners,
    })
}

fn count(git: &Git, range: &str) -> u32 {
    git.run(&["rev-list", "--count", range])
        .ok()
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(0)
}

/// `git log --format=%s%x1f%b%x1e` as messages.
fn messages(log: &str) -> Vec<CommitMessage> {
    log.split('\x1e')
        .filter_map(|entry| {
            let entry = entry.trim_start_matches('\n');
            let (summary, body) = entry.split_once('\x1f')?;
            Some(CommitMessage {
                summary: summary.to_owned(),
                body: body.trim().to_owned(),
            })
        })
        .collect()
}

/// The branches of `remote` (by their names there), and its default one: what its HEAD
/// points at, or else main, master, develop or trunk.
fn remote_branches(repo: &gix::Repository, remote: &str) -> (Vec<String>, Option<String>) {
    let prefix = format!("refs/remotes/{remote}/");
    let mut names: Vec<String> = repo
        .references()
        .ok()
        .and_then(|references| {
            references.prefixed(prefix.as_str()).ok().map(|iter| {
                iter.filter_map(Result::ok)
                    .map(|reference| reference.name().as_bstr().to_string())
                    .filter_map(|full| full.strip_prefix(&prefix).map(str::to_owned))
                    .filter(|name| name != "HEAD")
                    .collect()
            })
        })
        .unwrap_or_default();
    names.sort();
    let head = repo
        .try_find_reference(format!("{prefix}HEAD").as_str())
        .ok()
        .flatten()
        .and_then(|reference| match reference.target() {
            gix::refs::TargetRef::Symbolic(name) => name
                .as_bstr()
                .to_string()
                .strip_prefix(&prefix)
                .map(str::to_owned),
            gix::refs::TargetRef::Object(_) => None,
        });
    let base = head.filter(|name| names.contains(name)).or_else(|| {
        ["main", "master", "develop", "trunk"]
            .iter()
            .find(|name| names.iter().any(|n| n == *name))
            .map(|name| (*name).to_owned())
    });
    (names, base)
}

/// Open a pull (or merge) request.
pub async fn create_request(path: &Path, request: NewRequest) -> Result<PullRequest> {
    if request.title.trim().is_empty() {
        return Err("Give it a title.".into());
    }
    if request.branch == request.base {
        return Err("Choose another branch to merge it into.".into());
    }
    match site_of(path).await? {
        Site::GitHub {
            remote,
            full_name,
            token,
        } => {
            let token = token
                .ok_or("Sign in to GitHub first (Settings, GitHub), or open it in the browser.")?;
            crate::github::pulls::create(&remote, &full_name, &token, &request).await
        }
        Site::GitLab { project, token } => {
            let token = token.ok_or(
                "Git has no token for this GitLab server yet: push or fetch once to sign in, or open it in the browser.",
            )?;
            crate::gitlab::create(&project, &token, &request).await
        }
    }
}

/// One request's details: description, reviews, checks, and whether it can be merged.
pub async fn request_details(path: &Path, number: u64) -> Result<RequestDetails> {
    match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => crate::github::pulls::details(&full_name, token.as_deref(), number).await,
        Site::GitLab { project, token } => {
            crate::gitlab::details(&project, token.as_deref(), number).await
        }
    }
}

/// The message of an error answer from GitHub or GitLab: GitHub's `message` and
/// `errors[].message`, or GitLab's `message` (text, a list, or fields with lists) or `error`.
pub(crate) fn error_message(body: &serde_json::Value) -> Option<String> {
    use serde_json::Value;
    fn text(value: &Value) -> Option<String> {
        match value {
            Value::String(text) => Some(text.clone()),
            Value::Array(items) => {
                let parts: Vec<String> = items.iter().filter_map(text).collect();
                (!parts.is_empty()).then(|| parts.join(" "))
            }
            Value::Object(fields) => {
                let parts: Vec<String> = fields
                    .iter()
                    .filter_map(|(field, value)| text(value).map(|t| format!("{field} {t}")))
                    .collect();
                (!parts.is_empty()).then(|| parts.join("; "))
            }
            _ => None,
        }
    }
    // GitHub's details say more than its "Validation Failed".
    let details: Vec<String> = body
        .get("errors")
        .and_then(Value::as_array)
        .map(|errors| {
            errors
                .iter()
                .filter_map(|error| error.get("message").and_then(text))
                .collect()
        })
        .unwrap_or_default();
    if !details.is_empty() {
        return Some(details.join(" "));
    }
    body.get("message")
        .and_then(text)
        .or_else(|| body.get("error").and_then(text))
}

/// Checks in the order to show them: failed, running, passed, then the rest; by name within.
pub(crate) fn sort_checks(checks: &mut [Check]) {
    let rank = |check: &Check| match check.state {
        Some(CheckState::Failure) => 0,
        Some(CheckState::Pending) => 1,
        Some(CheckState::Success) => 2,
        Some(CheckState::Cancelled) => 3,
        None => 4,
    };
    checks.sort_by(|a, b| {
        rank(a)
            .cmp(&rank(b))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

/// Publish a release for `tag` (already on the remote) on the repository's site, titled
/// `title`, described by `notes` (Markdown). Returns its page.
pub async fn publish_release(
    path: &Path,
    tag: String,
    title: String,
    notes: String,
) -> Result<String> {
    if tag.trim().is_empty() || tag.starts_with('-') {
        return Err("Choose the tag to publish.".into());
    }
    let title = if title.trim().is_empty() {
        tag.clone()
    } else {
        title.trim().to_owned()
    };
    match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => {
            let token = token.ok_or("Sign in to GitHub first (Settings, GitHub).")?;
            let response = crate::github::client()?
                .post(format!("https://api.github.com/repos/{full_name}/releases"))
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .bearer_auth(&token)
                .json(&serde_json::json!({ "tag_name": tag, "name": title, "body": notes }))
                .send()
                .await
                .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
            let status = response.status();
            let answer: serde_json::Value = response.json().await.unwrap_or_default();
            if !status.is_success() {
                let message = error_message(&answer).unwrap_or_else(|| status.to_string());
                return Err(match status.as_u16() {
                    422 if message.contains("already_exists")
                        || message.contains("already exists") =>
                    {
                        format!("{tag} already has a release on GitHub.").into()
                    }
                    422 => format!("GitHub didn't publish it ({message}). Is {tag} pushed?").into(),
                    401 => "GitHub didn't accept the token git keeps: sign in again in Settings."
                        .into(),
                    _ => format!("GitHub didn't publish it: {message}").into(),
                });
            }
            Ok(answer["html_url"].as_str().unwrap_or_default().to_owned())
        }
        Site::GitLab { project, token } => {
            let token = token.ok_or(
                "Git has no token for this GitLab server yet: push or fetch once to sign in.",
            )?;
            crate::gitlab::publish_release(&project, &token, &tag, &title, &notes).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_error_messages() {
        let github = serde_json::json!({
            "message": "Validation Failed",
            "errors": [{"resource": "PullRequest", "code": "custom", "message": "A pull request already exists for maya:feat/menu."}]
        });
        assert_eq!(
            error_message(&github).unwrap(),
            "A pull request already exists for maya:feat/menu."
        );
        let gitlab = serde_json::json!({"message": ["Another open merge request already exists for this source branch: !12"]});
        assert!(error_message(&gitlab).unwrap().starts_with("Another open"));
        let fields = serde_json::json!({"message": {"target_branch": ["is invalid"]}});
        assert_eq!(error_message(&fields).unwrap(), "target_branch is invalid");
        assert_eq!(
            error_message(&serde_json::json!({"error": "insufficient_scope"})).unwrap(),
            "insufficient_scope"
        );
        assert_eq!(error_message(&serde_json::json!({})), None);
    }

    #[test]
    fn reads_commit_messages() {
        let found = messages("Add a\x1f\x1e\nFix b\x1fBecause it broke.\n\nTwice.\n\x1e\n");
        assert_eq!(found.len(), 2);
        assert_eq!(
            (found[0].summary.as_str(), found[0].body.as_str()),
            ("Add a", "")
        );
        assert_eq!(found[1].body, "Because it broke.\n\nTwice.");
    }

    #[test]
    fn sorts_checks_failed_first() {
        let check = |name: &str, state| Check {
            name: name.into(),
            state,
            ..Check::default()
        };
        let mut checks = vec![
            check("lint", Some(CheckState::Success)),
            check("docs", None),
            check("test", Some(CheckState::Failure)),
            check("build", Some(CheckState::Pending)),
            check("audit", Some(CheckState::Success)),
        ];
        sort_checks(&mut checks);
        let names: Vec<_> = checks.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["test", "build", "audit", "lint", "docs"]);
    }
}

/// A change to an open request, from its view.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RequestChange {
    /// Ready for review (false), or back to a draft (true).
    Draft { draft: bool },
    /// Ask these people (`maya`, or `@maya`) and teams (`@org/team`, GitHub) to review it.
    Reviewers { reviewers: Vec<String> },
    /// Merge by itself once its checks pass, with `method` ("merge", "squash", "rebase"),
    /// or not any more.
    AutoMerge {
        on: bool,
        #[ts(optional = nullable)]
        #[serde(default)]
        method: Option<String>,
    },
}

/// Change request `number`: draft or not, more reviewers, or auto-merge.
pub async fn change_request(path: &Path, number: u64, change: RequestChange) -> Result<String> {
    match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => {
            let token = token.ok_or("Sign in to GitHub first (Settings, Accounts).")?;
            crate::github::controls::change(&full_name, &token, number, change).await
        }
        Site::GitLab { project, token } => {
            let token = token.ok_or(
                "Git has no token for this GitLab server yet: push or fetch once to sign in.",
            )?;
            crate::gitlab::controls::change(&project, &token, number, change).await
        }
    }
}
