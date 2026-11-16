//! Why a check failed, without leaving the app: its job's steps, and the end of the log of
//! the step that failed, from GitHub Actions or GitLab. And running that one job again.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::Result;
use crate::github::CheckState;
use crate::requests::{Site, site_of};

/// At most this many lines of a log are sent: the end of it, where it failed.
const MOST_LINES: usize = 200;

/// A failed check's job: its steps, and the end of the log of the one that failed.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CheckLog {
    /// The job's steps, in order (a GitLab job's sections).
    pub steps: Vec<LogStep>,
    /// The step the lines are from: the one that failed.
    pub step: Option<String>,
    /// The end of that step's log (the job's, when the step's can't be told apart).
    pub lines: Vec<LogLine>,
    /// Lines before these were left out.
    pub cut: bool,
    /// Why there's no log, when there isn't one: to sign in, or that it's on another site.
    pub missing: Option<String>,
    /// The job can be run again from here (signed in).
    pub can_rerun: bool,
}

/// A step of a job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LogStep {
    pub name: String,
    /// None when it was skipped.
    pub state: Option<CheckState>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// A line of a log, without its colours, and what kind of line it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub text: String,
    pub kind: LogLineKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum LogLineKind {
    Plain,
    /// A command the step ran ("Run python check.py").
    Command,
    Error,
    Warning,
}

/// Check `url`'s job: its steps, and the end of the log of the step that failed.
pub async fn check_log(path: &Path, url: String) -> Result<CheckLog> {
    match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => {
            let Some(job) = github_job(&url, &full_name) else {
                return Ok(elsewhere("GitHub Actions"));
            };
            let (steps, log) =
                crate::github::ci::job_log(&full_name, token.as_deref(), job).await?;
            let failed = steps
                .iter()
                .find(|step| step.state == Some(CheckState::Failure));
            let window = failed.and_then(|step| {
                Some((
                    seconds(step.started_at.as_deref()?)?,
                    seconds(step.finished_at.as_deref()?)?,
                ))
            });
            let step = failed.map(|step| step.name.clone());
            let (lines, cut) = log
                .as_deref()
                .map(|log| github_lines(log, window))
                .unwrap_or_default();
            let missing = match (&log, token.is_some()) {
                (None, false) => {
                    Some("Sign in to GitHub to see its log: Settings, Accounts.".to_owned())
                }
                (None, true) => {
                    Some("GitHub didn't give its log: it may be too old to keep.".to_owned())
                }
                (Some(_), _) if lines.is_empty() => Some("Its log is empty.".to_owned()),
                _ => None,
            };
            Ok(CheckLog {
                steps,
                step,
                lines,
                cut,
                missing,
                can_rerun: token.is_some(),
            })
        }
        Site::GitLab { project, token } => {
            let Some(job) = gitlab_job(&url, &project.host) else {
                return Ok(elsewhere("GitLab CI"));
            };
            let trace = crate::gitlab::ci::job_trace(&project, token.as_deref(), job).await?;
            let Some(trace) = trace else {
                return Ok(CheckLog {
                    missing: Some(if token.is_some() {
                        "GitLab didn't give its log.".to_owned()
                    } else {
                        "Push or fetch once to sign in to GitLab, to see its log.".to_owned()
                    }),
                    ..CheckLog::default()
                });
            };
            let (steps, step, lines, cut) = gitlab_log(&trace);
            Ok(CheckLog {
                missing: lines.is_empty().then(|| "Its log is empty.".to_owned()),
                steps,
                step,
                lines,
                cut,
                can_rerun: token.is_some(),
            })
        }
    }
}

/// Run check `url`'s job again.
pub async fn rerun_job(path: &Path, url: String) -> Result<String> {
    match site_of(path).await? {
        Site::GitHub {
            full_name, token, ..
        } => {
            let job = github_job(&url, &full_name).ok_or("That isn't a GitHub Actions job.")?;
            let token = token.ok_or("Sign in to GitHub first (Settings, Accounts).")?;
            crate::github::ci::rerun_job(&full_name, &token, job).await?;
        }
        Site::GitLab { project, token } => {
            let job = gitlab_job(&url, &project.host).ok_or("That isn't a GitLab job.")?;
            let token = token.ok_or(
                "Git has no token for this GitLab server yet: push or fetch once to sign in.",
            )?;
            crate::gitlab::ci::retry_job(&project, &token, job).await?;
        }
    }
    crate::ci::forget_states(path);
    Ok("Running the job again".to_owned())
}

