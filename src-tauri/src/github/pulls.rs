//! Opening a pull request on GitHub, and reading one in full: its reviews and checks.

use serde::Deserialize;

use super::{CheckState, Forge, PullRequest, RawPull, api_request, client};
use crate::error::Result;
use crate::requests::{
    Check, Mergeable, NewRequest, RequestDetails, RequestState, Review, ReviewState, error_message,
    sort_checks,
};

/// Open a pull request from `request.branch` into `request.base`.
pub(crate) async fn create(
    remote: &str,
    full_name: &str,
    token: &str,
    request: &NewRequest,
) -> Result<PullRequest> {
    let body = serde_json::json!({
        "title": request.title.trim(),
        "head": request.branch,
        "base": request.base,
        "body": request.body,
        "draft": request.draft,
    });
    let response = client()?
        .post(format!("https://api.github.com/repos/{full_name}/pulls"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
    let status = response.status();
    if !status.is_success() {
        let answer: serde_json::Value = response.json().await.unwrap_or_default();
        let message = error_message(&answer).unwrap_or_else(|| status.to_string());
        return Err(match status.as_u16() {
            401 => "GitHub didn't accept the token git keeps: sign in again in Settings.".into(),
            403 | 404 => format!(
                "GitHub didn't let you open it ({message}). The token may not be allowed to write pull requests here."
            )
            .into(),
            _ => format!("GitHub didn't open it: {message}").into(),
        });
    }
    let pull: RawPull = response
        .json()
        .await
        .map_err(|e| format!("Couldn't read GitHub's answer ({e})"))?;
    Ok(PullRequest {
        number: pull.number,
        title: pull.title,
        url: pull.html_url,
        remote: remote.to_owned(),
        branch: pull.head.branch,
        draft: pull.draft,
        author: pull.user.map(|user| user.login).unwrap_or_default(),
        checks: None,
        forge: Forge::GitHub,
    })
}

#[derive(Deserialize)]
struct RawDetails {
    number: u64,
    title: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    state: String,
    #[serde(default)]
    merged: bool,
    #[serde(default)]
    draft: bool,
    user: Option<Login>,
    base: RawRef,
    head: RawRef,
    created_at: String,
    #[serde(default)]
    mergeable_state: Option<String>,
    #[serde(default)]
    comments: u64,
    #[serde(default)]
    review_comments: u64,
    additions: Option<u64>,
    deletions: Option<u64>,
    changed_files: Option<u64>,
    #[serde(default)]
    requested_reviewers: Vec<Login>,
    #[serde(default)]
    requested_teams: Vec<Team>,
}

#[derive(Deserialize)]
struct Login {
    login: String,
}

#[derive(Deserialize)]
struct Team {
    name: String,
}

#[derive(Deserialize)]
struct RawRef {
    #[serde(rename = "ref")]
    branch: String,
    sha: String,
}

#[derive(Deserialize)]
struct RawReview {
    user: Option<Login>,
    state: String,
}

#[derive(Deserialize)]
struct RawCheckRuns {
    #[serde(default)]
    check_runs: Vec<RawCheckRun>,
}

#[derive(Deserialize)]
struct RawCheckRun {
    name: String,
    status: String,
    conclusion: Option<String>,
    html_url: Option<String>,
    details_url: Option<String>,
}

#[derive(Deserialize)]
struct RawStatuses {
    #[serde(default)]
    statuses: Vec<RawStatus>,
}

#[derive(Deserialize)]
struct RawStatus {
    context: String,
    state: String,
    target_url: Option<String>,
    description: Option<String>,
}

/// Each reviewer's latest say: an approval or a request for changes counts over comments,
/// a dismissed review is taken back; reviewers asked who haven't answered come last.
fn reviews(raw: Vec<RawReview>, requested: Vec<String>) -> Vec<Review> {
    let mut result: Vec<Review> = Vec::new();
    for review in raw {
        let Some(author) = review.user.map(|user| user.login) else {
            continue;
        };
        let state = match review.state.as_str() {
            "APPROVED" => Some(ReviewState::Approved),
            "CHANGES_REQUESTED" => Some(ReviewState::ChangesRequested),
            "COMMENTED" => Some(ReviewState::Commented),
            "DISMISSED" => None,
            _ => continue,
        };
        let existing = result.iter().position(|r| r.author == author);
        match (state, existing) {
            (None, Some(index)) => {
                result.remove(index);
            }
            (None, None) => {}
            (Some(ReviewState::Commented), Some(_)) => {}
            (Some(state), Some(index)) => result[index].state = state,
            (Some(state), None) => result.push(Review { author, state }),
        }
    }
    for author in requested {
        // Asked again after reviewing: waiting on them again.
        result.retain(|review| review.author != author);
        result.push(Review {
            author,
            state: ReviewState::Requested,
        });
    }
    result
}

fn run_check(run: RawCheckRun) -> Check {
    let state = if run.status != "completed" {
        Some(CheckState::Pending)
    } else {
        match run.conclusion.as_deref() {
            Some("success") => Some(CheckState::Success),
            Some("failure" | "timed_out" | "cancelled" | "action_required" | "startup_failure") => {
                Some(CheckState::Failure)
            }
            _ => None,
        }
    };
    Check {
        name: run.name,
        state,
        url: run.html_url.or(run.details_url),
        detail: None,
    }
}

fn status_check(status: RawStatus) -> Check {
    Check {
        name: status.context,
        state: match status.state.as_str() {
            "success" => Some(CheckState::Success),
            "pending" => Some(CheckState::Pending),
            "failure" | "error" => Some(CheckState::Failure),
            _ => None,
        },
        url: status.target_url.filter(|url| !url.is_empty()),
        detail: status.description.filter(|text| !text.is_empty()),
    }
}

fn mergeable(state: Option<&str>) -> Option<Mergeable> {
    match state? {
        "clean" | "has_hooks" | "unstable" => Some(Mergeable::Ready),
        "dirty" => Some(Mergeable::Conflicts),
        "behind" => Some(Mergeable::Behind),
        "blocked" => Some(Mergeable::Blocked),
        "unknown" => Some(Mergeable::Checking),
        _ => None,
    }
}

/// Pull request `number` in full.
pub(crate) async fn details(
    full_name: &str,
    token: Option<&str>,
    number: u64,
) -> Result<RequestDetails> {
    let client = client()?;
    let base = format!("https://api.github.com/repos/{full_name}");
    let response = api_request(&client, format!("{base}/pulls/{number}"), token)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 => "GitHub didn't accept the token git keeps: sign in again in Settings.".into(),
            404 => format!("GitHub didn't show pull request #{number}: it isn't there, or this repository is private and you're not signed in.").into(),
            _ => format!("GitHub didn't show pull request #{number} ({}).", response.status()).into(),
        });
    }
    let pull: RawDetails = response
        .json()
        .await
        .map_err(|e| format!("Couldn't read pull request #{number} ({e})"))?;

    let get = |url: String| api_request(&client, url, token).send();
    let raw_reviews: Vec<RawReview> =
        match get(format!("{base}/pulls/{number}/reviews?per_page=100")).await {
            Ok(answer) if answer.status().is_success() => answer.json().await.unwrap_or_default(),
            _ => Vec::new(),
        };
    let requested = pull
        .requested_reviewers
        .into_iter()
        .map(|user| user.login)
        .chain(pull.requested_teams.into_iter().map(|team| team.name))
        .collect();

    let sha = &pull.head.sha;
    let mut checks: Vec<Check> =
        match get(format!("{base}/commits/{sha}/check-runs?per_page=100")).await {
            Ok(answer) if answer.status().is_success() => answer
                .json::<RawCheckRuns>()
                .await
                .map(|runs| runs.check_runs.into_iter().map(run_check).collect())
                .unwrap_or_default(),
            _ => Vec::new(),
        };
    if let Ok(answer) = get(format!("{base}/commits/{sha}/status")).await
        && answer.status().is_success()
        && let Ok(statuses) = answer.json::<RawStatuses>().await
    {
        checks.extend(statuses.statuses.into_iter().map(status_check));
    }
    sort_checks(&mut checks);

    let (base_sha, head_sha) = (Some(pull.base.sha.clone()), Some(pull.head.sha.clone()));
    let state = if pull.merged {
        RequestState::Merged
    } else if pull.state == "closed" {
        RequestState::Closed
    } else if pull.draft {
        RequestState::Draft
    } else {
        RequestState::Open
    };
    Ok(RequestDetails {
        number: pull.number,
        title: pull.title,
        url: pull.html_url,
        body: pull.body.unwrap_or_default(),
        author: pull.user.map(|user| user.login).unwrap_or_default(),
        mergeable: if state == RequestState::Open {
            mergeable(pull.mergeable_state.as_deref())
        } else {
            None
        },
        state,
        base: pull.base.branch,
        branch: pull.head.branch,
        created: pull.created_at,
        additions: pull.additions,
        deletions: pull.deletions,
        files: pull.changed_files,
        comments: pull.comments + pull.review_comments,
        reviews: reviews(raw_reviews, requested),
        checks,
        forge: Forge::GitHub,
        base_sha,
        head_sha,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn review(user: &str, state: &str) -> RawReview {
        RawReview {
            user: Some(Login { login: user.into() }),
            state: state.into(),
        }
    }

    #[test]
    fn keeps_each_reviewers_latest_say() {
        let found = reviews(
            vec![
                review("lena", "COMMENTED"),
                review("lena", "APPROVED"),
                review("lena", "COMMENTED"),
                review("theo", "CHANGES_REQUESTED"),
                review("theo", "DISMISSED"),
                review("sam", "COMMENTED"),
                review("rosa", "APPROVED"),
            ],
            vec!["rosa".into(), "diego".into()],
        );
        let pairs: Vec<_> = found.iter().map(|r| (r.author.as_str(), r.state)).collect();
        assert_eq!(
            pairs,
            [
                ("lena", ReviewState::Approved),
                ("sam", ReviewState::Commented),
                ("rosa", ReviewState::Requested),
                ("diego", ReviewState::Requested),
            ]
        );
    }

    #[test]
    fn reads_checks_and_statuses() {
        let runs: RawCheckRuns = serde_json::from_str(
            r#"{"check_runs": [
              {"name": "build", "status": "completed", "conclusion": "success", "html_url": "https://github.com/a/b/runs/1"},
              {"name": "test", "status": "in_progress", "conclusion": null, "html_url": null, "details_url": "https://ci.example.com/2"},
              {"name": "deploy", "status": "completed", "conclusion": "skipped"}
            ]}"#,
        )
        .unwrap();
        let checks: Vec<Check> = runs.check_runs.into_iter().map(run_check).collect();
        assert_eq!(checks[0].state, Some(CheckState::Success));
        assert_eq!(checks[1].state, Some(CheckState::Pending));
        assert_eq!(checks[1].url.as_deref(), Some("https://ci.example.com/2"));
        assert_eq!(checks[2].state, None);
        let status = status_check(RawStatus {
            context: "ci/jenkins".into(),
            state: "error".into(),
            target_url: Some(String::new()),
            description: Some("Build broke".into()),
        });
        assert_eq!(status.state, Some(CheckState::Failure));
        assert_eq!(status.url, None);
        assert_eq!(status.detail.as_deref(), Some("Build broke"));
    }

    #[test]
    fn tells_whether_it_can_be_merged() {
        assert_eq!(mergeable(Some("clean")), Some(Mergeable::Ready));
        assert_eq!(mergeable(Some("dirty")), Some(Mergeable::Conflicts));
        assert_eq!(mergeable(Some("blocked")), Some(Mergeable::Blocked));
        assert_eq!(mergeable(Some("draft")), None);
        assert_eq!(mergeable(None), None);
    }
}
