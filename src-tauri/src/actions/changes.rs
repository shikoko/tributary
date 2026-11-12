//! Staging, committing, discarding and ignoring changes in the working tree.

use super::Extra;
use super::backups::{DISCARDED, forget_old_discards};
use super::stash::stash_top;
use super::support::{LITERAL, count, describe_files, in_batches, now_millis, ref_id};
use super::validate::{check_file_paths, check_paths, check_patterns};
use crate::error::Result;
use crate::git::Git;

/// Stage files (`git add`).
pub(super) fn stage(git: &Git, paths: Vec<String>) -> Result<String> {
    let paths = check_paths(&paths)?;
    // A few thousand at once (a filtered list) would be too long for one command line.
    for batch in in_batches(&paths) {
        let mut args = vec!["add", "--"];
        args.extend(batch);
        git.run_with_env(&args, &LITERAL)?;
    }
    Ok(format!("Staged {}", count(paths.len(), "file")))
}

/// Unstage files, keeping their changes in the working tree.
pub(super) fn unstage(repo: &gix::Repository, git: &Git, paths: Vec<String>) -> Result<String> {
    let paths = check_paths(&paths)?;
    let command: &[&str] = if repo.head_id().is_ok() {
        &["restore", "--staged", "--"]
    } else {
        // Nothing is committed yet, so there's no HEAD to restore from.
        &["rm", "--cached", "--quiet", "-r", "--"]
    };
    for batch in in_batches(&paths) {
        let mut args = command.to_vec();
        args.extend(batch);
        git.run_with_env(&args, &LITERAL)?;
    }
    Ok(format!("Unstaged {}", count(paths.len(), "file")))
}

/// Stage every change, including untracked files.
pub(super) fn stage_all(git: &Git) -> Result<String> {
    git.run(&["add", "--all"])?;
    Ok("Staged all changes".into())
}

/// Unstage everything.
pub(super) fn unstage_all(repo: &gix::Repository, git: &Git) -> Result<String> {
    if repo.head_id().is_ok() {
        git.run(&["reset", "--quiet"])?;
    } else {
        git.run(&["rm", "--cached", "--quiet", "-r", "."])?;
    }
    Ok("Unstaged all changes".into())
}

/// Commit the staged changes, or amend the last commit.
pub(super) fn commit(git: &Git, message: String, amend: bool, no_verify: bool) -> Result<String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Write a commit message first.".into());
    }
    let mut args = vec!["commit", "--quiet", "--cleanup=strip", "--message", message];
    if amend {
        args.push("--amend");
    }
    // Without the repository's pre-commit and commit-msg hooks, when they stopped it.
    if no_verify {
        args.push("--no-verify");
    }
    git.run(&args)
        .map_err(|error| super::hooks::explain(git, error, false))?;
    let id = git.run(&["rev-parse", "--short", "HEAD"])?;
    let summary = message.lines().next().unwrap_or_default();
    Ok(format!(
        "{} {}: {summary}",
        if amend { "Amended" } else { "Committed" },
        id.trim()
    ))
}

/// Throw away the changes to files (untracked ones are deleted). What they were is
/// kept for [`BACKUP_DAYS`] days, to undo with [`Action::RestoreDiscarded`].
pub(super) fn discard_files(
    repo: &gix::Repository,
    git: &Git,
    paths: Vec<String>,
    extra: &mut Extra,
) -> Result<String> {
    let paths = check_file_paths(&paths)?;
    stash_away(repo, git, &paths, extra)?;
    Ok(format!(
        "Discarded the changes to {}",
        describe_files(&paths)
    ))
}

/// Throw away every uncommitted change: new files are deleted too (ignored ones stay).
/// What they were is kept for [`BACKUP_DAYS`] days, to undo with
/// [`Action::RestoreDiscarded`].
pub(super) fn discard_all(repo: &gix::Repository, git: &Git, extra: &mut Extra) -> Result<String> {
    stash_away(repo, git, &[], extra)?;
    Ok("Discarded all uncommitted changes".into())
}

