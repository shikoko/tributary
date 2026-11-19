//! Fetching, pulling and pushing.

use std::path::Path;

use gix::bstr::ByteSlice;
use serde::Serialize;
use ts_rs::TS;

use super::Extra;
use super::backups::{BackupEvent, back_up};
use super::support::{count, now_millis, ref_id};
use super::validate::current_branch;
use crate::error::{Error, ErrorKind, Result};
use crate::git::{Git, Progress};
use crate::github::Forge;
use crate::links;

/// Fetch from every remote. `background` fetches never show sign-in prompts.
pub(super) fn fetch(
    repo: &gix::Repository,
    git: &Git,
    background: bool,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    // Its remotes, by name: "origin", or "origin and upstream" (this repository's only).
    let remotes: Vec<String> = repo
        .remote_names()
        .iter()
        .map(|name| name.to_string())
        .collect();
    if remotes.is_empty() {
        return Err("This repository has no remotes to fetch from.".into());
    }
    if background {
        // Nobody asked for this fetch, so never pop up a sign-in window for it.
        let git = git.in_background();
        git.run_with_env(
            &["fetch", "--all", "--prune", "--quiet"],
            &[("GCM_INTERACTIVE", "never")],
        )?;
    } else {
        git.run_progress(&["fetch", "--all", "--prune", "--progress"], on_progress)?;
    }
    Ok(format!("Fetched from {}", in_words(&remotes)))
}

/// Where a pull (or merge) request's own commits are kept once fetched:
/// `refs/tributary/requests/<millis>/<remote>/<number>`. Its branch can be on a fork, which
/// isn't one of this repository's remotes, so it has no remote branch to keep them.
pub(super) const REQUESTS: &str = "refs/tributary/requests/";
/// How long they're kept.
const REQUEST_DAYS: i64 = 30;

/// Fetch pull (or merge) request `number`'s own commits from `remote`, the remote it's on,
/// with `base`, the branch it goes into. The site keeps each one's commits there, under
/// `refs/pull/<number>/head` on GitHub and `refs/merge-requests/<number>/head` on GitLab,
/// even when its branch is on a fork.
pub(super) fn fetch_request(
    repo: &gix::Repository,
    git: &Git,
    remote: String,
    number: u64,
    forge: Forge,
    base: String,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    if !repo.remote_names().iter().any(|name| *name == remote) {
        return Err(format!("This repository has no remote called {remote}.").into());
    }
    // A branch's name, never read as one of git's options.
    if base.starts_with('-')
        || git
            .run(&["check-ref-format", "--branch", base.as_str()])
            .is_err()
    {
        return Err(format!("{base} isn't a branch's name.").into());
    }
    let (theirs, sign) = match forge {
        Forge::GitHub => (format!("refs/pull/{number}/head"), '#'),
        Forge::GitLab => (format!("refs/merge-requests/{number}/head"), '!'),
    };
    let kept = format!("{REQUESTS}{}/{remote}/{number}", now_millis());
    // The branch it goes into updates its remote branch too, as git does for a branch
    // fetched by name from a remote that fetches it anyway.
    git.run_progress(
        &[
            "fetch",
            "--progress",
            remote.as_str(),
            &format!("+{theirs}:{kept}"),
            &format!("refs/heads/{base}"),
        ],
        on_progress,
    )?;
    // Only its newest fetch is kept, and none for longer than a month.
    let cutoff = now_millis() - REQUEST_DAYS * 24 * 3600 * 1000;
    for (reference, (millis, at, at_number)) in request_refs(repo) {
        if reference != kept && (millis < cutoff || (at == remote && at_number == number)) {
            let _ = git.run(&["update-ref", "-d", &reference]);
        }
    }
    Ok(format!("Fetched {sign}{number} from {remote}"))
}

/// The fetched pull requests' refs: each with when it was fetched, its remote and number.
fn request_refs(repo: &gix::Repository) -> Vec<(String, (i64, String, u64))> {
    let Ok(platform) = repo.references() else {
        return Vec::new();
    };
    let Ok(refs) = platform.prefixed(REQUESTS) else {
        return Vec::new();
    };
    refs.flatten()
        .filter_map(|reference| {
            let name = reference.name().as_bstr().to_str_lossy().into_owned();
            let parts = parse_request(&name)?;
            Some((name, parts))
        })
        .collect()
}

