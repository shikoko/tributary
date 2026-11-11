//! Patch files: commits saved as a `.patch` (as `git format-patch` writes them, author and
//! message included), to send or keep without pushing, and applying one: as commits
//! (`git am`), or as changes to commit yourself (`git apply`).

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::support::count;
use crate::error::{Error, Result};
use crate::git::Git;

/// What a patch file holds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PatchInfo {
    /// Its commits' summaries and authors, when it's commits (as `git format-patch` writes).
    pub commits: Vec<PatchCommit>,
    /// The files it changes, with lines added and removed (None for binary files).
    pub files: Vec<PatchFile>,
    /// It applies to the files as they are now, without conflicts.
    pub applies: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PatchCommit {
    pub summary: String,
    pub author: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PatchFile {
    pub path: String,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
}

/// The commits in a patch file written by `git format-patch` (or sent by email): each one's
/// subject (without "[PATCH 2/3]") and author.
fn commits_in(text: &str) -> Vec<PatchCommit> {
    let mut commits = Vec::new();
    let mut author = String::new();
    let mut lines = text.lines().peekable();
    while let Some(line) = lines.next() {
        if let Some(from) = line.strip_prefix("From: ") {
            // "Name <email>": the name.
            author = from
                .split(" <")
                .next()
                .unwrap_or(from)
                .trim()
                .trim_matches('"')
                .to_owned();
        } else if let Some(subject) = line.strip_prefix("Subject: ") {
            let mut subject = subject.to_owned();
            // Long subjects go on over indented lines.
            while lines
                .peek()
                .is_some_and(|next| next.starts_with(' ') || next.starts_with('\t'))
            {
                subject.push(' ');
                subject.push_str(lines.next().unwrap_or_default().trim());
            }
            let subject = match subject.strip_prefix('[') {
                Some(rest) if rest.to_ascii_uppercase().starts_with("PATCH") => rest
                    .split_once(']')
                    .map_or(subject.as_str(), |(_, after)| after)
                    .trim()
                    .to_owned(),
                _ => subject.trim().to_owned(),
            };
            commits.push(PatchCommit {
                summary: subject,
                author: std::mem::take(&mut author),
            });
        }
    }
    commits
}

/// "3\t1\tsrc/a.rs" lines from `git apply --numstat`; "-" for binary files. A file
/// changed by several commits is listed once, with their lines added up.
fn numstat(text: &str) -> Vec<PatchFile> {
    let mut files: Vec<PatchFile> = Vec::new();
    for line in text.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let additions: Option<u64> = added.parse().ok();
        let deletions: Option<u64> = removed.parse().ok();
        match files.iter_mut().find(|file| file.path == path) {
            Some(file) => {
                file.additions = file.additions.zip(additions).map(|(a, b)| a + b);
                file.deletions = file.deletions.zip(deletions).map(|(a, b)| a + b);
            }
            None => files.push(PatchFile {
                path: path.to_owned(),
                additions,
                deletions,
            }),
        }
    }
    files
}

fn read_patch(file: &Path) -> Result<String> {
    let bytes =
        std::fs::read(file).map_err(|e| format!("Couldn't read {}: {e}", file.display()))?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("That patch is too big to apply here.".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// What `file` holds, and whether it applies to the repository's files as they are.
pub fn patch_info(path: &Path, file: &Path) -> Result<PatchInfo> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree.")?
        .to_owned();
    let git = Git::find(workdir)?.in_background();
    let text = read_patch(file)?;
    let file_arg = file.to_string_lossy();
    let files = git
        .run(&["apply", "--numstat", "--", &file_arg])
        .map(|output| numstat(&output))
        .map_err(|_| Error::from(format!("{} isn't a patch git can read.", file.display())))?;
    if files.is_empty() {
        return Err(format!("{} doesn't change any files.", file.display()).into());
    }
    let applies = git.run(&["apply", "--check", "--", &file_arg]).is_ok();
    Ok(PatchInfo {
        commits: commits_in(&text),
        files,
        applies,
    })
}

/// The commits `ids` as one patch, oldest first (merge commits are left out: a patch can't
/// hold one).
pub fn patch_text(path: &Path, ids: &[String]) -> Result<String> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    if ids.is_empty()
        || ids
            .iter()
            .any(|id| !id.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err("Choose the commits to save first.".into());
    }
    // Oldest first: by the commits' order in the history.
    let mut args = vec![
        "rev-list",
        "--no-walk=sorted",
        "--reverse",
        "--topo-order",
        "--no-merges",
    ];
    args.extend(ids.iter().map(String::as_str));
    let ordered = git.run(&args)?;
    let ordered: Vec<&str> = ordered
        .lines()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .collect();
    if ordered.is_empty() {
        return Err("Merge commits can't be saved as a patch.".into());
    }
    let total = ordered.len().to_string();
    let mut text = String::new();
    for (index, id) in ordered.iter().enumerate() {
        let number = (index + 1).to_string();
        let mut args = vec![
            "format-patch",
            "--stdout",
            "-1",
            "--binary",
            "--no-signature",
        ];
        let subject;
        if ordered.len() > 1 {
            // "[PATCH 2/3]", as when they're written together.
            subject = format!("--subject-prefix=PATCH {number}/{total}");
            args.push(&subject);
        }
        args.push(id);
        text.push_str(&git.run(&args)?);
    }
    Ok(text)
}

