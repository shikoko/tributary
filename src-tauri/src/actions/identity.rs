//! The name and email address commits are made with in one repository, when it should
//! differ from the usual one (a work repository on a personal computer, say).

use std::path::Path;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::git::Git;

/// Who commits are made as here, and where that comes from.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoIdentity {
    /// Set for this repository only (`git config --local`).
    pub local_name: Option<String>,
    pub local_email: Option<String>,
    /// The usual one, for every repository (`git config --global`).
    pub global_name: Option<String>,
    pub global_email: Option<String>,
}

/// The identities that apply to the repository at `path`.
pub fn repo_identity(path: &Path) -> Result<RepoIdentity, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    let read = |scope: &str, key: &str| {
        git.run(&["config", scope, "--get", key])
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    };
    Ok(RepoIdentity {
        local_name: read("--local", "user.name"),
        local_email: read("--local", "user.email"),
        global_name: read("--global", "user.name"),
        global_email: read("--global", "user.email"),
    })
}

/// Commit as `name` <`email`> in this repository; both empty go back to the usual identity.
pub(super) fn set_identity(git: &Git, name: String, email: String) -> Result<String> {
    let (name, email) = (name.trim(), email.trim());
    if name.is_empty() && email.is_empty() {
        for key in ["user.name", "user.email"] {
            // Exit code 5: it wasn't set, which is fine.
            if let Err(error) = git.run(&["config", "--local", "--unset", key])
                && git.run(&["config", "--local", "--get", key]).is_ok()
            {
                return Err(error);
            }
        }
        return Ok("Commits here use your usual name and email again".to_owned());
    }
    if name.is_empty() || email.is_empty() {
        return Err("Enter both a name and an email address.".into());
    }
    if name.contains(['\n', '\r', '<', '>']) {
        return Err("A name can't contain line breaks or angle brackets.".into());
    }
    if !email.contains('@') || email.contains(char::is_whitespace) || email.contains(['<', '>']) {
        return Err(format!("\"{email}\" doesn't look like an email address.").into());
    }
    git.run(&["config", "--local", "user.name", name])?;
    git.run(&["config", "--local", "user.email", email])?;
    Ok(format!("Commits here are made as {name} <{email}>"))
}
