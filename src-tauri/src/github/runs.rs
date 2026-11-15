//! A commit's GitHub Actions runs in full, for a graph of each: their jobs (with their steps),
//! grouped by the job of the workflow file each ran for (a matrix job's together), with the
//! jobs each waits for (`needs`), read from the workflow file as it was at the commit.
//!
//! Jobs that wait for others aren't listed by GitHub until they start: the workflow file is
//! what says they're there.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use serde::Deserialize;
use yaml_rust2::{Yaml, YamlLoader};

use super::pulls::{job_state, trigger};
use super::{CheckState, api_request};
use crate::ci::{Job, JobGroup, Run};
use crate::conditional;

/// At most this many runs of a commit are shown.
const MOST_RUNS: usize = 20;

#[derive(Deserialize)]
struct RawRuns {
    #[serde(default)]
    workflow_runs: Vec<RawRun>,
}

#[derive(Deserialize)]
struct RawRun {
    id: u64,
    name: Option<String>,
    /// Its workflow file, like ".github/workflows/build.yml" (GitHub's own, like CodeQL's
    /// default setup, have a "dynamic/…" path, with no file to read).
    path: Option<String>,
    event: String,
    head_branch: Option<String>,
    status: Option<String>,
    conclusion: Option<String>,
    html_url: Option<String>,
    run_started_at: Option<String>,
    updated_at: Option<String>,
    workflow_id: u64,
    check_suite_id: u64,
}

#[derive(Deserialize)]
struct RawJobs {
    #[serde(default)]
    jobs: Vec<RawJob>,
}

#[derive(Deserialize)]
struct RawJob {
    name: String,
    status: String,
    conclusion: Option<String>,
    html_url: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
    #[serde(default)]
    steps: Vec<RawStep>,
}

#[derive(Deserialize)]
struct RawStep {
    name: String,
    status: String,
}

/// A job of a workflow file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileJob {
    /// Its id, the key under `jobs:`.
    pub id: String,
    /// Its `name:` as written, with any `${{ }}` expressions in it.
    pub name: Option<String>,
    /// The ids of the jobs it waits for.
    pub needs: Vec<String>,
    /// It runs once for each combination of a matrix.
    pub matrix: bool,
    /// It calls another workflow (`uses:`), whose jobs GitHub names "This / that".
    pub calls: bool,
}

/// The jobs of a workflow file, in its order (none when it can't be read).
pub(crate) fn file_jobs(text: &str) -> Vec<FileJob> {
    let Ok(documents) = YamlLoader::load_from_str(text) else {
        return Vec::new();
    };
    let Some(jobs) = documents
        .first()
        .and_then(|document| document["jobs"].as_hash())
    else {
        return Vec::new();
    };
    jobs.iter()
        .filter_map(|(key, job)| {
            let needs = match &job["needs"] {
                Yaml::String(one) => vec![one.clone()],
                Yaml::Array(many) => many
                    .iter()
                    .filter_map(|need| need.as_str().map(str::to_owned))
                    .collect(),
                _ => Vec::new(),
            };
            Some(FileJob {
                id: key.as_str()?.to_owned(),
                name: job["name"].as_str().map(str::to_owned),
                needs,
                matrix: !job["strategy"]["matrix"].is_badvalue(),
                calls: job["uses"].as_str().is_some(),
            })
        })
        .collect()
}

/// The text of `name` between its `${{ }}` expressions: "Analyze (${{ matrix.language }})"
/// is "Analyze (" and ")".
fn literal_parts(name: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut rest = name;
    while let Some(start) = rest.find("${{") {
        parts.push(&rest[..start]);
        rest = match rest[start..].find("}}") {
            Some(end) => &rest[start + end + 2..],
            None => "",
        };
    }
    parts.push(rest);
    parts
}

/// Whether `text` is `parts` with something put between each: the first part at its start,
/// the last at its end, and the others in order between.
fn fits(parts: &[&str], text: &str) -> bool {
    let (Some(first), Some(last)) = (parts.first(), parts.last()) else {
        return false;
    };
    let Some(mut rest) = text.strip_prefix(first) else {
        return false;
    };
    if parts.len() == 1 {
        return rest.is_empty();
    }
    for part in &parts[1..parts.len() - 1] {
        match rest.get(1..).and_then(|after| after.find(part)) {
            Some(at) => rest = &rest[1 + at + part.len()..],
            None => return false,
        }
    }
    rest.len() > last.len() && rest.ends_with(last)
}

