//! CI for any commit, not only a pull request's: each commit's overall state (for a dot in
//! the list), a commit's checks or jobs in full, and re-running the failed ones, on GitHub
//! or GitLab. States are kept a while: finished ones longer than running ones.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use ts_rs::TS;

use crate::error::Result;
use crate::github::CheckState;
use crate::requests::{Check, Site, site_of};

/// At most this many commits are asked about at once.
const MOST_COMMITS: usize = 60;
/// Without a GitHub token, only this many (each is a request of its own).
const MOST_WITHOUT_TOKEN: usize = 8;

/// A commit's state as last asked (none: it has no CI), and when.
type Answer = (Instant, Option<CheckState>);

/// What's known of each commit, by repository and id.
static KNOWN: Mutex<Option<HashMap<(String, String), Answer>>> = Mutex::new(None);

/// How long an answer holds: running checks change soon, and failed ones may be run
/// again (on the site, or with Re-run failed); passed ones stay passed.
fn holds_for(state: Option<CheckState>) -> Duration {
    match state {
        Some(CheckState::Pending) => Duration::from_secs(45),
        Some(CheckState::Failure) => Duration::from_secs(60),
        // A cancelled one was mostly replaced by a newer run: it stays as it is.
        Some(CheckState::Success | CheckState::Cancelled) => Duration::from_secs(15 * 60),
        None => Duration::from_secs(5 * 60),
    }
}

/// A commit's checks in full.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CommitChecks {
    pub checks: Vec<Check>,
    /// Failed ones can be run again from here (signed in, and some failed).
    pub can_rerun: bool,
    /// "GitHub" or "GitLab".
    pub site: String,
}

/// A commit's CI run by run, for a graph of each: its GitHub Actions workflow runs, or its
/// latest GitLab pipeline, each with its jobs in groups and which group waits for which.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CommitRuns {
    pub runs: Vec<Run>,
    /// Checks that aren't a run's jobs: other apps' checks, and commit statuses.
    pub others: Vec<Check>,
    /// Failed ones can be run again from here (signed in, and some failed).
    pub can_rerun: bool,
    /// Asked with a token: it can be asked again often, since an unchanged answer costs
    /// nothing then (without one, GitHub allows 60 requests an hour).
    pub signed_in: bool,
    /// "GitHub" or "GitLab".
    pub site: String,
    /// The commit's checks on the site.
    pub url: Option<String>,
}

/// A workflow run (or a GitLab pipeline).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    /// Its workflow's name, like "Build" (or "Pipeline").
    pub name: String,
    /// What started it, like "on push to develop".
    pub trigger: Option<String>,
    /// Its page on the site.
    pub url: Option<String>,
    /// None when it was skipped.
    pub state: Option<CheckState>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    /// Its jobs, a group for each job of the workflow file (a stage on GitLab), in the
    /// file's order.
    pub groups: Vec<JobGroup>,
}

/// A job of a workflow file (or a GitLab stage) and the jobs it ran as: one, several for a
/// matrix, or none yet while it waits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct JobGroup {
    /// Its id in the workflow file (or the stage's name): what other groups' `needs` say.
    pub key: String,
    /// What to call it: its name without its `${{ }}` expressions, or its id.
    pub name: String,
    /// The keys of the groups it waits for.
    pub needs: Vec<String>,
    /// Its jobs show together, in a box: a matrix, or a stage.
    pub matrix: bool,
    pub jobs: Vec<Job>,
}

/// A job, with how far through its steps it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub name: String,
    /// None when it was skipped. Pending while queued or running (`started_at` says which).
    pub state: Option<CheckState>,
    pub url: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    /// Steps finished, and in all (both 0 when they aren't known, as on GitLab).
    pub steps_done: u32,
    pub steps: u32,
    /// The step it's on while it runs.
    pub step: Option<String>,
}

