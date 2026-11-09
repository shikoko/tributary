//! Splitting a commit of the checked-out branch in two: some of its files move into a new
//! commit right after it. The two commits are made from what's already saved in git (the
//! commit's files, and its parent's), never from the working tree, so uncommitted changes
//! aren't touched and nothing can conflict. The commits after it keep exactly their files:
//! they're only made again on top of the new pair.

use std::path::PathBuf;

use super::backups::back_up_rewrite;
use super::stacks::{and_moved, branch_tips, moved_along};
use super::support::{LITERAL, in_batches, ref_id};
use super::validate::{check_file_paths, commit_id, current_branch};
use crate::error::{Error, Result};
use crate::git::Git;

/// A commit's author, and its message, as git stored them.
struct Saved {
    author_name: String,
    author_email: String,
    /// "1731000000 +0100".
    author_date: String,
    message: String,
}

/// The author and message of commit `id`, from its raw object.
fn saved(git: &Git, id: &str) -> Result<Saved> {
    let raw = git.run(&["cat-file", "commit", id])?;
    let (header, message) = raw.split_once("\n\n").unwrap_or((raw.as_str(), ""));
    let author = header
        .lines()
        .find_map(|line| line.strip_prefix("author "))
        .ok_or("A commit without an author")?;
    // "Name <email> 1731000000 +0100"
    let (name, rest) = author
        .split_once(" <")
        .ok_or("A commit without an author")?;
    let (email, date) = rest.split_once("> ").ok_or("A commit without an author")?;
    Ok(Saved {
        author_name: name.to_owned(),
        author_email: email.to_owned(),
        author_date: date.trim().to_owned(),
        message: message.to_owned(),
    })
}

/// Make a commit of `tree` on `parent` with `message`, written by the author of `saved`.
fn commit(
    git: &Git,
    folder: &std::path::Path,
    tree: &str,
    parent: &str,
    message: &str,
    author: &Saved,
) -> Result<String> {
    let file = folder.join("message");
    std::fs::write(&file, message).map_err(|e| format!("Couldn't split the commit: {e}"))?;
    let file = file.to_string_lossy().into_owned();
    let id = git.run_with_env(
        &["commit-tree", tree, "-p", parent, "-F", &file],
        &[
            ("GIT_AUTHOR_NAME", &author.author_name),
            ("GIT_AUTHOR_EMAIL", &author.author_email),
            ("GIT_AUTHOR_DATE", &author.author_date),
        ],
    )?;
    Ok(id.trim().to_owned())
}

fn tidy(message: &str) -> Option<String> {
    let message = message.trim();
    (!message.is_empty()).then(|| format!("{message}\n"))
}