/// `refs/tributary/requests/<millis>/<remote>/<number>` → its parts. A remote's name can
/// have slashes in it.
fn parse_request(name: &str) -> Option<(i64, String, u64)> {
    let rest = name.strip_prefix(REQUESTS)?;
    let (millis, rest) = rest.split_once('/')?;
    let (remote, number) = rest.rsplit_once('/')?;
    if remote.is_empty() {
        return None;
    }
    Some((
        millis.parse().ok()?,
        remote.to_owned(),
        number.parse().ok()?,
    ))
}

/// Pull into the checked-out branch.
pub(super) fn pull(
    repo: &gix::Repository,
    git: &Git,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    pull_with(repo, git, on_progress, false)
}

/// Pull the checked-out branch: with `rebase`, putting its own commits on top of what
/// arrived, whatever git's settings say.
fn pull_with(
    repo: &gix::Repository,
    git: &Git,
    on_progress: &dyn Fn(Progress),
    rebase: bool,
) -> Result<String> {
    let branch = current_branch(repo)?;
    // `--no-edit`: never wait for a merge message in an editor nobody can see.
    let mut args = vec!["pull", "--no-edit", "--progress"];
    // Without a merge-or-rebase preference, git refuses to pull a branch that has
    // diverged from its upstream. Merge then, like `git pull` used to by default.
    let config = repo.config_snapshot();
    let has_preference = [
        "pull.rebase".to_owned(),
        "pull.ff".to_owned(),
        format!("branch.{branch}.rebase"),
    ]
    .iter()
    .any(|key| config.string(key.as_str()).is_some());
    if rebase {
        args.push("--rebase");
    } else if !has_preference {
        args.push("--no-rebase");
    }
    // git fills in each Git LFS file as it checks it out, and LFS downloads each then, one
    // request a file. So fetch first, download the Git LFS files the pull brings all
    // together, then pull: its checkout finds them here (and its fetch has nothing to do).
    let before = git
        .run(&["rev-parse", "--verify", "--quiet", "HEAD"])
        .ok()
        .map(|id| id.trim().to_owned());
    let common = repo.common_dir().to_owned();
    if let Some(before) = &before
        && git.run(&["lfs", "version"]).is_ok()
    {
        git.run_progress(&["fetch", "--progress"], on_progress)?;
        super::lfs_count::prefetch(
            git,
            &common,
            &format!("{before}...@{{upstream}}"),
            "@{upstream}",
            on_progress,
        )?;
    }
    // Whatever's still to download then, one at a time, is at least counted.
    let expected = |seen: &std::collections::HashSet<String>| {
        let before = before.as_deref()?;
        super::lfs_count::lfs_downloads(
            git,
            &common,
            &format!("{before}...@{{upstream}}"),
            "@{upstream}",
            seen,
        )
    };
    git.run_progress_counting(&args, &[], on_progress, &expected)?;
    Ok(format!("Pulled {branch}"))
}

