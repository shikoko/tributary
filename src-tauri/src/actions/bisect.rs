//! Bisecting: finding the commit that broke something by testing the ones in between.

use serde::Deserialize;
use ts_rs::TS;

use super::support::short;
use super::validate::commit_id;
use crate::error::Result;
use crate::git::Git;

/// What testing a commit showed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    Good,
    Bad,
    /// It can't be tested (it doesn't build, say).
    Skip,
}

/// Start looking for the first bad commit between `good` (which worked) and `bad` (which
/// doesn't): git checks out the one halfway.
pub(super) fn start(
    repo: &gix::Repository,
    git: &Git,
    bad: String,
    good: String,
) -> Result<String> {
    let bad = commit_id(repo, &bad)?.to_string();
    let good = commit_id(repo, &good)?.to_string();
    if bad == good {
        return Err("Choose a good commit before the bad one.".into());
    }
    if git
        .run(&["merge-base", "--is-ancestor", &good, &bad])
        .is_err()
    {
        return Err(format!(
            "{} isn't in {}'s history: the good commit has to come before the bad one.",
            &good[..7],
            &bad[..7]
        )
        .into());
    }
    let output = git.run(&["bisect", "start", &bad, &good])?;
    Ok(describe(&output))
}

/// Mark the commit being tested (or `id`) good, bad or skipped; git checks out the next one.
pub(super) fn mark(
    repo: &gix::Repository,
    git: &Git,
    verdict: Verdict,
    id: Option<String>,
) -> Result<String> {
    let word = match verdict {
        Verdict::Good => "good",
        Verdict::Bad => "bad",
        Verdict::Skip => "skip",
    };
    let id = id
        .map(|id| commit_id(repo, &id).map(|id| id.to_string()))
        .transpose()?;
    let mut args = vec!["bisect", word];
    if let Some(id) = &id {
        args.push(id);
    }
    let output = git.run(&args)?;
    Ok(describe(&output))
}

/// Stop bisecting, back where it started.
pub(super) fn reset(repo: &gix::Repository, git: &Git) -> Result<String> {
    let start = std::fs::read_to_string(repo.git_dir().join("BISECT_START"))
        .map(|start| start.trim().to_owned())
        .unwrap_or_default();
    git.run(&["bisect", "reset"])?;
    Ok(if start.is_empty() {
        "Stopped bisecting".to_owned()
    } else {
        format!("Stopped bisecting, back on {}", short(&start))
    })
}

/// What git said after a step, in a line.
fn describe(output: &str) -> String {
    if let Some(line) = output
        .lines()
        .find(|line| line.contains("is the first bad commit"))
    {
        let id = line.split_whitespace().next().unwrap_or_default();
        return format!(
            "Found it: {} is the first bad commit",
            &id[..id.len().min(7)]
        );
    }
    if output.contains("only 'skip'ped commits left") {
        return "Only skipped commits are left: the first bad commit is one of them".to_owned();
    }
    // "Bisecting: 5 revisions left to test after this (roughly 3 steps)"
    let steps = output
        .split("(roughly ")
        .nth(1)
        .and_then(|rest| rest.split_whitespace().next())
        .and_then(|n| n.parse::<u32>().ok());
    match steps {
        Some(0) | None => "Bisecting: test this commit, then mark it good or bad".to_owned(),
        Some(1) => "Bisecting: test this commit (about 1 more step after it)".to_owned(),
        Some(n) => format!("Bisecting: test this commit (about {n} more steps after it)"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_what_git_found() {
        assert_eq!(
            describe("Bisecting: 5 revisions left to test after this (roughly 3 steps)\n[abc] Fix"),
            "Bisecting: test this commit (about 3 more steps after it)"
        );
        assert_eq!(
            describe("4f1a2b3c4d5e is the first bad commit\ncommit 4f1a2b3c4d5e\n"),
            "Found it: 4f1a2b3 is the first bad commit"
        );
    }
}