/// The CI state of each of `ids` (full commit ids) that has one.
pub async fn commit_states(path: &Path, ids: Vec<String>) -> Result<HashMap<String, CheckState>> {
    let repo = path.to_string_lossy().into_owned();
    let ids: Vec<String> = ids.into_iter().take(MOST_COMMITS).collect();
    let now = Instant::now();
    let mut states = HashMap::new();
    let mut wanted = Vec::new();
    {
        let mut known = KNOWN.lock().unwrap_or_else(|e| e.into_inner());
        let known = known.get_or_insert_with(HashMap::new);
        for id in ids {
            match known.get(&(repo.clone(), id.clone())) {
                Some((at, state)) if now.duration_since(*at) < holds_for(*state) => {
                    if let Some(state) = state {
                        states.insert(id, *state);
                    }
                }
                _ => wanted.push(id),
            }
        }
    }
    if wanted.is_empty() {
        return Ok(states);
    }
    let found: HashMap<String, CheckState> = match site_of(path).await? {
        Site::GitHub {
            full_name,
            token: Some(token),
            ..
        } => crate::github::ci::commit_states(&full_name, &token, &wanted).await,
        Site::GitHub {
            full_name,
            token: None,
            ..
        } => {
            wanted.truncate(MOST_WITHOUT_TOKEN);
            let client = crate::github::client()?;
            let mut found = HashMap::new();
            for id in &wanted {
                let checks =
                    crate::github::pulls::commit_checks(&client, &full_name, None, id).await;
                if let Some(state) = summary(&checks) {
                    found.insert(id.clone(), state);
                }
            }
            found
        }
        Site::GitLab { project, token } => {
            crate::gitlab::ci::commit_states(&project, token.as_deref(), &wanted)
                .await
                .into_iter()
                .collect()
        }
    };
    let mut known = KNOWN.lock().unwrap_or_else(|e| e.into_inner());
    let known = known.get_or_insert_with(HashMap::new);
    for id in wanted {
        let state = found.get(&id).copied();
        known.insert((repo.clone(), id.clone()), (now, state));
        if let Some(state) = state {
            states.insert(id, state);
        }
    }
    Ok(states)
}

/// One state for a list of checks: failed if any did, running if any are, passed if all did.
fn summary(checks: &[Check]) -> Option<CheckState> {
    let states: Vec<CheckState> = checks.iter().filter_map(|check| check.state).collect();
    if states.is_empty() {
        None
    } else if states.contains(&CheckState::Failure) {
        Some(CheckState::Failure)
    } else if states.contains(&CheckState::Pending) {
        Some(CheckState::Pending)
    } else if states.contains(&CheckState::Cancelled) {
        Some(CheckState::Cancelled)
    } else {
        Some(CheckState::Success)
    }
}

/// Commit `id`'s checks (GitHub) or latest pipeline's jobs (GitLab).
pub async fn commit_checks(path: &Path, id: String) -> Result<CommitChecks> {
    let site = site_of(path).await?;
    let (checks, signed_in, name) = match &site {
        Site::GitHub {
            full_name, token, ..
        } => {
            let client = crate::github::client()?;
            (
                crate::github::pulls::commit_checks(&client, full_name, token.as_deref(), &id)
                    .await,
                token.is_some(),
                "GitHub",
            )
        }
        Site::GitLab { project, token } => (
            crate::gitlab::ci::commit_checks(project, token.as_deref(), &id).await,
            token.is_some(),
            "GitLab",
        ),
    };
    // What's seen here is the latest: the dot follows it.
    if let Some(state) = summary(&checks) {
        let mut known = KNOWN.lock().unwrap_or_else(|e| e.into_inner());
        known.get_or_insert_with(HashMap::new).insert(
            (path.to_string_lossy().into_owned(), id.clone()),
            (Instant::now(), Some(state)),
        );
    }
    let can_rerun = signed_in
        && checks.iter().any(|check| {
            matches!(
                check.state,
                Some(CheckState::Failure | CheckState::Cancelled)
            )
        });
    Ok(CommitChecks {
        checks,
        can_rerun,
        site: name.to_owned(),
    })
}