/// Fetch latest: fetch, then bring the checked-out branch up to date only when that's a
/// fast-forward. It never merges, so it can't conflict: a branch with commits of its own is
/// left as it is, and git refuses (changing nothing) when uncommitted changes are in the
/// way. The Git LFS files it brings are downloaded together first, as for a pull.
pub(super) fn fetch_latest(
    repo: &gix::Repository,
    git: &Git,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    let branch = current_branch(repo)?;
    git.run_progress(&["fetch", "--all", "--prune", "--progress"], on_progress)?;
    if git
        .run(&["rev-parse", "--verify", "--quiet", "@{upstream}"])
        .is_err()
    {
        return Ok(format!("Fetched: {branch} isn't on a remote"));
    }
    let counts = git.run(&["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])?;
    let (ahead, behind) = parse_counts(&counts);
    if behind == 0 {
        return Ok(format!("Fetched: {branch} is up to date"));
    }
    if ahead > 0 {
        return Ok(format!(
            "Fetched: {branch} has commits of its own, so it's left for you to pull"
        ));
    }
    let common = repo.common_dir().to_owned();
    let before = git
        .run(&["rev-parse", "--verify", "--quiet", "HEAD"])
        .ok()
        .map(|id| id.trim().to_owned());
    if let Some(before) = &before
        && git.run(&["lfs", "version"]).is_ok()
    {
        super::lfs_count::prefetch(
            git,
            &common,
            &format!("{before}...@{{upstream}}"),
            "@{upstream}",
            on_progress,
        )?;
    }
    let expected = |seen: &std::collections::HashSet<String>| {
        let before = before.as_deref()?;
        super::lfs_count::lfs_downloads(
            git,
            &common,
            &format!("{before}...@{{upstream}}"),
            "@{upstream}",
            seen,
        )
    };
    git.run_progress_counting(
        &["merge", "--ff-only", "--progress", "@{upstream}"],
        &[],
        on_progress,
        &expected,
    )?;
    Ok(format!("Brought {branch} up to date"))
}

/// Sync the checked-out branch with its remote branch: fetch, pull when the remote branch has
/// commits this one hasn't, then push when this one has commits it hasn't. A pull that stops
/// for conflicts stops it, before anything is pushed. A branch rewritten since it was pushed
/// isn't pulled, which would bring back the old versions of its commits: it stops, with
/// [`ErrorKind::Rewritten`], for a force push to be asked for instead. A branch with no remote branch
/// yet is pushed, setting it.
pub(super) fn sync(
    repo: &gix::Repository,
    git: &Git,
    on_progress: &dyn Fn(Progress),
    extra: &mut Extra,
) -> Result<String> {
    let branch = current_branch(repo)?;
    if git
        .run(&["rev-parse", "--verify", "--quiet", "@{upstream}"])
        .is_err()
    {
        return push(repo, git, Force::No, false, on_progress, extra);
    }
    let upstream = git
        .run(&["rev-parse", "--abbrev-ref", "@{upstream}"])?
        .trim()
        .to_owned();
    git.run_progress(&["fetch", "--progress"], on_progress)?;
    let counts = || -> Result<(u32, u32)> {
        Ok(parse_counts(&git.run(&[
            "rev-list",
            "--left-right",
            "--count",
            "HEAD...@{upstream}",
        ])?))
    };
    let (_, behind) = counts()?;
    if behind > 0 {
        if rewritten(git, &branch) {
            return Err(Error::known(
                ErrorKind::Rewritten,
                format!(
                    "{upstream} has older versions of {branch}'s commits (it was amended or \
                     rebased since it was pushed), so pulling would bring them back. Push it \
                     with force instead, to replace them."
                ),
            ));
        }
        // git set to only fast-forward (`pull.ff = only`), and nothing said about rebasing,
        // refuses to pull a branch with commits of its own, which is what syncing is for.
        // Rather than a merge commit, which that setting is there to avoid, its own commits
        // go on top of what arrived: they're only here, so nobody else has them yet.
        let config = repo.config_snapshot();
        let ff_only = config
            .string("pull.ff")
            .is_some_and(|value| value == "only");
        let says_rebase = config.string("pull.rebase").is_some()
            || config
                .string(format!("branch.{branch}.rebase").as_str())
                .is_some();
        pull_with(repo, git, on_progress, ff_only && !says_rebase)?;
    }
    let (ahead, _) = counts()?;
    if ahead > 0 {
        push(repo, git, Force::No, false, on_progress, extra)?;
    }
    Ok(match (behind, ahead) {
        (0, 0) => format!("{branch} was already in sync with {upstream}"),
        (0, _) => format!(
            "Synced {branch}: pushed {}",
            count(ahead as usize, "commit")
        ),
        (_, 0) => format!(
            "Synced {branch}: pulled {}",
            count(behind as usize, "commit")
        ),
        _ => format!(
            "Synced {branch}: pulled {}, then pushed {}",
            count(behind as usize, "commit"),
            count(ahead as usize, "commit")
        ),
    })
}

/// Whether any commit that's only on `branch`'s remote branch was once `branch` itself: it
/// was amended or rebased after being pushed. Its reflog remembers every commit it was.
fn rewritten(git: &Git, branch: &str) -> bool {
    let reflog = git
        .run(&[
            "reflog",
            "show",
            "--format=%H",
            &format!("refs/heads/{branch}"),
            "--",
        ])
        .unwrap_or_default();
    let was: std::collections::HashSet<&str> = reflog.lines().map(str::trim).collect();
    git.run(&["rev-list", "HEAD..@{upstream}"])
        .unwrap_or_default()
        .lines()
        .any(|id| was.contains(id.trim()))
}

/// `git rev-list --left-right --count` → (ahead, behind).
fn parse_counts(text: &str) -> (u32, u32) {
    let mut numbers = text
        .split_whitespace()
        .map(|part| part.parse::<u32>().unwrap_or(0));
    (numbers.next().unwrap_or(0), numbers.next().unwrap_or(0))
}

/// How a push treats a remote branch it would replace commits of.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Force {
    /// It doesn't: the remote branch must have everything that was pushed to it.
    No,
    /// It replaces what was there when it was last fetched (`--force-with-lease`), and
    /// stops if someone else pushed since then.
    Safe,
    /// It replaces whatever is there, commits someone else pushed since the last fetch too.
    /// They're fetched first, so the backup of what was replaced has them.
    Overwrite,
}

/// Push the checked-out branch, setting its upstream if it has none.
pub(super) fn push(
    repo: &gix::Repository,
    git: &Git,
    force: Force,
    no_verify: bool,
    on_progress: &dyn Fn(Progress),
    extra: &mut Extra,
) -> Result<String> {
    let branch = current_branch(repo)?;
    let forced = force != Force::No;
    let mut args = vec!["push".to_owned(), "--progress".to_owned()];
    if forced {
        args.push("--force-with-lease".into());
    }
    // Without the repository's pre-push hook, when it stopped the push.
    if no_verify {
        args.push("--no-verify".into());
    }
    // The remote branch's copy here, which a force push's lease is against.
    let mut tracking = None;
    let remote = match push_target(repo, &branch) {
        Some((remote, remote_branch)) => {
            if forced && let Some(leaf) = remote_branch.strip_prefix("refs/heads/") {
                let refspec = format!("+{remote_branch}:refs/remotes/{remote}/{leaf}");
                tracking = Some((format!("refs/remotes/{remote}/{leaf}"), refspec));
            }
            args.extend([remote.clone(), format!("HEAD:{remote_branch}")]);
            remote
        }
        None => {
            let remote = default_remote(repo)?;
            args.extend(["--set-upstream".into(), remote.clone(), "HEAD".into()]);
            remote
        }
    };
    // Replacing whatever is there: what's there is fetched first, so the lease is against
    // it, and the backup keeps it.
    let fetch_remote_branch =
        |refspec: &str| git.run_progress(&["fetch", "--progress", &remote, refspec], on_progress);
    if force == Force::Overwrite
        && let Some((_, refspec)) = &tracking
    {
        fetch_remote_branch(refspec)?;
    }
    // What a force push replaces on the remote, to keep a backup of.
    let replaced = tracking
        .as_ref()
        .and_then(|(name, _)| ref_id(repo, name).map(|id| (name.clone(), id)));
    // The files the pushed commits change (the ones the remote doesn't have yet): after the
    // push, locks on them can be released.
    let pushed_files = files_not_on(git, &remote);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = git.run_progress(&args, on_progress).map_err(|error| {
        // A safe force push stopped for commits someone else pushed: fetch them, so they
        // can be seen (and, if wanted, replaced too).
        if force == Force::Safe
            && error.to_string().contains("(stale info)")
            && let Some((_, refspec)) = &tracking
        {
            let _ = fetch_remote_branch(refspec);
        }
        super::hooks::explain(git, error, true)
    })?;
    extra.pushed_files = pushed_files;
    if let Some((tracking, id)) = replaced
        && ref_id(repo, "HEAD") != Some(id)
    {
        back_up(repo, git, &tracking, BackupEvent::ForcePushed, id);
    }
    extra.pull_request = links::pull_request_url(&output.messages);
    Ok(format!(
        "{} {branch} to {remote}",
        if forced { "Force pushed" } else { "Pushed" }
    ))
}

/// Commits on a remote branch that the checked-out branch doesn't have, and that weren't on
/// it at `since` (where it was before the last fetch): what someone else pushed to it.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UnseenCommits {
    pub count: u32,
    /// The newest few.
    pub commits: Vec<UnseenCommit>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UnseenCommit {
    pub id: String,
    pub summary: String,
    pub author: String,
    /// Seconds since 1970.
    pub time: i64,
}

/// The commits on `reference` (a remote branch: `origin/main`) that HEAD doesn't have, and
/// that `since` (a commit) doesn't either.
pub fn unseen_commits(path: &Path, reference: &str, since: Option<&str>) -> Result<UnseenCommits> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo.workdir().unwrap_or(repo.git_dir()).to_owned();
    let git = Git::find(workdir)?;
    let mut range = vec![reference.to_owned(), "^HEAD".to_owned()];
    if let Some(since) = since.filter(|id| id.chars().all(|c| c.is_ascii_hexdigit())) {
        range.push(format!("^{since}"));
    }
    let range: Vec<&str> = range.iter().map(String::as_str).collect();
    let count = git
        .run(&[&["rev-list", "--count", "--end-of-options"][..], &range].concat())?
        .trim()
        .parse()
        .unwrap_or(0);
    let commits = git
        .run(
            &[
                &[
                    "log",
                    "--max-count=5",
                    "--format=%H%x1f%s%x1f%an%x1f%ct",
                    "--end-of-options",
                ][..],
                &range,
            ]
            .concat(),
        )?
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            Some(UnseenCommit {
                id: parts.next()?.to_owned(),
                summary: parts.next()?.to_owned(),
                author: parts.next()?.to_owned(),
                time: parts.next()?.trim().parse().ok()?,
            })
        })
        .collect();
    Ok(UnseenCommits { count, commits })
}

