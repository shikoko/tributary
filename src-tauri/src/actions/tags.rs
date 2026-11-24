//! Creating, deleting and pushing tags.

use std::collections::HashMap;
use std::path::Path;

use gix::ObjectId;
use serde::Serialize;
use ts_rs::TS;

use super::remote::default_remote;
use super::validate::{check_new_tag_name, commit_id, known_remote, require_tag};
use crate::error::{Error, Result};
use crate::git::{Git, Progress};

/// A tag the remote doesn't have yet (see [`tags_to_push`]).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TagToPush {
    pub name: String,
    /// The commit it's on.
    pub id: String,
    /// That commit's summary.
    pub summary: String,
    /// When the tag was made (for a tag without a message, its commit's date), in seconds.
    pub time: i64,
    /// One of the remote's branches with the tag's commit, like `origin/main` (its main branch
    /// when that has it), when the remote has the commit: usually a release. `None` when the
    /// commit is only here, like an experiment's.
    pub on_remote: Option<String>,
}

/// The tags here that a remote doesn't have (see [`tags_to_push`]).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TagsToPush {
    pub remote: String,
    /// Newest first.
    pub tags: Vec<TagToPush>,
    /// Tags the remote has under the same name on another commit: pushing them would be
    /// refused, so they aren't offered.
    pub different: Vec<String>,
}

/// The tags here that `remote` (the default remote when none is given) doesn't have, as it
/// says now: asked over the network, as tags aren't kept per remote the way branches are.
pub fn tags_to_push(path: &Path, remote: Option<String>) -> Result<TagsToPush> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo.workdir().unwrap_or(repo.git_dir()).to_owned();
    let git = Git::find(workdir)?;
    let remote = match remote {
        Some(remote) => known_remote(&repo, &remote)?,
        None => default_remote(&repo)?,
    };

    // The remote's tags: name to what it points at (a tag object, or a commit).
    let listed = git.run(&["ls-remote", "--tags", "--refs", "--", &remote])?;
    let theirs: HashMap<&str, &str> = listed
        .lines()
        .filter_map(|line| {
            let (id, name) = line.split_once('\t')?;
            Some((name.strip_prefix("refs/tags/")?, id))
        })
        .collect();

    // Ours, with the commit each is on and that commit's summary.
    let ours = git.run(&[
        "for-each-ref",
        "refs/tags",
        "--format=%(refname:strip=2)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(subject)%00%(*subject)%00%(creatordate:unix)",
    ])?;
    let mut tags = Vec::new();
    let mut different = Vec::new();
    for line in ours.lines() {
        let fields: Vec<&str> = line.split('\0').collect();
        let [
            name,
            id,
            kind,
            target,
            target_kind,
            subject,
            target_subject,
            time,
        ] = fields[..]
        else {
            continue;
        };
        match theirs.get(name) {
            Some(&there) if there == id => continue,
            Some(_) => {
                different.push(name.to_owned());
                continue;
            }
            None => {}
        }
        // On a commit, directly or through the tag's message. (A tag on a file or a folder
        // can be pushed too, but isn't a version of anything to offer here.)
        let (commit, summary) = match (kind, target_kind) {
            ("commit", _) => (id, subject),
            ("tag", "commit") => (target, target_subject),
            _ => continue,
        };
        tags.push(TagToPush {
            name: name.to_owned(),
            id: commit.to_owned(),
            summary: summary.to_owned(),
            time: time.parse().unwrap_or(0),
            on_remote: None,
        });
    }

    // Which of them the remote has the commit of: from its branches as last fetched, its
    // main branch first. One look per branch, not per tag (an old project can have hundreds).
    if !tags.is_empty() {
        let main = git
            .run(&[
                "symbolic-ref",
                "--quiet",
                &format!("refs/remotes/{remote}/HEAD"),
            ])
            .ok()
            .map(|target| target.trim().trim_start_matches("refs/remotes/").to_owned());
        let mut branches: Vec<String> = git
            .run(&[
                "for-each-ref",
                &format!("refs/remotes/{remote}/"),
                "--format=%(refname:strip=2)",
            ])?
            .lines()
            .filter(|name| *name != format!("{remote}/HEAD"))
            .map(str::to_owned)
            .collect();
        // The remote's main branch first: as it says, or else main or master.
        let rank = |name: &String| {
            if Some(name) == main.as_ref() {
                0
            } else if *name == format!("{remote}/main") || *name == format!("{remote}/master") {
                1
            } else {
                2
            }
        };
        branches.sort_by_key(rank);
        for branch in branches {
            if tags.iter().all(|tag| tag.on_remote.is_some()) {
                break;
            }
            let merged = git.run(&[
                "for-each-ref",
                "refs/tags",
                "--format=%(refname:strip=2)",
                &format!("--merged=refs/remotes/{branch}"),
            ])?;
            let merged: Vec<&str> = merged.lines().collect();
            for tag in tags.iter_mut().filter(|tag| tag.on_remote.is_none()) {
                if merged.contains(&tag.name.as_str()) {
                    tag.on_remote = Some(branch.clone());
                }
            }
        }
    }
    tags.sort_by(|a, b| b.time.cmp(&a.time).then_with(|| a.name.cmp(&b.name)));
    different.sort();
    Ok(TagsToPush {
        remote,
        tags,
        different,
    })
}