/// How closely GitHub's name for a job, `job`, matches a job of the workflow file (None: not
/// at all). A name written out matches best, then one with more of its text written out:
/// a name that's all expression ("${{ matrix.name }}") matches any job, so it's the last
/// one asked.
fn matches(file: &FileJob, job: &str) -> Option<usize> {
    let written = file.name.as_deref().unwrap_or(&file.id);
    if written.contains("${{") {
        let parts = literal_parts(written);
        return fits(&parts, job).then(|| parts.iter().map(|part| part.len()).sum());
    }
    let matrix = || {
        file.matrix
            && job
                .strip_prefix(written)
                .is_some_and(|rest| rest.starts_with(" (") && rest.ends_with(')'))
    };
    let called = || file.calls && job.starts_with(&format!("{written} / "));
    if job == written {
        Some(usize::MAX)
    } else if matrix() || called() {
        Some(written.len())
    } else {
        None
    }
}

/// What to call a job of the workflow file: its name without its expressions (and the
/// brackets left empty), or its id.
fn shown_name(file: &FileJob) -> String {
    let Some(name) = &file.name else {
        return file.id.clone();
    };
    let plain = literal_parts(name)
        .concat()
        .replace("()", "")
        .replace("[]", "");
    let plain = plain.trim().trim_end_matches([' ', '-', ':', '/']).trim();
    if plain.is_empty() {
        file.id.clone()
    } else {
        plain.to_owned()
    }
}

/// The run's jobs in groups, one for each job of its workflow file (in the file's order, a
/// matrix job's jobs together, none while it waits), with the groups each waits for.
/// Jobs the file doesn't name (no file, or a dynamic workflow) group by the name before
/// their brackets ("Analyze (rust)" with "Analyze (python)").
pub(crate) fn groups(file: &[FileJob], jobs: Vec<Job>) -> Vec<JobGroup> {
    let mut groups: Vec<JobGroup> = file
        .iter()
        .map(|job| JobGroup {
            key: job.id.clone(),
            name: shown_name(job),
            needs: job.needs.clone(),
            matrix: job.matrix,
            jobs: Vec::new(),
        })
        .collect();
    for job in jobs {
        let best = file
            .iter()
            .enumerate()
            .filter_map(|(index, file_job)| matches(file_job, &job.name).map(|how| (how, index)))
            // The closest match, and of those the first in the file.
            .max_by(|(a, i), (b, j)| a.cmp(b).then(j.cmp(i)));
        if let Some((_, index)) = best {
            groups[index].jobs.push(job);
            continue;
        }
        let family = job
            .name
            .split_once(" (")
            .filter(|(_, rest)| rest.ends_with(')'))
            .map(|(name, _)| name.to_owned());
        let key = format!("job:{}", family.as_deref().unwrap_or(&job.name));
        match groups.iter_mut().find(|group| group.key == key) {
            Some(group) => {
                group.matrix = true;
                group.jobs.push(job);
            }
            None => groups.push(JobGroup {
                key,
                name: family.unwrap_or_else(|| job.name.clone()),
                needs: Vec::new(),
                matrix: false,
                jobs: vec![job],
            }),
        }
    }
    let keys: HashSet<String> = groups.iter().map(|group| group.key.clone()).collect();
    for group in &mut groups {
        // Several jobs show together, a matrix or not.
        group.matrix |= group.jobs.len() > 1;
        // Needs that name no job of the file (a typo) aren't drawn.
        group.needs.retain(|need| keys.contains(need));
    }
    groups
}

fn job(raw: RawJob) -> Job {
    let (state, queued) = job_state(&raw.status, raw.conclusion.as_deref());
    let count = |steps: usize| u32::try_from(steps).unwrap_or(u32::MAX);
    Job {
        steps: count(raw.steps.len()),
        steps_done: count(
            raw.steps
                .iter()
                .filter(|step| step.status == "completed")
                .count(),
        ),
        step: raw
            .steps
            .iter()
            .find(|step| step.status == "in_progress")
            .map(|step| step.name.clone()),
        name: raw.name,
        state,
        url: raw.html_url,
        started_at: raw.started_at.filter(|_| !queued),
        finished_at: raw.completed_at,
    }
}