/// Split commit `id` of the checked-out branch: `paths` (some of the files it changes) move
/// into a new commit right after it, with message `second`; it keeps the rest, with
/// message `first`.
pub(super) fn split_commit(
    repo: &gix::Repository,
    git: &Git,
    id: String,
    paths: Vec<String>,
    first: String,
    second: String,
) -> Result<String> {
    let branch = current_branch(repo)?;
    if repo.state().is_some() {
        return Err("Finish or abort what's in progress first.".into());
    }
    let id = commit_id(repo, &id)?;
    let target = id.to_string();
    let short = id.to_hex_with_len(7).to_string();
    let paths = check_file_paths(&paths)?;
    let (first, second) = (
        tidy(&first).ok_or("Write a message for the first commit.")?,
        tidy(&second).ok_or("Write a message for the new commit.")?,
    );
    if git
        .run(&["merge-base", "--is-ancestor", &target, "HEAD"])
        .is_err()
    {
        return Err(format!("{short} isn't part of {branch}'s history.").into());
    }
    let commit_object = repo
        .find_commit(id)
        .map_err(|e| format!("Could not read {short}: {e}"))?;
    let parents: Vec<String> = commit_object.parent_ids().map(|p| p.to_string()).collect();
    let parent = match parents.as_slice() {
        [parent] => parent.clone(),
        [] => return Err("The very first commit can't be split here.".into()),
        _ => return Err("A merge commit can't be split.".into()),
    };
    let range = format!("{target}..HEAD");
    if !git
        .run(&["rev-list", "--merges", &range])?
        .trim()
        .is_empty()
    {
        return Err(format!(
            "The commits after {short} include merges, which can't be rewritten this way."
        )
        .into());
    }
    // Oldest first.
    let after: Vec<String> = git
        .run(&["rev-list", "--reverse", &range])?
        .lines()
        .map(str::to_owned)
        .collect();

    // The files it changes: those moving out must be some of them, not all.
    let changed = git.run(&[
        "diff-tree",
        "-r",
        "--name-only",
        "--no-renames",
        "-z",
        &parent,
        &target,
    ])?;
    let changed: Vec<&str> = changed.split('\0').filter(|f| !f.is_empty()).collect();
    if let Some(stranger) = paths.iter().find(|path| !changed.contains(path)) {
        return Err(format!("{short} doesn't change {stranger}.").into());
    }
    if paths.len() >= changed.len() {
        return Err("Leave at least one file in the first commit.".into());
    }

    let folder: PathBuf = repo.git_dir().join("tributary-split");
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).map_err(|e| format!("Couldn't split the commit: {e}"))?;
    let result = (|| -> Result<(String, Vec<(String, String)>)> {
        // The first commit's files: the commit's, with the files moving out as they were
        // before it. Worked out in an index of its own, so the real one isn't touched.
        let index = folder.join("index").to_string_lossy().into_owned();
        let env = [("GIT_INDEX_FILE", index.as_str()), LITERAL[0]];
        git.run_with_env(&["read-tree", &target], &env)?;
        for batch in in_batches(&paths) {
            let mut args = vec!["reset", "-q", parent.as_str(), "--"];
            args.extend(batch);
            git.run_with_env(&args, &env)?;
        }
        let first_tree = git.run_with_env(&["write-tree"], &env)?.trim().to_owned();
        let author = saved(git, &target)?;
        let one = commit(git, &folder, &first_tree, &parent, &first, &author)?;
        let whole_tree = format!("{target}^{{tree}}");
        let mut top = commit(git, &folder, &whole_tree, &one, &second, &author)?;
        // The commits after it, again on top: the same files, the same authors and messages.
        let mut renewed = vec![(target.clone(), top.clone())];
        for later in &after {
            let saved = saved(git, later)?;
            top = commit(
                git,
                &folder,
                &format!("{later}^{{tree}}"),
                &top,
                &saved.message,
                &saved,
            )?;
            renewed.push((later.clone(), top.clone()));
        }
        Ok((top, renewed))
    })();
    let _ = std::fs::remove_dir_all(&folder);
    let (top, renewed) = result?;

    let full = format!("refs/heads/{branch}");
    let before = ref_id(repo, &full);
    let old = before.map(|id| id.to_string()).unwrap_or_default();
    git.run(&[
        "update-ref",
        "-m",
        &format!("rebase (split): {short}"),
        &full,
        &top,
        &old,
    ])
    .map_err(|e| Error::from(format!("Couldn't move {branch} ({e})")))?;
    back_up_rewrite(repo, git, &branch, before);
    // Other branches pointing at the old commits (stacked on them) move to the new ones.
    let tips = branch_tips(git);
    for (name, id) in &tips {
        let Some((_, new)) = renewed.iter().find(|(old, _)| old == id) else {
            continue;
        };
        if *name != branch {
            let _ = git.run(&[
                "update-ref",
                "-m",
                &format!("rebase (split): {short}"),
                &format!("refs/heads/{name}"),
                new,
                id,
            ]);
        }
    }
    let moved = moved_along(repo, git, &branch, &tips);
    Ok(format!("Split {short} in two{}", and_moved(&moved)))
}