/// "v1.2", "v1.2 and v1.3" or "3 tags".
fn some_tags(names: &[String]) -> String {
    match names {
        [one] => format!("tag {one}"),
        [one, two] => format!("tags {one} and {two}"),
        _ => format!("{} tags", names.len()),
    }
}

/// Push the tags `names` to `remote`, in one push.
pub(super) fn push_tags(
    repo: &gix::Repository,
    git: &Git,
    names: Vec<String>,
    remote: String,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    if names.is_empty() {
        return Err("Choose a tag to push.".into());
    }
    for name in &names {
        require_tag(repo, name)?;
    }
    let remote = known_remote(repo, &remote)?;
    let refspecs: Vec<String> = names
        .iter()
        .map(|name| format!("refs/tags/{name}:refs/tags/{name}"))
        .collect();
    let mut args = vec!["push", "--progress", remote.as_str()];
    args.extend(refspecs.iter().map(String::as_str));
    git.run_progress(&args, on_progress)?;
    Ok(format!("Pushed {} to {remote}", some_tags(&names)))
}

/// Create a tag on a commit: annotated when there is a message, lightweight otherwise.
pub(super) fn create_tag(
    repo: &gix::Repository,
    git: &Git,
    name: String,
    id: String,
    message: Option<String>,
) -> Result<String> {
    let name = name.trim().to_owned();
    check_new_tag_name(repo, git, &name)?;
    let id = commit_id(repo, &id)?.to_string();
    let message = message
        .map(|m| m.trim().to_owned())
        .filter(|m| !m.is_empty());
    match &message {
        Some(message) => git.run(&["tag", "--annotate", "--message", message, &name, &id])?,
        None => git.run(&["tag", &name, &id])?,
    };
    Ok(format!("Created tag {name}"))
}

/// Delete a local tag.
pub(super) fn delete_tag(repo: &gix::Repository, git: &Git, name: String) -> Result<String> {
    require_tag(repo, &name)?;
    git.run(&["tag", "--delete", &name])?;
    Ok(format!("Deleted tag {name}"))
}

/// Put back a deleted tag, pointing at a commit or tag object `id`.
pub(super) fn restore_tag(
    repo: &gix::Repository,
    git: &Git,
    name: String,
    id: String,
) -> Result<String> {
    check_new_tag_name(repo, git, &name)?;
    let oid = ObjectId::from_hex(id.as_bytes()).map_err(|_| format!("Invalid id {id}"))?;
    repo.find_object(oid)
        .map_err(|e| format!("Could not find {id}: {e}"))?;
    git.run(&["tag", &name, &oid.to_string()])?;
    Ok(format!("Restored tag {name}"))
}

/// Push a tag to a remote (the default remote when none is given).
pub(super) fn push_tag(
    repo: &gix::Repository,
    git: &Git,
    name: String,
    remote: Option<String>,
    on_progress: &dyn Fn(Progress),
) -> Result<String> {
    require_tag(repo, &name)?;
    let remote = match remote {
        Some(remote) => known_remote(repo, &remote)?,
        None => default_remote(repo)?,
    };
    let refspec = format!("refs/tags/{name}:refs/tags/{name}");
    git.run_progress(&["push", "--progress", &remote, &refspec], on_progress)?;
    Ok(format!("Pushed tag {name} to {remote}"))
}

/// Delete a tag from a remote.
pub(super) fn delete_remote_tag(
    repo: &gix::Repository,
    git: &Git,
    name: String,
    remote: String,
) -> Result<String> {
    let remote = known_remote(repo, &remote)?;
    if name.starts_with('-')
        || git
            .run(&["check-ref-format", &format!("refs/tags/{name}")])
            .is_err()
    {
        return Err(format!("There's no tag called {name}.").into());
    }
    git.run(&[
        "push",
        "--quiet",
        &remote,
        "--delete",
        &format!("refs/tags/{name}"),
    ])?;
    Ok(format!("Deleted tag {name} from {remote}"))
}
