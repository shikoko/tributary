//! Creating, deleting and pushing tags.

use gix::ObjectId;

use super::remote::default_remote;
use super::validate::{check_new_tag_name, commit_id, known_remote, require_tag};
use crate::error::Result;
use crate::git::{Git, Progress};

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