/// When a workflow ran more than once for the commit for the same reason (a pull request's
/// description edited, say), only its latest run is kept, as GitHub goes by that one.
fn latest_runs(mut runs: Vec<RawRun>) -> Vec<RawRun> {
    runs.sort_by_key(|run| std::cmp::Reverse(run.id));
    let mut seen = HashSet::new();
    runs.retain(|run| seen.insert((run.workflow_id, run.event.clone())));
    runs
}

/// A workflow file at a commit: its repository, the commit, and its path.
type FileAt = (String, String, String);

/// Each workflow file's jobs: the file at a commit doesn't change, so it's read once.
static FILES: LazyLock<Mutex<HashMap<FileAt, Vec<FileJob>>>> = LazyLock::new(Default::default);

/// The jobs of the workflow file at `path` as it was at commit `sha` (none when it can't be
/// read, like a dynamic workflow's).
async fn workflow_jobs(
    client: &reqwest::Client,
    full_name: &str,
    token: Option<&str>,
    sha: &str,
    path: &str,
) -> Vec<FileJob> {
    let key = (full_name.to_owned(), sha.to_owned(), path.to_owned());
    if let Some(jobs) = FILES.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return jobs.clone();
    }
    let jobs = if path.starts_with(".github/") {
        let url = format!("https://api.github.com/repos/{full_name}/contents/{path}?ref={sha}");
        let mut request = client
            .get(url)
            .header("Accept", "application/vnd.github.raw")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        match request.send().await {
            Ok(answer) if answer.status().is_success() => {
                file_jobs(&answer.text().await.unwrap_or_default())
            }
            // Asked again next time: it may have been the network.
            _ => return Vec::new(),
        }
    } else {
        Vec::new()
    };
    let mut files = FILES.lock().unwrap_or_else(|e| e.into_inner());
    if files.len() > 200 {
        files.clear();
    }
    files.insert(key, jobs.clone());
    jobs
}

/// A run's name and what started it. GitHub's own workflows (like CodeQL's default setup)
/// are "dynamic": their run is named for what started it ("Push on develop"), so they're
/// named for their path ("dynamic/github-code-scanning/codeql" is CodeQL).
fn name_and_trigger(
    name: Option<&str>,
    path: Option<&str>,
    event: &str,
    branch: Option<&str>,
) -> (String, Option<String>) {
    let Some(kind) = path.and_then(|path| path.strip_prefix("dynamic/")) else {
        return (
            name.unwrap_or("Workflow").to_owned(),
            Some(trigger(event, branch)),
        );
    };
    let last = kind.rsplit('/').next().unwrap_or(kind);
    let named = match last {
        "codeql" => "CodeQL".to_owned(),
        "dependabot-updates" => "Dependabot".to_owned(),
        other => {
            let words = other.replace('-', " ");
            let mut letters = words.chars();
            letters
                .next()
                .map(|first| first.to_uppercase().chain(letters).collect())
                .unwrap_or_default()
        }
    };
    let started = name
        .and_then(|name| name.strip_prefix("Push on "))
        .map(|branch| format!("on push to {branch}"));
    (named, started)
}

/// Running ones first, then failed ones, then the rest, each by name.
fn order(state: Option<CheckState>) -> u8 {
    match state {
        Some(CheckState::Pending) => 0,
        Some(CheckState::Failure) => 1,
        _ => 2,
    }
}