/// Commit `id`'s CI run by run (its GitHub Actions workflow runs, or its latest GitLab
/// pipeline), with its jobs in groups and which group waits for which.
pub async fn commit_runs(path: &Path, id: String) -> Result<CommitRuns> {
    let site = site_of(path).await?;
    let (runs, others, signed_in, name, url) = match &site {
        Site::GitHub {
            full_name, token, ..
        } => {
            let client = crate::github::client()?;
            let token = token.as_deref();
            let (runs, suites) =
                crate::github::runs::commit_runs(&client, full_name, token, &id).await;
            // The commit's other checks: other apps', and commit statuses.
            let others = crate::github::pulls::commit_checks(&client, full_name, token, &id)
                .await
                .into_iter()
                .filter(|check| check.suite.is_none_or(|suite| !suites.contains(&suite)))
                .collect();
            let url = format!(
                "https://{}/{full_name}/commit/{id}/checks",
                crate::github::HOST
            );
            (runs, others, token.is_some(), "GitHub", Some(url))
        }
        Site::GitLab { project, token } => {
            let (url, jobs) = crate::gitlab::ci::pipeline_jobs(project, token.as_deref(), &id)
                .await
                .unwrap_or_default();
            let runs = if jobs.is_empty() {
                Vec::new()
            } else {
                vec![pipeline(url.clone(), jobs)]
            };
            (runs, Vec::new(), token.is_some(), "GitLab", url)
        }
    };
    let states: Vec<Check> = runs
        .iter()
        .flat_map(|run| run.groups.iter().flat_map(|group| &group.jobs))
        .map(|job| Check {
            name: job.name.clone(),
            state: job.state,
            ..Check::default()
        })
        .chain(others.iter().cloned())
        .collect();
    // What's seen here is the latest: the dot follows it.
    if let Some(state) = summary(&states) {
        let mut known = KNOWN.lock().unwrap_or_else(|e| e.into_inner());
        known.get_or_insert_with(HashMap::new).insert(
            (path.to_string_lossy().into_owned(), id.clone()),
            (Instant::now(), Some(state)),
        );
    }
    let can_rerun = signed_in
        && states.iter().any(|check| {
            matches!(
                check.state,
                Some(CheckState::Failure | CheckState::Cancelled)
            )
        });
    Ok(CommitRuns {
        runs,
        others,
        can_rerun,
        signed_in,
        site: name.to_owned(),
        url,
    })
}

/// A GitLab pipeline as a run: a group for each stage, in order, each waiting for the one
/// before (as stages do).
pub(crate) fn pipeline(url: Option<String>, jobs: Vec<Check>) -> Run {
    let mut groups: Vec<JobGroup> = Vec::new();
    for check in jobs {
        let stage = check.workflow.clone().unwrap_or_else(|| "jobs".into());
        if groups.last().is_none_or(|group| group.key != stage) {
            let needs = groups
                .last()
                .map(|group| vec![group.key.clone()])
                .unwrap_or_default();
            groups.push(JobGroup {
                key: stage.clone(),
                name: stage,
                needs,
                matrix: true,
                jobs: Vec::new(),
            });
        }
        if let Some(group) = groups.last_mut() {
            group.jobs.push(Job {
                name: check.name,
                state: check.state,
                url: check.url,
                started_at: check.started_at,
                finished_at: check.finished_at,
                steps_done: 0,
                steps: 0,
                step: None,
            });
        }
    }
    let states: Vec<Check> = groups
        .iter()
        .flat_map(|group| &group.jobs)
        .map(|job| Check {
            state: job.state,
            ..Check::default()
        })
        .collect();
    let starts = groups
        .iter()
        .flat_map(|group| &group.jobs)
        .filter_map(|job| job.started_at.clone());
    let state = summary(&states);
    let finished = state != Some(CheckState::Pending);
    Run {
        name: "Pipeline".into(),
        trigger: None,
        url,
        state,
        started_at: starts.clone().min(),
        finished_at: groups
            .iter()
            .flat_map(|group| &group.jobs)
            .filter_map(|job| job.finished_at.clone())
            .max()
            .filter(|_| finished),
        groups,
    }
}