/// A check run by another app: its log is on its own page.
fn elsewhere(what: &str) -> CheckLog {
    CheckLog {
        missing: Some(format!(
            "This check wasn't run by {what}, so its log is on its own page."
        )),
        ..CheckLog::default()
    }
}

/// The id of a GitHub Actions job, from its page's address, if it's one of `full_name`'s
/// (`https://github.com/<full_name>/actions/runs/<run>/job/<job>`).
pub(crate) fn github_job(url: &str, full_name: &str) -> Option<u64> {
    let rest = url.strip_prefix("https://github.com/")?;
    let (repo, rest) = rest.split_at_checked(full_name.len())?;
    if !repo.eq_ignore_ascii_case(full_name) {
        return None;
    }
    let (_, job) = rest.strip_prefix("/actions/runs/")?.split_once("/job/")?;
    number_at_start(job)
}

/// The id of a GitLab job, from its page's address on `host`
/// (`https://<host>/<project>/-/jobs/<job>`).
pub(crate) fn gitlab_job(url: &str, host: &str) -> Option<u64> {
    let rest = url.strip_prefix("https://")?.strip_prefix(host)?;
    let (_, job) = rest.strip_prefix('/')?.split_once("/-/jobs/")?;
    number_at_start(job)
}

fn number_at_start(text: &str) -> Option<u64> {
    let digits: String = text.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// An RFC 3339 time (`2026-11-15T17:00:07.123Z`, or with an offset) in seconds since 1970.
pub(crate) fn seconds(time: &str) -> Option<i64> {
    let number = |range: std::ops::Range<usize>| time.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    if time.get(4..5)? != "-" || !matches!(time.get(10..11)?, "T" | "t" | " ") {
        return None;
    }
    // After the seconds: a fraction, then Z or an offset.
    let zone = time[19..].trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    let offset = match zone {
        "Z" | "z" | "" => 0,
        _ => {
            let sign = match zone.get(0..1)? {
                "+" => 1,
                "-" => -1,
                _ => return None,
            };
            let hours: i64 = zone.get(1..3)?.parse().ok()?;
            let minutes: i64 = zone.get(4..6)?.parse().ok()?;
            sign * (hours * 3600 + minutes * 60)
        }
    };
    // Days since 1970 of the date (Howard Hinnant's days_from_civil).
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let of_cycle = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    let days = era * 146_097 + of_cycle - 719_468;
    Some(days * 86_400 + hour * 3600 + minute * 60 + second - offset)
}

/// What a terminal shows of a line that redraws itself with carriage returns: its last part.
fn last_drawn(line: &str) -> &str {
    line.trim_end_matches('\r')
        .rsplit('\r')
        .find(|part| !part.is_empty())
        .unwrap_or("")
}

/// `text` without its terminal escapes (colours, clearing the line).
fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            } else {
                chars.next();
            }
        } else if c != '\r' {
            out.push(c);
        }
    }
    out
}

