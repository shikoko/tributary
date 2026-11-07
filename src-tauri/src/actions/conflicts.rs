//! Merges, rebases, cherry-picks and reverts that stopped: resolving conflicts, then
//! continuing, skipping or aborting.

use super::Side;
use super::support::{LITERAL, describe_files, file_name, in_batches};
use super::validate::{check_file_paths, in_progress};
use crate::error::{Error, Result};
use crate::git::Git;

/// Resolve conflicted files by taking one side's version of each whole file: yours
/// (the checked-out branch, or the branch being rebased) or theirs. A side that
/// deleted the file deletes it. For files that can't be merged, like game assets.
pub(super) fn resolve_conflicts(
    repo: &gix::Repository,
    git: &Git,
    paths: Vec<String>,
    keep: Side,
) -> Result<String> {
    take_side(repo, git, &paths, keep)
}

/// Put the conflicts back into files resolved with [`Action::ResolveConflicts`] (undo).
pub(super) fn recreate_conflicts(
    repo: &gix::Repository,
    git: &Git,
    paths: Vec<String>,
) -> Result<String> {
    let paths = check_file_paths(&paths)?;
    in_progress(repo)?;
    // git remembers how resolved files conflicted: bring that back into the index,
    // then put the conflicted files back as the merge left them.
    for batch in in_batches(&paths) {
        let mut args = vec!["update-index", "--unresolve", "--"];
        args.extend(batch);
        git.run_with_env(&args, &LITERAL)?;
    }
    let stages = conflict_stages(git, &paths)?;
    let (mut both, mut ours, mut theirs) = (Vec::new(), Vec::new(), Vec::new());
    for &path in &paths {
        match stages.get(path) {
            Some(found) if found.contains(&'2') && found.contains(&'3') => both.push(path),
            Some(found) if found.contains(&'2') => ours.push(path),
            Some(found) if found.contains(&'3') => theirs.push(path),
            _ => {}
        }
    }
    for (flag, list) in [("--merge", &both), ("--ours", &ours), ("--theirs", &theirs)] {
        for batch in in_batches(list) {
            let mut args = vec!["checkout", flag, "--"];
            args.extend(batch);
            // Binary files can't get conflict markers; git leaves your version.
            let _ = git.run_with_env(&args, &LITERAL);
        }
    }
    Ok(format!(
        "Put the conflicts back in {}",
        describe_files(&paths)
    ))
}

/// Carry on with a merge, rebase, cherry-pick or revert after resolving conflicts.
pub(super) fn continue_operation(repo: &gix::Repository, git: &Git) -> Result<String> {
    let operation = in_progress(repo)?;
    if operation == "merge" {
        git.run(&["commit", "--no-edit", "--quiet"])?;
    } else {
        git.run(&[operation, "--continue"])?;
    }
    Ok(format!("Finished the {operation}"))
}

/// Leave out the commit a rebase, cherry-pick or revert stopped at.
pub(super) fn skip_commit(repo: &gix::Repository, git: &Git) -> Result<String> {
    let operation = in_progress(repo)?;
    if operation == "merge" {
        return Err("A merge can't skip commits. Abort it instead.".into());
    }
    git.run(&[operation, "--skip"])?;
    Ok(format!(
        "Skipped the commit and carried on with the {operation}"
    ))
}

/// Give up on a merge, rebase, cherry-pick or revert, going back to how things were.
pub(super) fn abort_operation(repo: &gix::Repository, git: &Git) -> Result<String> {
    let operation = in_progress(repo)?;
    git.run(&[operation, "--abort"])?;
    Ok(format!("Aborted the {operation}"))
}

/// Which versions each conflicted file among `paths` has in the index: '1' (the common
/// ancestor), '2' (ours) and '3' (theirs).
pub(super) fn conflict_stages(
    git: &Git,
    paths: &[&str],
) -> Result<std::collections::HashMap<String, Vec<char>>, Error> {
    let mut stages: std::collections::HashMap<String, Vec<char>> = Default::default();
    for batch in in_batches(paths) {
        let mut args = vec!["ls-files", "--unmerged", "-z", "--"];
        args.extend(batch);
        // "<mode> <id> <stage>\t<path>" records.
        for record in git.run_with_env(&args, &LITERAL)?.split('\0') {
            let Some((info, path)) = record.split_once('\t') else {
                continue;
            };
            if let Some(number) = info.split(' ').nth(2).and_then(|s| s.chars().next()) {
                stages.entry(path.to_owned()).or_default().push(number);
            }
        }
    }
    Ok(stages)
}

fn take_side(
    repo: &gix::Repository,
    git: &Git,
    paths: &[String],
    keep: Side,
) -> Result<String, Error> {
    use gix::state::InProgress;
    let paths = check_file_paths(paths)?;
    let rebasing = matches!(
        repo.state(),
        Some(InProgress::Rebase | InProgress::RebaseInteractive | InProgress::ApplyMailboxRebase)
    );
    // While rebasing, git's "ours" is the branch being rebased onto, and "theirs" is your
    // own commit being replayed on top of it.
    let ours = (keep == Side::Mine) != rebasing;
    let (flag, stage) = if ours {
        ("--ours", '2')
    } else {
        ("--theirs", '3')
    };

    let stages = conflict_stages(git, &paths)?;
    let mut take = Vec::new();
    let mut delete = Vec::new();
    for &path in &paths {
        match stages.get(path) {
            None => {}
            Some(found) if found.contains(&stage) => take.push(path),
            // That side deleted the file.
            Some(_) => delete.push(path),
        }
    }
    if take.is_empty() && delete.is_empty() {
        return Err(if paths.len() == 1 {
            format!("{} has no conflicts left.", file_name(paths[0])).into()
        } else {
            "These files have no conflicts left.".into()
        });
    }
    for batch in in_batches(&take) {
        let mut args = vec!["checkout", flag, "--"];
        args.extend(batch);
        git.run_with_env(&args, &LITERAL)?;
        let mut args = vec!["add", "--"];
        args.extend(batch);
        git.run_with_env(&args, &LITERAL)?;
    }
    for batch in in_batches(&delete) {
        let mut args = vec!["rm", "--quiet", "--"];
        args.extend(batch);
        git.run_with_env(&args, &LITERAL)?;
    }
    let mut resolved = take;
    resolved.extend(delete);
    Ok(match keep {
        Side::Mine => format!("Kept your version of {}", describe_files(&resolved)),
        Side::Theirs => format!("Took their version of {}", describe_files(&resolved)),
    })
}
