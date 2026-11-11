//! Shelves: unfinished work shared with the team without committing it to a branch, as
//! Perforce has them. A shelf is a commit of the files' current versions on top of the
//! commit they were changed from (made without touching anything here, see `snapshot`),
//! pushed to a hidden ref on the remote with its Git LFS files. Anyone can open one: its
//! files are taken into their working copy, as they were shelved.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::Extra;
use super::changes::discard_files;
use super::lfs_count::{prefetch, remote_for};
use super::snapshot::snapshot_commit;
use super::support::{LITERAL, count, describe_files, now_millis};
use super::validate::check_file_paths;
use crate::error::{Error, Result};
use crate::git::{Git, Progress};

/// Where shelves are kept, here and on the remote.
pub(super) const SHELVES: &str = "refs/tributary/shelves/";

/// The trailer that says which branch a shelf was made on.
const FROM: &str = "Shelved-From: ";

/// A shelf, someone's or your own.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    /// Its ref, under `refs/tributary/shelves/`.
    pub reference: String,
    pub id: String,
    /// What it's for, as its author wrote it.
    pub description: String,
    pub author: String,
    pub email: String,
    /// When it was shelved (seconds since the epoch).
    pub time: i64,
    /// The branch it was shelved on, and the commit its files were changed from.
    pub branch: Option<String>,
    pub base: Option<String>,
    /// Whether it's yours (by its email).
    pub mine: bool,
    pub files: Vec<ShelfFile>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ShelfFile {
    pub path: String,
    /// "added", "modified" or "deleted".
    pub change: &'static str,
}

/// The shelves there are, newest first. With `fetch`, the remote's are fetched first (and
/// those deleted there are forgotten here).
pub fn shelves(path: &Path, fetch: bool) -> Result<Vec<Shelf>, Error> {
    let git = Git::find(path.to_owned())?.in_background();
    if fetch && let Some(remote) = remote_for(&git, "HEAD") {
        let refspec = format!("+{SHELVES}*:{SHELVES}*");
        git.run(&[
            "fetch",
            "--quiet",
            "--no-tags",
            "--prune",
            &remote,
            &refspec,
        ])?;
    }
    let listing = git.run(&[
        "for-each-ref",
        "--format=%(refname)%09%(objectname)",
        SHELVES,
    ])?;
    let refs: Vec<(&str, &str)> = listing
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .collect();
    if refs.is_empty() {
        return Ok(Vec::new());
    }
    let me = my_email(&git);
    // Every shelf's commit in one go: id, parent, author, email, time, message.
    let mut args = vec![
        "log",
        "--no-walk=unsorted",
        "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%B%x1e",
    ];
    args.extend(refs.iter().map(|(_, id)| *id));
    let log = git.run(&args)?;
    let mut found = Vec::new();
    for record in log.split('\x1e') {
        let fields: Vec<&str> = record.trim_start_matches('\n').splitn(6, '\0').collect();
        let [id, parents, author, email, time, message] = fields[..] else {
            continue;
        };
        let Some((reference, _)) = refs.iter().find(|(_, each)| *each == id) else {
            continue;
        };
        let base = parents.split_whitespace().next().map(str::to_owned);
        found.push(Shelf {
            reference: (*reference).to_owned(),
            id: id.to_owned(),
            description: message.lines().next().unwrap_or_default().trim().to_owned(),
            author: author.to_owned(),
            email: email.to_owned(),
            time: time.trim().parse().unwrap_or(0),
            branch: message
                .lines()
                .find_map(|line| line.strip_prefix(FROM))
                .map(|branch| branch.trim().to_owned()),
            mine: !me.is_empty() && email.to_lowercase() == me,
            files: shelf_files(&git, base.as_deref(), id)?,
            base,
        });
    }
    found.sort_by_key(|shelf| std::cmp::Reverse(shelf.time));
    Ok(found)
}

/// The email git would author a commit with here (its environment, then its settings).
fn my_email(git: &Git) -> String {
    git.run(&["var", "GIT_AUTHOR_IDENT"])
        .ok()
        .and_then(|ident| {
            let (_, rest) = ident.split_once('<')?;
            let (email, _) = rest.split_once('>')?;
            Some(email.trim().to_lowercase())
        })
        .unwrap_or_default()
}

/// What a shelf changes, compared with the commit it was shelved on.
fn shelf_files(git: &Git, base: Option<&str>, id: &str) -> Result<Vec<ShelfFile>> {
    let mut args = vec!["diff-tree", "-r", "--no-commit-id", "--name-status", "-z"];
    match base {
        Some(base) => args.extend([base, id]),
        None => args.extend(["--root", id]),
    }
    let output = git.run(&args)?;
    let parts: Vec<&str> = output.split('\0').filter(|part| !part.is_empty()).collect();
    Ok(parts
        .chunks(2)
        .filter_map(|pair| match pair {
            [status, path] => Some(ShelfFile {
                path: (*path).to_owned(),
                change: match status.chars().next() {
                    Some('A') => "added",
                    Some('D') => "deleted",
                    _ => "modified",
                },
            }),
            _ => None,
        })
        .collect())
}

