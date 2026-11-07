//! Stashing changes and applying, popping or dropping stashes.

use super::support::{LITERAL, describe_files};
use super::validate::check_file_paths;
use crate::error::{Error, Result};
use crate::git::Git;

/// `git stash push`.
pub(super) fn stash_push(
    git: &Git,
    message: Option<String>,
    include_untracked: bool,
    paths: Vec<String>,
) -> Result<String> {
    let before = stash_top(git);
    let mut args = vec!["stash", "push", "--quiet"];
    if include_untracked {
        args.push("--include-untracked");
    }
    let message = message
        .map(|m| m.trim().to_owned())
        .filter(|m| !m.is_empty());
    if let Some(message) = &message {
        args.extend(["--message", message]);
    }
    let paths = if paths.is_empty() {
        Vec::new()
    } else {
        check_file_paths(&paths)?
    };
    if !paths.is_empty() {
        args.push("--");
        args.extend(&paths);
    }
    git.run_with_env(&args, &LITERAL)?;
    if stash_top(git) == before {
        return Err("There are no changes to stash.".into());
    }
    Ok(if paths.is_empty() {
        "Stashed your changes as stash@{0}".into()
    } else {
        format!("Stashed {} as stash@{{0}}", describe_files(&paths))
    })
}

/// Apply `stash@{index}`, which must be the stash commit `id`, and keep it.
pub(super) fn stash_apply(git: &Git, index: usize, id: String) -> Result<String> {
    let name = stash_name(git, index, &id)?;
    git.run(&["stash", "apply", "--quiet", &name])?;
    Ok(format!("Applied {name}"))
}

/// Apply `stash@{index}` and remove it from the stash list.
pub(super) fn stash_pop(git: &Git, index: usize, id: String) -> Result<String> {
    let name = stash_name(git, index, &id)?;
    git.run(&["stash", "pop", "--quiet", &name])?;
    Ok(format!("Applied and removed {name}"))
}

/// Remove `stash@{index}` without applying it.
pub(super) fn stash_drop(git: &Git, index: usize, id: String) -> Result<String> {
    let name = stash_name(git, index, &id)?;
    git.run(&["stash", "drop", "--quiet", &name])?;
    Ok(format!("Dropped {name}"))
}

/// The id of the newest stash, if there is one.
pub(super) fn stash_top(git: &Git) -> Option<String> {
    git.run(&["rev-parse", "--quiet", "--verify", "refs/stash"])
        .ok()
}

/// Put the newest stash back, with its staged changes staged again when possible.
pub(super) fn pop_stash(git: &Git) -> Result<(), Error> {
    match git.run(&["stash", "pop", "--quiet", "--index"]) {
        Err(error) if error.to_string().contains("--index") => {
            git.run(&["stash", "pop", "--quiet"]).map(drop)
        }
        result => result.map(drop),
    }
}

/// `stash@{index}`, after checking that it still is the stash the user picked.
pub(super) fn stash_name(git: &Git, index: usize, id: &str) -> Result<String, Error> {
    let name = format!("stash@{{{index}}}");
    let actual = git
        .run(&["rev-parse", "--quiet", "--verify", &name])
        .unwrap_or_default();
    if actual.trim() != id {
        return Err("The stash list changed. Refresh and try again.".into());
    }
    Ok(name)
}