/// The files changed by the commits on HEAD that `remote` doesn't have yet.
fn files_not_on(git: &Git, remote: &str) -> Vec<String> {
    let remotes = format!("--remotes={remote}");
    let Ok(output) = git.run(&[
        "log",
        "--format=",
        "--name-only",
        "-z",
        "HEAD",
        "--not",
        &remotes,
    ]) else {
        return Vec::new();
    };
    let mut files: Vec<String> = output
        .split(['\0', '\n'])
        .filter(|file| !file.is_empty())
        .map(str::to_owned)
        .collect();
    files.sort();
    files.dedup();
    files
}

/// Where the checked-out `branch` pushes to: its remote and the remote branch it
/// tracks, from the branch's configuration.
pub(super) fn push_target(repo: &gix::Repository, branch: &str) -> Option<(String, String)> {
    let remote = repo
        .branch_remote_name(branch, gix::remote::Direction::Push)?
        .as_bstr()
        .to_str()
        .ok()?
        .to_owned();
    let full_name: gix::refs::FullName = format!("refs/heads/{branch}").try_into().ok()?;
    let merge = repo
        .branch_remote_ref_name(full_name.as_ref(), gix::remote::Direction::Fetch)?
        .ok()?;
    let merge = merge.as_bstr().to_str().ok()?.to_owned();
    (!remote.starts_with('-') && merge.starts_with("refs/")).then_some((remote, merge))
}