/// Take the changes to `paths` (all of them when there are none) out of the working tree,
/// untracked files too, and keep them under [`DISCARDED`] for undo (in `extra.backup`).
fn stash_away(repo: &gix::Repository, git: &Git, paths: &[&str], extra: &mut Extra) -> Result<()> {
    let before = stash_top(git);
    // A stash keeps the changes (untracked files too) and removes them in one go.
    let mut args = vec![
        "stash",
        "push",
        "--quiet",
        "--include-untracked",
        "--message",
        "Tributary: discarded changes",
    ];
    if paths.is_empty() {
        // Not with literal pathspecs: then git's own ":/" (the whole working tree), which it
        // cleans the untracked files from, would match nothing.
        git.run(&args)?;
    } else {
        args.push("--");
        args.extend(paths);
        git.run_with_env(&args, &LITERAL)?;
    }
    let Some(stash) = stash_top(git).filter(|top| Some(top) != before.as_ref()) else {
        return Err("There were no changes to discard.".into());
    };
    // Keep it out of the stash list, where it would only be in the way.
    let reference = format!("{DISCARDED}{}", now_millis());
    git.run(&["update-ref", &reference, stash.trim()])?;
    git.run(&["stash", "drop", "--quiet"])?;
    forget_old_discards(repo, git);
    extra.backup = Some(reference);
    Ok(())
}

/// Put back changes thrown away by [`Action::DiscardFiles`].
pub(super) fn restore_discarded(
    repo: &gix::Repository,
    git: &Git,
    reference: String,
) -> Result<String> {
    if !reference.starts_with(DISCARDED) || ref_id(repo, &reference).is_none() {
        return Err("Those changes aren't kept any more.".into());
    }
    match git.run(&["stash", "apply", "--quiet", "--index", &reference]) {
        Err(error)
            if error.to_string().contains("--index") || error.to_string().contains("index") =>
        {
            git.run(&["stash", "apply", "--quiet", &reference])?;
        }
        result => {
            result?;
        }
    }
    git.run(&["update-ref", "-d", &reference])?;
    Ok("Put the discarded changes back".into())
}

/// Add patterns (like `*.log` or `Saved/`) to the repository's `.gitignore`.
pub(super) fn ignore_paths(git: &Git, patterns: Vec<String>) -> Result<String> {
    let patterns = check_patterns(&patterns)?;
    let file = git.workdir().join(".gitignore");
    let mut text = std::fs::read_to_string(&file).unwrap_or_default();
    let existing: Vec<String> = text.lines().map(|line| line.trim().to_owned()).collect();
    let new: Vec<&str> = patterns
        .iter()
        .copied()
        .filter(|pattern| !existing.iter().any(|line| line == pattern))
        .collect();
    if !new.is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        for pattern in &new {
            text.push_str(pattern);
            text.push('\n');
        }
        std::fs::write(&file, text).map_err(|e| format!("Couldn't write .gitignore: {e}"))?;
    }
    Ok(format!("Ignoring {}", patterns.join(", ")))
}

/// Take patterns out of `.gitignore` again (undo).
pub(super) fn unignore_paths(git: &Git, patterns: Vec<String>) -> Result<String> {
    let patterns = check_patterns(&patterns)?;
    let file = git.workdir().join(".gitignore");
    let text = std::fs::read_to_string(&file).unwrap_or_default();
    let mut lines: Vec<&str> = text.lines().collect();
    for pattern in &patterns {
        // The last time it's listed: the one that was just added.
        if let Some(index) = lines.iter().rposition(|line| line.trim() == *pattern) {
            lines.remove(index);
        }
    }
    if lines.iter().all(|line| line.trim().is_empty()) {
        let _ = std::fs::remove_file(&file);
    } else {
        let mut text = lines.join("\n");
        text.push('\n');
        std::fs::write(&file, text).map_err(|e| format!("Couldn't write .gitignore: {e}"))?;
    }
    Ok(format!("No longer ignoring {}", patterns.join(", ")))
}
