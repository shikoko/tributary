//! Opening a pull request on GitHub, and reading one in full: its reviews and checks.

use serde::Deserialize;

use super::{CheckState, Forge, PullRequest, RawPull, api_request, client};
use crate::error::Result;
use crate::requests::{
    Check, Mergeable, NewRequest, RequestDetails, RequestState, Review, ReviewState, error_message,
    sort_checks,
};

/// People and teams to ask for a review: `@user` are people; `@org/team` teams of the
/// repository's own organization. Email addresses, and the request's author (who can't
/// review it), are left out.
pub(crate) fn reviewers_and_teams(
    full_name: &str,
    wanted: &[String],
    author: &str,
) -> (Vec<String>, Vec<String>) {
    let org = full_name
        .split('/')
        .next()
        .unwrap_or_default()
        .to_lowercase();
    let (mut people, mut teams) = (Vec::new(), Vec::new());
    for name in wanted {
        let Some(name) = name.strip_prefix('@') else {
            continue;
        };
        match name.split_once('/') {
            Some((team_org, team)) if team_org.to_lowercase() == org => teams.push(team.to_owned()),
            Some(_) => {}
            None if !name.eq_ignore_ascii_case(author) => people.push(name.to_owned()),
            None => {}
        }
    }
    (people, teams)
}

/// Ask for reviews on pull request `number`. It's opened by then, so a refusal (someone
/// without access, say) leaves it as it is: the request shows who was asked.
pub(crate) async fn ask_for_reviews(
    full_name: &str,
    token: &str,
    number: u64,
    wanted: &[String],
    author: &str,
) {
    let (reviewers, team_reviewers) = reviewers_and_teams(full_name, wanted, author);
    if reviewers.is_empty() && team_reviewers.is_empty() {
        return;
    }
    let Ok(client) = client() else {
        return;
    };
    let _ = client
        .post(format!(
            "https://api.github.com/repos/{full_name}/pulls/{number}/requested_reviewers"
        ))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(token)
        .json(&serde_json::json!({ "reviewers": reviewers, "team_reviewers": team_reviewers }))
        .send()
        .await;
}

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
    let author = pull
        .user
        .as_ref()
        .map(|user| user.login.as_str())
        .unwrap_or_default();
    ask_for_reviews(full_name, token, pull.number, &request.reviewers, author).await;
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
    /// Set while auto-merge is on.
    #[serde(default)]
    auto_merge: Option<serde_json::Value>,
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
    started_at: Option<String>,
    completed_at: Option<String>,
    check_suite: Option<RawSuite>,
    app: Option<RawApp>,
}

#[derive(Deserialize)]
struct RawSuite {
    id: u64,
}

#[derive(Deserialize)]
struct RawApp {
    name: String,
}

#[derive(Deserialize)]
struct RawWorkflowRuns {
    #[serde(default)]
    workflow_runs: Vec<RawWorkflowRun>,
}

#[derive(Deserialize)]
struct RawWorkflowRun {
    name: Option<String>,
    event: String,
    head_branch: Option<String>,
    check_suite_id: u64,
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
    created_at: Option<String>,
    updated_at: Option<String>,
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
    // Waiting for a runner: it hasn't started, whatever its started_at says.
    let queued = matches!(
        run.status.as_str(),
        "queued" | "waiting" | "pending" | "requested"
    );
    let state = if run.status != "completed" {
        Some(CheckState::Pending)
    } else {
        match run.conclusion.as_deref() {
            Some("success") => Some(CheckState::Success),
            Some("cancelled") => Some(CheckState::Cancelled),
            Some("failure" | "timed_out" | "action_required" | "startup_failure") => {
                Some(CheckState::Failure)
            }
            _ => None,
        }
    };
    Check {
        name: run.name,
        state,
        url: run.html_url.or(run.details_url),
        detail: queued.then(|| "Queued".to_string()),
        started_at: run.started_at.filter(|_| !queued),
        finished_at: run.completed_at,
        // The app that ran it, until its workflow run is known (name_workflows).
        workflow: run.app.map(|app| app.name),
        trigger: None,
        suite: run.check_suite.map(|suite| suite.id),
    }
}