/// Run commit `id`'s failed checks again.
pub async fn rerun_failed(path: &Path, id: String) -> Result<String> {
    if id.len() != 40 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("That isn't a commit.".into());
    }
    let count = match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => {
            let token = token.ok_or("Sign in to GitHub first (Settings, Accounts).")?;
            crate::github::ci::rerun_failed(&full_name, &token, &id).await?
        }
        Site::GitLab { project, token } => {
            let token = token.ok_or(
                "Git has no token for this GitLab server yet: push or fetch once to sign in.",
            )?;
            crate::gitlab::ci::retry_pipeline(&project, &token, &id).await?
        }
    };
    // Running again: ask afresh next time.
    if let Some(known) = KNOWN.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        known.remove(&(path.to_string_lossy().into_owned(), id));
    }
    Ok(match count {
        0 => "Nothing had failed to run again".to_owned(),
        1 => "Running the failed jobs again".to_owned(),
        n => format!("Running the failed jobs of {n} workflows again"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_again_soon_about_failed_checks() {
        // Failed ones get run again, so they're asked about again almost as soon as running ones.
        let hold = |state| holds_for(Some(state));
        assert!(hold(CheckState::Failure) <= Duration::from_secs(60));
        assert!(hold(CheckState::Pending) < hold(CheckState::Failure));
        assert!(hold(CheckState::Failure) < hold(CheckState::Success));
    }

    fn check(state: Option<CheckState>) -> Check {
        Check {
            name: "build".into(),
            state,
            ..Check::default()
        }
    }

    #[test]
    fn sums_up_checks() {
        assert_eq!(summary(&[]), None);
        assert_eq!(
            summary(&[check(Some(CheckState::Success)), check(None)]),
            Some(CheckState::Success)
        );
        assert_eq!(
            summary(&[
                check(Some(CheckState::Pending)),
                check(Some(CheckState::Success))
            ]),
            Some(CheckState::Pending)
        );
        assert_eq!(
            summary(&[
                check(Some(CheckState::Pending)),
                check(Some(CheckState::Failure))
            ]),
            Some(CheckState::Failure)
        );
    }

    #[test]
    fn makes_a_gitlab_pipelines_stages_its_groups_each_after_the_last() {
        let job = |name: &str, stage: &str, state: CheckState| Check {
            name: name.into(),
            state: Some(state),
            workflow: Some(stage.into()),
            started_at: Some(format!("2026-11-14T10:0{}:00Z", name.len() % 10)),
            ..Check::default()
        };
        let run = pipeline(
            Some("https://gitlab.example/p/-/pipelines/7".into()),
            vec![
                job("lint", "test", CheckState::Success),
                job("unit", "test", CheckState::Success),
                job("package", "build", CheckState::Pending),
                job("deploy", "release", CheckState::Pending),
            ],
        );
        let groups: Vec<(&str, Vec<String>, usize)> = run
            .groups
            .iter()
            .map(|group| (group.key.as_str(), group.needs.clone(), group.jobs.len()))
            .collect();
        assert_eq!(
            groups,
            [
                ("test", vec![], 2),
                ("build", vec!["test".to_owned()], 1),
                ("release", vec!["build".to_owned()], 1)
            ]
        );
        assert_eq!(run.state, Some(CheckState::Pending));
        assert_eq!(run.finished_at, None);
        assert!(run.groups.iter().all(|group| group.matrix));
    }
}