/// Whether `text` starts with `word` as a word of its own (not "errors").
fn starts_with_word(text: &str, word: &str) -> bool {
    text.get(..word.len())
        .is_some_and(|start| start.eq_ignore_ascii_case(word))
        && !text[word.len()..]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Errors and warnings, as compilers and test runners write them.
fn kind_of(text: &str) -> LogLineKind {
    let start = text.trim_start();
    if starts_with_word(start, "error")
        || starts_with_word(start, "fatal")
        || text.contains(": error:")
        || text.contains(": error ")
        || text.contains(": error[")
    {
        LogLineKind::Error
    } else if starts_with_word(start, "warning")
        || text.contains(": warning:")
        || text.contains(": warning ")
    {
        LogLineKind::Warning
    } else {
        LogLineKind::Plain
    }
}

/// The last [`MOST_LINES`] of `lines`, and whether any were left out.
fn tail(mut lines: Vec<LogLine>) -> (Vec<LogLine>, bool) {
    // Blank lines at the end say nothing.
    while lines.last().is_some_and(|line| line.text.trim().is_empty()) {
        lines.pop();
    }
    let cut = lines.len() > MOST_LINES;
    if cut {
        lines.drain(..lines.len() - MOST_LINES);
    }
    (lines, cut)
}

/// The lines of a GitHub Actions job's log written between `window`'s seconds (its failed
/// step's start and end), or all of them; the end of them.
///
/// Each line starts with when it was written; GitHub marks errors with `##[error]`, and
/// each command a step runs with `##[group]Run …` (its lines inside, up to `##[endgroup]`).
pub(crate) fn github_lines(log: &str, window: Option<(i64, i64)>) -> (Vec<LogLine>, bool) {
    let mut lines = Vec::new();
    let mut inside = window.is_none();
    for raw in log.lines() {
        let raw = raw.trim_start_matches('\u{feff}');
        let (stamp, text) = match raw.split_once(' ') {
            Some((stamp, text)) if stamp.len() >= 20 && stamp.ends_with('Z') => {
                (seconds(stamp), text)
            }
            _ => (None, raw),
        };
        if let (Some(at), Some((from, to))) = (stamp, window) {
            inside = at >= from && at <= to;
        }
        if inside && let Some(line) = github_line(text) {
            lines.push(line);
        }
    }
    // Nothing in the step's time (its times and the log's don't agree): the whole log.
    if lines.is_empty() && window.is_some() {
        return github_lines(log, None);
    }
    tail(lines)
}

fn github_line(text: &str) -> Option<LogLine> {
    let text = last_drawn(text);
    if let Some(rest) = text.strip_prefix("##[") {
        let (tag, rest) = rest.split_once(']')?;
        let rest = plain(rest);
        let kind = match tag {
            "group" => LogLineKind::Command,
            "error" => LogLineKind::Error,
            "warning" => LogLineKind::Warning,
            "endgroup" | "debug" => return None,
            _ => kind_of(&rest),
        };
        return Some(LogLine { text: rest, kind });
    }
    if let Some(rest) = text.strip_prefix("[command]") {
        return Some(LogLine {
            text: plain(rest),
            kind: LogLineKind::Command,
        });
    }
    let text = plain(text);
    Some(LogLine {
        kind: kind_of(&text),
        text,
    })
}

/// What to call a GitLab job section, by its name (GitLab Runner's own), or its heading.
fn section_name(name: &str, heading: &str) -> String {
    let known = match name {
        "prepare_executor" => "Prepare the executor",
        "prepare_script" => "Prepare the environment",
        "get_sources" => "Get the sources",
        "restore_cache" => "Restore the cache",
        "download_artifacts" => "Download artifacts",
        "step_script" => "Script",
        "after_script" => "After script",
        "archive_cache" | "archive_cache_on_failure" => "Save the cache",
        "upload_artifacts_on_success" | "upload_artifacts_on_failure" => "Upload artifacts",
        "cleanup_file_variables" => "Clean up",
        _ => "",
    };
    if !known.is_empty() {
        known.to_owned()
    } else if !heading.trim().is_empty() {
        heading.trim().to_owned()
    } else {
        let words = name.replace('_', " ");
        let mut chars = words.chars();
        chars
            .next()
            .map(|first| first.to_uppercase().chain(chars).collect())
            .unwrap_or_default()
    }
}

/// A failed GitLab job's sections as its steps (the one with the first error, or the last,
/// as the failed one), that step's name, and the end of its log.
///
/// GitLab Runner marks each section with `section_start:<time>:<name>` and
/// `section_end:<time>:<name>`, followed by a carriage return and its heading.
pub(crate) fn gitlab_log(trace: &str) -> (Vec<LogStep>, Option<String>, Vec<LogLine>, bool) {
    let mut steps: Vec<LogStep> = Vec::new();
    let mut lines = Vec::new();
    let mut failed: Option<usize> = None;
    for raw in trace.lines() {
        if let Some(at) = raw.find("section_start:") {
            let marker = &raw[at + "section_start:".len()..];
            let (_, rest) = marker.split_once(':').unwrap_or(("", marker));
            let name: String = rest
                .chars()
                .take_while(|c| !matches!(c, '[' | '\r' | '\u{1b}'))
                .collect();
            let heading = plain(last_drawn(rest));
            steps.push(LogStep {
                name: section_name(&name, &heading),
                state: Some(CheckState::Success),
                started_at: None,
                finished_at: None,
            });
            continue;
        }
        // A section's end, maybe with what was written after it on the same line.
        let text = plain(last_drawn(raw));
        if raw.contains("section_end:") && (text.is_empty() || text.contains("section_end:")) {
            continue;
        }
        let kind = kind_of(&text);
        if kind == LogLineKind::Error && failed.is_none() && !steps.is_empty() {
            failed = Some(steps.len() - 1);
        }
        lines.push(LogLine { text, kind });
    }
    let failed = failed.or(steps.len().checked_sub(1));
    if let Some(index) = failed {
        steps[index].state = Some(CheckState::Failure);
    }
    let step = failed.map(|index| steps[index].name.clone());
    let (lines, cut) = tail(lines);
    (steps, step, lines, cut)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, kind: LogLineKind) -> LogLine {
        LogLine {
            text: text.to_owned(),
            kind,
        }
    }

    #[test]
    fn finds_a_github_actions_job_in_its_address() {
        let url = "https://github.com/Example/Feast/actions/runs/41/job/7";
        assert_eq!(github_job(url, "example/feast"), Some(7));
        assert_eq!(
            github_job(
                "https://github.com/example/feast/actions/runs/41/job/123?pr=12",
                "example/feast"
            ),
            Some(123)
        );
        // Another repository's job, a check run by another app, and a run's page.
        assert_eq!(github_job(url, "example/other"), None);
        assert_eq!(
            github_job("https://ci.example.com/build/7", "example/feast"),
            None
        );
        assert_eq!(
            github_job(
                "https://github.com/example/feast/actions/runs/41",
                "example/feast"
            ),
            None
        );
    }

    #[test]
    fn finds_a_gitlab_job_in_its_address() {
        assert_eq!(
            gitlab_job("https://gitlab.com/group/app/-/jobs/123", "gitlab.com"),
            Some(123)
        );
        assert_eq!(
            gitlab_job(
                "https://gitlab.example.com/a/b/c/-/jobs/9",
                "gitlab.example.com"
            ),
            Some(9)
        );
        assert_eq!(
            gitlab_job(
                "https://gitlab.com/group/app/-/jobs/123",
                "gitlab.example.com"
            ),
            None
        );
        assert_eq!(
            gitlab_job("https://gitlab.com/group/app/-/pipelines/5", "gitlab.com"),
            None
        );
    }

    #[test]
    fn reads_times_with_and_without_offsets() {
        assert_eq!(seconds("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(seconds("2026-11-15T17:00:07Z"), Some(1_794_762_007));
        assert_eq!(seconds("2026-11-15T17:00:07.1234567Z"), Some(1_794_762_007));
        assert_eq!(
            seconds("2026-11-15T10:00:07.000-07:00"),
            Some(1_794_762_007)
        );
        assert_eq!(seconds("2024-02-29T00:00:00+01:00"), Some(1_709_161_200));
        assert_eq!(seconds("yesterday"), None);
    }

    #[test]
    fn keeps_a_redrawn_line_as_it_ends_and_drops_colours() {
        assert_eq!(
            plain(last_drawn("Downloading 10%\rDownloading 100%")),
            "Downloading 100%"
        );
        assert_eq!(
            plain("\u{1b}[31mred\u{1b}[0m and \u{1b}[1;32mgreen\u{1b}[m"),
            "red and green"
        );
        assert_eq!(last_drawn("done\r"), "done");
    }

    #[test]
    fn tells_errors_and_warnings_apart() {
        assert_eq!(
            kind_of("error[E0308]: mismatched types"),
            LogLineKind::Error
        );
        assert_eq!(kind_of("  Error: 2 files are too loud"), LogLineKind::Error);
        assert_eq!(
            kind_of("src/app.ts(3,5): error TS2322: Type 'string'"),
            LogLineKind::Error
        );
        assert_eq!(kind_of("fatal: not a git repository"), LogLineKind::Error);
        assert_eq!(kind_of("warning: unused variable"), LogLineKind::Warning);
        // Words that only start like them.
        assert_eq!(kind_of("errors: 0, warnings: 0"), LogLineKind::Plain);
        assert_eq!(kind_of("Checked 214 files"), LogLineKind::Plain);
    }

    const GITHUB: &str = "\u{feff}2026-11-15T17:00:01.0000000Z ##[group]Run actions/checkout@v4\n\
        2026-11-15T17:00:01.1000000Z with:\n\
        2026-11-15T17:00:02.0000000Z ##[endgroup]\n\
        2026-11-15T17:00:05.0000000Z Checked out\n\
        2026-11-15T17:00:10.0000000Z ##[group]Run python tools/check_loudness.py\n\
        2026-11-15T17:00:10.5000000Z \u{1b}[36;1mpython tools/check_loudness.py\u{1b}[0m\n\
        2026-11-15T17:00:11.0000000Z ##[endgroup]\n\
        2026-11-15T17:00:20.0000000Z   TOO LOUD  Tavern/door_slam.wav\n\
        2026-11-15T17:00:21.0000000Z ##[error]2 files are louder than -14 LUFS\n\
        2026-11-15T17:00:21.0100000Z ##[error]Process completed with exit code 1.\n\
        2026-11-15T17:00:22.0000000Z Post job cleanup.\n";

    #[test]
    fn reads_the_failed_steps_lines_of_a_github_log() {
        let from = seconds("2026-11-15T17:00:10Z").unwrap();
        let to = seconds("2026-11-15T17:00:21Z").unwrap();
        let (lines, cut) = github_lines(GITHUB, Some((from, to)));
        assert!(!cut);
        assert_eq!(
            lines,
            vec![
                line("Run python tools/check_loudness.py", LogLineKind::Command),
                line("python tools/check_loudness.py", LogLineKind::Plain),
                line("  TOO LOUD  Tavern/door_slam.wav", LogLineKind::Plain),
                line("2 files are louder than -14 LUFS", LogLineKind::Error),
                line("Process completed with exit code 1.", LogLineKind::Error),
            ]
        );
    }

    #[test]
    fn reads_all_of_a_github_log_without_the_steps_times() {
        let (lines, _) = github_lines(GITHUB, None);
        assert_eq!(
            lines.first(),
            Some(&line("Run actions/checkout@v4", LogLineKind::Command))
        );
        assert_eq!(
            lines.last(),
            Some(&line("Post job cleanup.", LogLineKind::Plain))
        );
        // Times that don't match the log's: all of it rather than nothing.
        let (lines, _) = github_lines(GITHUB, Some((0, 10)));
        assert_eq!(lines.len(), 9);
    }

    #[test]
    fn keeps_the_end_of_a_long_log() {
        let log: String = (0..250)
            .map(|n| format!("2026-11-15T17:00:00.0000000Z line {n}\n"))
            .collect();
        let (lines, cut) = github_lines(&log, None);
        assert!(cut);
        assert_eq!(lines.len(), MOST_LINES);
        assert_eq!(lines.last().unwrap().text, "line 249");
    }

    #[test]
    fn reads_a_gitlab_jobs_sections_as_its_steps() {
        let trace = "\u{1b}[0Ksection_start:1700000000:prepare_executor\r\u{1b}[0K\u{1b}[0;1mPreparing the \"docker\" executor\u{1b}[0;m\n\
            Using docker image node:22\n\
            \u{1b}[0Ksection_end:1700000005:prepare_executor\r\u{1b}[0K\u{1b}[0Ksection_start:1700000005:step_script\r\u{1b}[0K\u{1b}[0;1mExecuting \"step_script\" stage of the job script\u{1b}[0;m\n\
            $ npm test\n\
            \u{1b}[31merror: 2 tests failed\u{1b}[0m\n\
            \u{1b}[0Ksection_end:1700000020:step_script\r\u{1b}[0K\u{1b}[0Ksection_start:1700000020:my_upload[collapsed=true]\r\u{1b}[0K\u{1b}[0;1mUploading reports\u{1b}[0;m\n\
            \u{1b}[0Ksection_end:1700000021:my_upload\r\u{1b}[0K\u{1b}[31;1mERROR: Job failed: exit code 1\u{1b}[0;m\n";
        let (steps, step, lines, cut) = gitlab_log(trace);
        let names: Vec<&str> = steps.iter().map(|step| step.name.as_str()).collect();
        assert_eq!(
            names,
            ["Prepare the executor", "Script", "Uploading reports"]
        );
        assert_eq!(step.as_deref(), Some("Script"));
        assert_eq!(steps[1].state, Some(CheckState::Failure));
        assert_eq!(steps[2].state, Some(CheckState::Success));
        assert!(!cut);
        assert_eq!(
            lines,
            vec![
                line("Using docker image node:22", LogLineKind::Plain),
                line("$ npm test", LogLineKind::Plain),
                line("error: 2 tests failed", LogLineKind::Error),
                line("ERROR: Job failed: exit code 1", LogLineKind::Error),
            ]
        );
    }
}