/// What started a workflow run, in words: "on push to develop", "on the pull request".
fn trigger(event: &str, branch: Option<&str>) -> String {
    match (event, branch) {
        ("push", Some(branch)) => format!("on push to {branch}"),
        ("push", None) => "on push".into(),
        ("pull_request" | "pull_request_target", _) => "on the pull request".into(),
        ("workflow_dispatch", _) => "run by hand".into(),
        ("schedule", _) => "on a schedule".into(),
        ("merge_group", _) => "in the merge queue".into(),
        ("release", _) => "on a release".into(),
        ("workflow_run", _) => "after another workflow".into(),
        (event, _) => format!("on {}", event.replace('_', " ")),
    }
}

/// Each GitHub Actions check's workflow and what started its run, from the runs for `sha`.
fn name_runs(checks: &mut [Check], runs: Vec<RawWorkflowRun>) {
    for check in checks {
        let Some(run) = runs
            .iter()
            .find(|run| Some(run.check_suite_id) == check.suite)
        else {
            continue;
        };
        if let Some(name) = &run.name {
            check.workflow = Some(name.clone());
        }
        check.trigger = Some(trigger(&run.event, run.head_branch.as_deref()));
    }
}

/// Names the workflow of each check of `sha` that GitHub Actions ran, and what started it,
/// so the checks can be grouped by run. One request; without it they keep the app's name.
async fn name_workflows(
    client: &reqwest::Client,
    full_name: &str,
    token: Option<&str>,
    sha: &str,
    checks: &mut [Check],
) {
    if checks.iter().all(|check| check.suite.is_none()) {
        return;
    }
    let url = format!(
        "https://api.github.com/repos/{full_name}/actions/runs?head_sha={sha}&per_page=100"
    );
    if let Ok(answer) = api_request(client, url, token).send().await
        && answer.status().is_success()
        && let Ok(runs) = answer.json::<RawWorkflowRuns>().await
    {
        name_runs(checks, runs.workflow_runs);
    }
}

