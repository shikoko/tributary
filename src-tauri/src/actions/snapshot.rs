//! The working copy's versions of some files, as a commit on top of HEAD, made with a
//! temporary staging area: the files themselves, what's staged and the stashes aren't
//! touched. Shelves share them with the team; local history keeps them for a while.

use std::path::Path;

use super::support::{LITERAL, in_batches, now_millis};
use crate::error::Result;
use crate::git::Git;

/// A commit of the working copy's versions of `paths` (every change, untracked files too,
/// when empty) on top of HEAD, with `message`. `env` adds to git's environment (an identity,
/// say). None when the files are just as HEAD has them.
pub(super) fn snapshot_commit(
    git: &Git,
    git_dir: &Path,
    paths: &[String],
    message: &str,
    env: &[(&str, &str)],
) -> Result<Option<String>> {
    let index = git_dir.join(format!(
        "tributary-snapshot-{}-{}.index",
        std::process::id(),
        now_millis()
    ));
    let result = commit_with_index(git, &index.to_string_lossy(), paths, message, env);
    let _ = std::fs::remove_file(&index);
    result
}

fn commit_with_index(
    git: &Git,
    index: &str,
    paths: &[String],
    message: &str,
    env: &[(&str, &str)],
) -> Result<Option<String>> {
    let with_index = [("GIT_INDEX_FILE", index), LITERAL[0]];
    let head = git
        .run(&["rev-parse", "--verify", "--quiet", "HEAD"])
        .ok()
        .map(|id| id.trim().to_owned());
    // Start from HEAD's files, then take the working copy's versions of these.
    let start = if head.is_some() { "HEAD" } else { "--empty" };
    git.run_with_env(&["read-tree", start], &with_index)?;
    if paths.is_empty() {
        git.run_with_env(&["add", "--all"], &with_index)?;
    } else {
        let found = existing(git, &with_index, paths)?;
        let found: Vec<&str> = found.iter().map(String::as_str).collect();
        for batch in in_batches(&found) {
            let mut args = vec!["add", "--all", "--"];
            args.extend(batch);
            git.run_with_env(&args, &with_index)?;
        }
    }
    let tree = git.run_with_env(&["write-tree"], &with_index)?;
    let tree = tree.trim();
    let head_tree = head
        .as_ref()
        .and_then(|_| git.run(&["rev-parse", "HEAD^{tree}"]).ok());
    if head_tree.as_deref().map(str::trim) == Some(tree) {
        return Ok(None);
    }
    let mut args = vec!["commit-tree", tree, "-m", message];
    if let Some(head) = &head {
        args.extend(["-p", head.as_str()]);
    }
    let id = git.run_with_env(&args, env)?;
    Ok(Some(id.trim().to_owned()))
}

/// Of `paths`, those git can take: on disk, or in HEAD (deleted since). A file that's
/// neither (changed back and removed again meanwhile) would stop `git add`.
fn existing(git: &Git, with_index: &[(&str, &str)], paths: &[String]) -> Result<Vec<String>> {
    let (mut found, gone): (Vec<String>, Vec<String>) = paths
        .iter()
        .cloned()
        .partition(|path| git.workdir().join(path).symlink_metadata().is_ok());
    let gone: Vec<&str> = gone.iter().map(String::as_str).collect();
    for batch in in_batches(&gone) {
        let mut args = vec!["ls-files", "-z", "--"];
        args.extend(batch);
        let listed = git.run_with_env(&args, with_index)?;
        let listed: Vec<&str> = listed.split('\0').collect();
        found.extend(
            batch
                .iter()
                .filter(|path| listed.contains(path))
                .map(|path| (*path).to_owned()),
        );
    }
    Ok(found)
}

/// A name and email for a commit Tributary makes for itself (local history), when git
/// doesn't have one: those set win.
pub(super) fn identity_or_tributary(git: &Git) -> Vec<(&'static str, &'static str)> {
    let has = |key: &str| {
        git.run(&["config", key])
            .is_ok_and(|value| !value.trim().is_empty())
    };
    if has("user.name") && has("user.email") {
        return Vec::new();
    }
    vec![
        ("GIT_AUTHOR_NAME", "Tributary"),
        ("GIT_AUTHOR_EMAIL", "tributary@localhost"),
        ("GIT_COMMITTER_NAME", "Tributary"),
        ("GIT_COMMITTER_EMAIL", "tributary@localhost"),
    ]
}