/// Save the commits `ids` as one patch file at `file`.
pub(super) fn save_patch(path: &Path, ids: Vec<String>, file: String) -> Result<String> {
    let text = patch_text(path, &ids)?;
    let target = Path::new(&file);
    std::fs::write(target, &text).map_err(|e| format!("Couldn't save {file}: {e}"))?;
    let commits = text
        .lines()
        .filter(|line| line.starts_with("Subject: "))
        .count();
    Ok(format!(
        "Saved {} as {}",
        count(commits.max(1), "commit"),
        name_of(target)
    ))
}

/// A patch file's own name, without its folders. It's a path on this computer, like
/// `C:\Users\maya\Desktop\fix.patch`, not one in the repository: on Windows its folders
/// are split by backslashes.
fn name_of(file: &Path) -> String {
    file.file_name().map_or_else(
        || file.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

/// Apply the patch in `file`: as commits (`git am`, keeping each one's author and message),
/// or as changes to the files, staged where they apply cleanly (`git apply`). Where it
/// conflicts, git stops for the conflicts to be resolved.
pub(super) fn apply_patch(git: &Git, file: String, as_commits: bool) -> Result<String> {
    let path = Path::new(&file);
    if !path.is_file() {
        return Err(format!("There's no {file}.").into());
    }
    let name = name_of(path);
    if as_commits {
        let text = read_patch(path)?;
        let commits = commits_in(&text).len();
        if commits == 0 {
            return Err(format!(
                "{name} has no commits in it (no author or message): apply its changes instead."
            )
            .into());
        }
        git.run(&["am", "--3way", "--", &file]).map_err(|error| {
            let stopped = git
                .run(&["rev-parse", "--git-path", "rebase-apply"])
                .is_ok_and(|folder| git.workdir().join(folder.trim()).is_dir());
            if stopped {
                Error::from(format!(
                    "{name} conflicts with your files: resolve the conflicts, then continue (or abort to go back)."
                ))
            } else {
                error
            }
        })?;
        Ok(format!("Applied {} from {name}", count(commits, "commit")))
    } else {
        git.run(&["apply", "--3way", "--", &file])
            .map_err(|error| {
                let text = error.to_string();
                if text.contains("with conflicts") || text.contains("U ") {
                    Error::from(format!("Applied {name}, with conflicts to resolve."))
                } else {
                    error
                }
            })?;
        Ok(format!(
            "Applied the changes in {name}: commit them when they're ready"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_commits_and_files() {
        let text = "From 1234 Mon Sep 17 00:00:00 2001\nFrom: \"Rosa Bell\" <rosa@example.com>\nDate: x\nSubject: [PATCH 1/2] Barber: a longer\n beard\n\nbody\n---\nFrom abcd Mon\nFrom: Theo Park <theo@example.com>\nSubject: Door creak\n";
        assert_eq!(
            commits_in(text),
            vec![
                PatchCommit {
                    summary: "Barber: a longer beard".into(),
                    author: "Rosa Bell".into()
                },
                PatchCommit {
                    summary: "Door creak".into(),
                    author: "Theo Park".into()
                },
            ]
        );
        assert_eq!(
            numstat("3\t1\tsrc/a.rs\n-\t-\tlogo.png\n2\t2\tsrc/a.rs\n"),
            vec![
                PatchFile {
                    path: "src/a.rs".into(),
                    additions: Some(5),
                    deletions: Some(3)
                },
                PatchFile {
                    path: "logo.png".into(),
                    additions: None,
                    deletions: None
                },
            ]
        );
    }
}