/// The remote to push a branch without an upstream to: the configured default,
/// `origin`, or the only remote there is.
pub(super) fn default_remote(repo: &gix::Repository) -> Result<String, Error> {
    let names: Vec<String> = repo
        .remote_names()
        .iter()
        .map(|name| name.to_str_lossy().into_owned())
        .collect();
    let configured = repo
        .remote_default_name(gix::remote::Direction::Push)
        .map(|name| name.to_str_lossy().into_owned());
    let remote = configured
        .filter(|name| names.contains(name))
        .or_else(|| names.iter().find(|name| *name == "origin").cloned())
        .or_else(|| (names.len() == 1).then(|| names[0].clone()))
        .ok_or_else(|| {
            if names.is_empty() {
                "This repository has no remote to push to.".to_owned()
            } else {
                format!(
                    "This branch has no upstream and there are several remotes ({}). Push it once with git to choose one.",
                    names.join(", ")
                )
            }
        })?;
    if remote.starts_with('-') {
        return Err(format!("Unsupported remote name {remote}").into());
    }
    Ok(remote)
}

/// Names in words: "origin", "origin and upstream", "origin, upstream and mirror".
fn in_words(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

#[cfg(test)]
mod tests {
    use super::{in_words, parse_counts, parse_request};

    #[test]
    fn names_the_remotes_in_words() {
        let names =
            |list: &[&str]| in_words(&list.iter().map(|name| name.to_string()).collect::<Vec<_>>());
        assert_eq!(names(&["origin"]), "origin");
        assert_eq!(names(&["origin", "upstream"]), "origin and upstream");
        assert_eq!(
            names(&["origin", "upstream", "mirror"]),
            "origin, upstream and mirror"
        );
    }

    #[test]
    fn reads_fetched_pull_requests_refs() {
        assert_eq!(
            parse_request("refs/tributary/requests/1700000000000/origin/12"),
            Some((1_700_000_000_000, "origin".into(), 12))
        );
        assert_eq!(
            parse_request("refs/tributary/requests/1/team/upstream/7"),
            Some((1, "team/upstream".into(), 7))
        );
        assert_eq!(parse_request("refs/tributary/requests/1/12"), None);
        assert_eq!(parse_request("refs/tributary/requests/x/origin/12"), None);
        assert_eq!(parse_request("refs/tributary/backups/1/origin/12"), None);
    }

    #[test]
    fn reads_ahead_and_behind() {
        assert_eq!(parse_counts("2\t5\n"), (2, 5));
        assert_eq!(parse_counts("0\t0"), (0, 0));
        assert_eq!(parse_counts(""), (0, 0));
    }
}
