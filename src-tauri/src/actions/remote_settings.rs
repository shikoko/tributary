//! A repository's remotes: adding one, renaming it, changing its address, removing it.

use std::path::Path;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::git::{Git, without_credentials};

/// A remote and where it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    /// Its address, without a password or token in it.
    pub url: String,
    /// The address pushes go to, when it's a different one.
    pub push_url: Option<String>,
    /// Its address has a password or token in it (left out above).
    pub has_credentials: bool,
}

/// The repository's remotes, in the order git lists them.
pub fn remotes(path: &Path) -> Result<Vec<RemoteInfo>, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    let names = git.run(&["remote"])?;
    Ok(names
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| {
            let url = git
                .run(&["remote", "get-url", name])
                .map(|url| url.trim().to_owned())
                .unwrap_or_default();
            let push = git
                .run(&["remote", "get-url", "--push", name])
                .map(|url| url.trim().to_owned())
                .unwrap_or_default();
            let safe = without_credentials(&url);
            let safe_push = without_credentials(&push);
            RemoteInfo {
                name: name.to_owned(),
                has_credentials: safe != url || safe_push != push,
                push_url: (!push.is_empty() && push != url).then_some(safe_push),
                url: safe,
            }
        })
        .collect())
}

/// A remote's name: something git takes as one (no spaces, slashes at the ends, …).
fn check_name(git: &Git, name: &str) -> Result<()> {
    if name.is_empty() {
        return Err("Give the remote a name, like upstream.".into());
    }
    let valid = !name.starts_with('-')
        && git
            .run(&["check-ref-format", &format!("refs/remotes/{name}/x")])
            .is_ok();
    if !valid {
        return Err(format!("\"{name}\" can't be a remote's name.").into());
    }
    Ok(())
}

fn check_url(url: &str) -> Result<()> {
    if url.is_empty() {
        return Err("Enter the remote's address.".into());
    }
    if url.starts_with('-') || url.contains(char::is_whitespace) {
        return Err(format!("\"{url}\" isn't a remote's address.").into());
    }
    Ok(())
}

fn exists(git: &Git, name: &str) -> bool {
    git.run(&["remote"])
        .map(|names| names.lines().any(|line| line.trim() == name))
        .unwrap_or(false)
}

pub(super) fn add_remote(git: &Git, name: String, url: String) -> Result<String> {
    let (name, url) = (name.trim(), url.trim());
    check_name(git, name)?;
    check_url(url)?;
    if exists(git, name) {
        return Err(format!("There's a remote called {name} already.").into());
    }
    git.run(&["remote", "add", "--", name, url])?;
    Ok(format!("Added the remote {name}"))
}

pub(super) fn rename_remote(git: &Git, from: String, to: String) -> Result<String> {
    let to = to.trim();
    if !exists(git, &from) {
        return Err(format!("There's no remote called {from}.").into());
    }
    check_name(git, to)?;
    if from == to {
        return Ok(format!("{to} keeps its name"));
    }
    if exists(git, to) {
        return Err(format!("There's a remote called {to} already.").into());
    }
    // Renames its remote branches, and the branches that track them follow.
    git.run(&["remote", "rename", &from, to])?;
    Ok(format!("Renamed the remote {from} to {to}"))
}

pub(super) fn remove_remote(git: &Git, name: String) -> Result<String> {
    if !exists(git, &name) {
        return Err(format!("There's no remote called {name}.").into());
    }
    // Its remote branches go too, and branches tracking them stop tracking anything.
    git.run(&["remote", "remove", &name])?;
    Ok(format!("Removed the remote {name}"))
}

/// Point a remote at `url`, or only its pushes (`push`). An empty push address pushes to
/// the fetch address again.
pub(super) fn set_remote_url(git: &Git, name: String, url: String, push: bool) -> Result<String> {
    let url = url.trim();
    if !exists(git, &name) {
        return Err(format!("There's no remote called {name}.").into());
    }
    if push && url.is_empty() {
        // Exit code 5: there was no push address, which is fine.
        let _ = git.run(&["config", "--unset-all", &format!("remote.{name}.pushurl")]);
        return Ok(format!("{name} pushes to the address it fetches from"));
    }
    check_url(url)?;
    if push {
        // `set-url --push` adds a push address when there's none, and replaces it otherwise.
        git.run(&["remote", "set-url", "--push", "--", &name, url])?;
        Ok(format!("{name} pushes to {}", without_credentials(url)))
    } else {
        git.run(&["remote", "set-url", "--", &name, url])?;
        Ok(format!("{name} is at {}", without_credentials(url)))
    }
}