/// Shelve the working copy's versions of `paths` (every change, when empty) as
/// `description`, and push it for the team. Unless `keep`, they're then taken out of the
/// working copy (kept for a while, to undo).
pub(super) fn shelve(
    repo: &gix::Repository,
    git: &Git,
    paths: Vec<String>,
    description: String,
    keep: bool,
    on_progress: &dyn Fn(Progress),
    extra: &mut Extra,
) -> Result<String> {
    let description = description.trim();
    if description.is_empty() {
        return Err("Say what the shelf is for first.".into());
    }
    let paths: Vec<String> = if paths.is_empty() {
        Vec::new()
    } else {
        check_file_paths(&paths)?
            .into_iter()
            .map(str::to_owned)
            .collect()
    };
    let remote = remote_for(git, "HEAD").ok_or(
        "Shelves are shared through a remote, and this repository has none. Add one in the repository's settings.",
    )?;
    let branch = git
        .run(&["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .map(|branch| branch.trim().to_owned());
    let message = match &branch {
        Some(branch) => format!("{description}\n\n{FROM}{branch}\n"),
        None => format!("{description}\n"),
    };
    let Some(id) = snapshot_commit(git, repo.git_dir(), &paths, &message, &[])? else {
        return Err("There are no changes to shelve.".into());
    };
    let reference = format!("{SHELVES}{}-{}", who(git), now_millis());
    // Its Git LFS files first, then the shelf itself. Not through the repository's pre-push
    // hooks: they're about branches, and Git LFS's own has just been done.
    if git.run(&["lfs", "version"]).is_ok() {
        git.run_progress(&["lfs", "push", &remote, &id], on_progress)?;
    }
    git.run_progress(
        &[
            "push",
            "--progress",
            "--no-verify",
            &remote,
            &format!("{id}:{reference}"),
        ],
        on_progress,
    )?;
    git.run(&["update-ref", &reference, &id])?;
    let base = git
        .run(&["rev-parse", "--verify", "--quiet", &format!("{id}^")])
        .ok();
    let files = shelf_files(git, base.as_deref().map(str::trim), &id)
        .map(|files| files.len())
        .unwrap_or(paths.len());
    let shelved = format!("Shelved {} as “{description}”", count(files, "file"));
    if keep {
        return Ok(shelved);
    }
    let taken: Vec<String> = if paths.is_empty() {
        changed_paths(git)?
    } else {
        paths
    };
    discard_files(repo, git, taken, extra)?;
    Ok(format!("{shelved}, and took them out of your copy"))
}

/// Every changed file, untracked ones too.
fn changed_paths(git: &Git) -> Result<Vec<String>> {
    let status = git.run(&["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    let mut paths = Vec::new();
    let mut parts = status.split('\0');
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        paths.push(entry[3..].to_owned());
        // A rename's original name follows it.
        if (entry.starts_with('R') || entry.starts_with('C'))
            && let Some(from) = parts.next()
        {
            paths.push(from.to_owned());
        }
    }
    Ok(paths)
}

/// Who's shelving, for the shelf's ref: their name, as letters, digits and dashes.
fn who(git: &Git) -> String {
    let name = git.run(&["config", "user.name"]).unwrap_or_default();
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "someone".into()
    } else {
        slug
    }
}

/// Take a shelf's files into the working copy, as they were shelved. Files of yours it
/// would overwrite stop it, as they stop a checkout.
pub(super) fn open_shelf(
    repo: &gix::Repository,
    git: &Git,
    reference: String,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    if !reference.starts_with(SHELVES) {
        return Err(format!("{reference} isn't a shelf.").into());
    }
    let id = git
        .run(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{reference}^{{commit}}"),
        ])
        .map_err(|_| "That shelf isn't there any more.")?;
    let id = id.trim();
    let base = git
        .run(&["rev-parse", "--verify", "--quiet", &format!("{id}^")])
        .ok()
        .map(|base| base.trim().to_owned());
    let files = shelf_files(git, base.as_deref(), id)?;
    if files.is_empty() {
        return Err("That shelf has no changes.".into());
    }
    let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
    // Changes of yours to these files would be lost.
    let mut args = vec![
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
    ];
    args.extend(&paths);
    let status = git.run_with_env(&args, &LITERAL)?;
    let mine: Vec<&str> = status
        .split('\0')
        .filter(|entry| entry.len() > 3)
        .map(|entry| &entry[3..])
        .filter(|path| paths.contains(path))
        .collect();
    if !mine.is_empty() {
        return Err(format!(
            "Your local changes to the following files would be overwritten by opening the shelf:\n\t{}\n\
             Shelve, stash or commit them first.",
            mine.join("\n\t")
        )
        .into());
    }
    // Its Git LFS files, all together, before they're checked out.
    if let Some(base) = &base {
        prefetch(
            git,
            repo.common_dir(),
            &format!("{base}..{id}"),
            id,
            on_progress,
        )?;
    }
    let (gone, kept): (Vec<&ShelfFile>, Vec<&ShelfFile>) =
        files.iter().partition(|file| file.change == "deleted");
    if !kept.is_empty() {
        let mut args = vec!["restore", "--source", id, "--worktree", "--"];
        args.extend(kept.iter().map(|file| file.path.as_str()));
        git.run_with_env(&args, &LITERAL)?;
    }
    for file in gone {
        let _ = std::fs::remove_file(git.workdir().join(&file.path));
    }
    Ok(format!("Opened the shelf: {}", describe_files(&paths)))
}

/// Delete a shelf, on the remote and here.
pub(super) fn delete_shelf(git: &Git, reference: String) -> Result<String> {
    if !reference.starts_with(SHELVES) {
        return Err(format!("{reference} isn't a shelf.").into());
    }
    if let Some(remote) = remote_for(git, "HEAD") {
        match git.run(&[
            "push",
            "--quiet",
            "--no-verify",
            &remote,
            "--delete",
            &reference,
        ]) {
            // Someone deleted it there already.
            Err(error) if error.to_string().contains("remote ref does not exist") => {}
            result => {
                result?;
            }
        }
    }
    let _ = git.run(&["update-ref", "-d", &reference]);
    Ok("Deleted the shelf".into())
}