fn status_check(status: RawStatus) -> Check {
    let state = match status.state.as_str() {
        "success" => Some(CheckState::Success),
        "pending" => Some(CheckState::Pending),
        "failure" | "error" => Some(CheckState::Failure),
        _ => None,
    };
    // A status is set when it starts and changed when it ends.
    let finished = state != Some(CheckState::Pending);
    Check {
        name: status.context,
        state,
        url: status.target_url.filter(|url| !url.is_empty()),
        detail: status.description.filter(|text| !text.is_empty()),
        started_at: status.created_at,
        finished_at: status.updated_at.filter(|_| finished),
        ..Check::default()
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
/// A commit's checks (GitHub Actions and other apps) and commit statuses, failures first.
pub(crate) async fn commit_checks(
    client: &reqwest::Client,
    full_name: &str,
    token: Option<&str>,
    sha: &str,
) -> Vec<Check> {
    let base = format!("https://api.github.com/repos/{full_name}");
    let get = |url: String| api_request(client, url, token).send();
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
    checks
}

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

    let mut checks = commit_checks(&client, full_name, token, &pull.head.sha).await;
    name_workflows(&client, full_name, token, &pull.head.sha, &mut checks).await;

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
        auto_merge: pull.auto_merge.is_some_and(|value| !value.is_null()),
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
    fn asks_people_and_the_organizations_teams() {
        let wanted: Vec<String> = [
            "@maya",
            "@studio/art",
            "@other/team",
            "rosa@example.com",
            "@Theo",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(
            reviewers_and_teams("Studio/feast", &wanted, "theo"),
            (vec!["maya".to_owned()], vec!["art".to_owned()])
        );
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
              {"name": "build", "status": "completed", "conclusion": "success", "html_url": "https://github.com/a/b/runs/1",
               "started_at": "2026-11-10T10:00:00Z", "completed_at": "2026-11-10T10:02:13Z"},
              {"name": "test", "status": "in_progress", "conclusion": null, "html_url": null, "details_url": "https://ci.example.com/2",
               "started_at": "2026-11-10T10:00:05Z", "completed_at": null},
              {"name": "deploy", "status": "completed", "conclusion": "skipped"},
              {"name": "package", "status": "queued", "conclusion": null, "started_at": "2026-11-10T10:00:00Z"}
            ]}"#,
        )
        .unwrap();
        let checks: Vec<Check> = runs.check_runs.into_iter().map(run_check).collect();
        assert_eq!(checks[0].state, Some(CheckState::Success));
        assert_eq!(checks[1].state, Some(CheckState::Pending));
        assert_eq!(checks[1].url.as_deref(), Some("https://ci.example.com/2"));
        assert_eq!(checks[2].state, None);
        // How long they took, or have been running.
        assert_eq!(
            checks[0].finished_at.as_deref(),
            Some("2026-11-10T10:02:13Z")
        );
        assert_eq!(
            checks[1].started_at.as_deref(),
            Some("2026-11-10T10:00:05Z")
        );
        assert_eq!(checks[1].finished_at, None);
        // Waiting for a runner: queued, not running yet.
        assert_eq!(checks[3].state, Some(CheckState::Pending));
        assert_eq!(checks[3].detail.as_deref(), Some("Queued"));
        assert_eq!(checks[3].started_at, None);
        let status = status_check(RawStatus {
            context: "ci/jenkins".into(),
            state: "error".into(),
            target_url: Some(String::new()),
            description: Some("Build broke".into()),
            created_at: Some("2026-11-10T10:00:00Z".into()),
            updated_at: Some("2026-11-10T10:04:00Z".into()),
        });
        assert_eq!(status.finished_at.as_deref(), Some("2026-11-10T10:04:00Z"));
        assert_eq!(status.state, Some(CheckState::Failure));
        assert_eq!(status.url, None);
        assert_eq!(status.detail.as_deref(), Some("Build broke"));
    }

    #[test]
    fn groups_checks_by_their_workflow_run() {
        let runs: RawCheckRuns = serde_json::from_str(
            r#"{"check_runs": [
              {"name": "macOS", "status": "in_progress", "check_suite": {"id": 11}, "app": {"name": "GitHub Actions"}},
              {"name": "Rust (Linux)", "status": "in_progress", "check_suite": {"id": 12}, "app": {"name": "GitHub Actions"}},
              {"name": "Preview", "status": "completed", "conclusion": "success", "check_suite": {"id": 13}, "app": {"name": "Vercel"}}
            ]}"#,
        )
        .unwrap();
        let mut checks: Vec<Check> = runs.check_runs.into_iter().map(run_check).collect();
        let found: RawWorkflowRuns = serde_json::from_str(
            r#"{"workflow_runs": [
              {"name": "Build", "event": "push", "head_branch": "develop", "check_suite_id": 11},
              {"name": "Checks", "event": "pull_request", "head_branch": "develop", "check_suite_id": 12}
            ]}"#,
        )
        .unwrap();
        name_runs(&mut checks, found.workflow_runs);
        let groups: Vec<(Option<&str>, Option<&str>)> = checks
            .iter()
            .map(|check| (check.workflow.as_deref(), check.trigger.as_deref()))
            .collect();
        assert_eq!(
            groups,
            [
                (Some("Build"), Some("on push to develop")),
                (Some("Checks"), Some("on the pull request")),
                // Not a GitHub Actions run: the app that ran it.
                (Some("Vercel"), None),
            ]
        );
        assert_eq!(trigger("workflow_dispatch", Some("main")), "run by hand");
        assert_eq!(
            trigger("repository_dispatch", None),
            "on repository dispatch"
        );
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