/// Commit `sha`'s workflow runs with their jobs, and the check suites they are (so the
/// commit's other checks can be told from their jobs). Each run's list of jobs is asked for
/// with its ETag, so asking again while nothing changed costs nothing (signed in).
pub(crate) async fn commit_runs(
    client: &reqwest::Client,
    full_name: &str,
    token: Option<&str>,
    sha: &str,
) -> (Vec<Run>, HashSet<u64>) {
    let url = format!(
        "https://api.github.com/repos/{full_name}/actions/runs?head_sha={sha}&per_page=100"
    );
    let raw = match conditional::send(
        &conditional::key(&url, token),
        api_request(client, url, token),
    )
    .await
    {
        Ok(answer) if answer.status.is_success() => serde_json::from_str::<RawRuns>(&answer.body)
            .map(|runs| runs.workflow_runs)
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    let mut runs = Vec::new();
    let mut suites = HashSet::new();
    for run in latest_runs(raw).into_iter().take(MOST_RUNS) {
        suites.insert(run.check_suite_id);
        let url = format!(
            "https://api.github.com/repos/{full_name}/actions/runs/{}/jobs?per_page=100",
            run.id
        );
        let jobs: Vec<Job> = match conditional::send(
            &conditional::key(&url, token),
            api_request(client, url, token),
        )
        .await
        {
            Ok(answer) if answer.status.is_success() => {
                serde_json::from_str::<RawJobs>(&answer.body)
                    .map(|jobs| jobs.jobs.into_iter().map(job).collect())
                    .unwrap_or_default()
            }
            _ => Vec::new(),
        };
        let file = match &run.path {
            Some(path) => workflow_jobs(client, full_name, token, sha, path).await,
            None => Vec::new(),
        };
        let (state, _) = job_state(
            run.status.as_deref().unwrap_or("completed"),
            run.conclusion.as_deref(),
        );
        let finished = state != Some(CheckState::Pending);
        let (name, trigger) = name_and_trigger(
            run.name.as_deref(),
            run.path.as_deref(),
            &run.event,
            run.head_branch.as_deref(),
        );
        runs.push(Run {
            name,
            trigger,
            url: run.html_url,
            state,
            started_at: run.run_started_at,
            finished_at: run.updated_at.filter(|_| finished),
            groups: groups(&file, jobs),
        });
    }
    runs.sort_by(|a, b| {
        order(a.state)
            .cmp(&order(b.state))
            .then(a.name.cmp(&b.name))
    });
    (runs, suites)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUILD: &str = r#"
name: Build
on:
  push:
    branches: [develop, main]
jobs:
  version:
    name: Version
    runs-on: ubuntu-24.04
    steps:
      - run: 'echo "needs: nothing, this is a step"'
  build:
    name: ${{ matrix.name }}
    needs: version
    strategy:
      matrix:
        include:
          - name: Linux
          - name: macOS
  flatpak:
    name: Flatpak
    needs: [version, build]
  check:
    name: Flatpak starts
    needs:
      - flatpak
  analyze:
    name: Analyze (${{ matrix.language }})
    strategy:
      matrix:
        language: [rust, python]
  test:
    strategy:
      matrix:
        os: [linux, windows]
  deploy:
    uses: ./.github/workflows/deploy.yml
    needs: [build, nowhere]
"#;

    fn job(name: &str) -> Job {
        Job {
            name: name.into(),
            state: Some(CheckState::Success),
            url: None,
            started_at: None,
            finished_at: None,
            steps_done: 0,
            steps: 0,
            step: None,
        }
    }

    #[test]
    fn reads_a_workflow_files_jobs_and_what_each_waits_for() {
        let jobs = file_jobs(BUILD);
        let ids: Vec<&str> = jobs.iter().map(|job| job.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "version", "build", "flatpak", "check", "analyze", "test", "deploy"
            ]
        );
        assert_eq!(jobs[0].needs, Vec::<String>::new());
        assert_eq!(jobs[1].needs, ["version"]);
        assert_eq!(jobs[2].needs, ["version", "build"]);
        assert_eq!(jobs[3].needs, ["flatpak"]);
        assert!(jobs[1].matrix && !jobs[2].matrix && jobs[5].matrix);
        assert!(jobs[6].calls);
        assert_eq!(jobs[1].name.as_deref(), Some("${{ matrix.name }}"));
        assert!(file_jobs("not: [valid").is_empty());
        assert!(file_jobs("on: push").is_empty());
    }

    #[test]
    fn groups_jobs_by_the_workflow_job_they_ran_for() {
        let file = file_jobs(BUILD);
        let jobs = [
            "Version",
            "Linux",
            "macOS",
            "Analyze (rust)",
            "Analyze (python)",
            "test (linux)",
            "deploy / upload",
            "Docs",
        ]
        .map(job)
        .to_vec();
        let groups = groups(&file, jobs);
        let names = |key: &str| -> Vec<String> {
            groups
                .iter()
                .find(|group| group.key == key)
                .map(|group| group.jobs.iter().map(|job| job.name.clone()).collect())
                .unwrap_or_default()
        };
        assert_eq!(names("version"), ["Version"]);
        // A name that's all expression takes what nothing else does ("Docs" too: a matrix
        // value could be anything).
        assert_eq!(names("build"), ["Linux", "macOS", "Docs"]);
        assert_eq!(names("analyze"), ["Analyze (rust)", "Analyze (python)"]);
        assert_eq!(names("test"), ["test (linux)"]);
        assert_eq!(names("deploy"), ["deploy / upload"]);
        // Waiting: no jobs yet, but there, with what it waits for.
        let flatpak = groups.iter().find(|group| group.key == "flatpak").unwrap();
        assert!(flatpak.jobs.is_empty());
        assert_eq!(flatpak.needs, ["version", "build"]);
        // Needs of jobs that aren't in the file are left out.
        assert_eq!(
            groups
                .iter()
                .find(|group| group.key == "deploy")
                .unwrap()
                .needs,
            ["build"]
        );
        // Names: without expressions, or the id.
        let name = |key: &str| {
            groups
                .iter()
                .find(|group| group.key == key)
                .unwrap()
                .name
                .clone()
        };
        assert_eq!(name("build"), "build");
        assert_eq!(name("analyze"), "Analyze");
        assert_eq!(name("check"), "Flatpak starts");
        assert_eq!(name("test"), "test");
    }

    #[test]
    fn groups_jobs_without_a_workflow_file_by_their_name() {
        // CodeQL's default setup, and "Lint (strict)" with no job of its own in the file.
        let jobs = [
            "Analyze (actions)",
            "Analyze (rust)",
            "Lint (strict)",
            "Docs",
        ]
        .map(job)
        .to_vec();
        let groups = groups(&[], jobs);
        let shown: Vec<(String, usize, bool)> = groups
            .iter()
            .map(|group| (group.name.clone(), group.jobs.len(), group.matrix))
            .collect();
        assert_eq!(
            shown,
            [
                ("Analyze".into(), 2, true),
                ("Lint".into(), 1, false),
                ("Docs".into(), 1, false)
            ]
        );
    }

    #[test]
    fn fills_in_expressions_only_where_something_is() {
        let parts = literal_parts("Build (${{ matrix.os }}, ${{ matrix.arch }})");
        assert_eq!(parts, ["Build (", ", ", ")"]);
        assert!(fits(&parts, "Build (linux, arm64)"));
        assert!(!fits(&parts, "Build (linux)"));
        assert!(!fits(&parts, "Build (, )"));
        assert!(!fits(&parts, "Test (linux, arm64)"));
        assert!(fits(&literal_parts("${{ matrix.name }}"), "Anything"));
        assert!(!fits(&literal_parts("${{ matrix.name }}"), ""));
    }

    #[test]
    fn names_githubs_own_workflows_for_their_path() {
        let named =
            |name, path, event| name_and_trigger(Some(name), Some(path), event, Some("develop"));
        assert_eq!(
            named("Build", ".github/workflows/build.yml", "push"),
            ("Build".into(), Some("on push to develop".into()))
        );
        assert_eq!(
            named(
                "Push on develop",
                "dynamic/github-code-scanning/codeql",
                "dynamic"
            ),
            ("CodeQL".into(), Some("on push to develop".into()))
        );
        assert_eq!(
            named(
                "Something else",
                "dynamic/pages/pages-build-deployment",
                "dynamic"
            ),
            ("Pages build deployment".into(), None)
        );
    }

    #[test]
    fn keeps_each_workflows_latest_run() {
        let run = |id: u64, workflow_id: u64, event: &str| RawRun {
            id,
            name: None,
            path: None,
            event: event.into(),
            head_branch: None,
            status: None,
            conclusion: None,
            html_url: None,
            run_started_at: None,
            updated_at: None,
            workflow_id,
            check_suite_id: id,
        };
        let kept: Vec<u64> = latest_runs(vec![
            run(1, 7, "push"),
            run(3, 7, "push"),
            run(2, 7, "pull_request"),
            run(4, 8, "push"),
        ])
        .iter()
        .map(|run| run.id)
        .collect();
        assert_eq!(kept, [4, 3, 2]);
    }
}
