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

/// The message new commits start from: git's `commit.template`, which a team can share (a
/// file in the repository, set up for everyone) or Tributary keeps for one repository.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTemplate {
    /// What the file says (None when there's no template, or it can't be read).
    pub text: Option<String>,
    /// The file, as configured.
    pub file: Option<String>,
    /// It's the one Tributary keeps for this repository (so it can be edited here).
    pub ours: bool,
}

/// Where Tributary keeps a repository's own template.
const OUR_TEMPLATE: &str = "tributary-commit-template.txt";

fn our_template(git: &Git) -> Option<std::path::PathBuf> {
    let dir = git.run(&["rev-parse", "--absolute-git-dir"]).ok()?;
    Some(Path::new(dir.trim()).join(OUR_TEMPLATE))
}

/// The commit message template that applies to the repository at `path`.
pub fn commit_template(path: &Path) -> Result<CommitTemplate, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder.clone())?.in_background();
    let Some(file) = git
        .run(&["config", "--path", "--get", "commit.template"])
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    else {
        return Ok(CommitTemplate::default());
    };
    // A relative path is the repository's own file.
    let full = if Path::new(&file).is_absolute() {
        std::path::PathBuf::from(&file)
    } else {
        folder.join(&file)
    };
    let ours = our_template(&git).is_some_and(|our| our == full);
    Ok(CommitTemplate {
        text: std::fs::read_to_string(&full).ok(),
        file: Some(file),
        ours,
    })
}

/// Start new commits' messages from `text` in this repository (empty: no template of its own).
pub(super) fn set_commit_template(git: &Git, text: String) -> Result<String> {
    let file = our_template(git).ok_or("Couldn't find the repository's .git folder")?;
    if text.trim().is_empty() {
        let configured = git
            .run(&["config", "--local", "--path", "--get", "commit.template"])
            .ok()
            .map(|value| value.trim().to_owned());
        if configured.is_some_and(|value| Path::new(&value) == file) {
            git.run(&["config", "--local", "--unset", "commit.template"])?;
        }
        let _ = std::fs::remove_file(&file);
        return Ok("New commits here start empty again".to_owned());
    }
    let mut text = text.replace("\r\n", "\n");
    if !text.ends_with('\n') {
        text.push('\n');
    }
    std::fs::write(&file, text).map_err(|e| format!("Couldn't save the template: {e}"))?;
    git.run(&[
        "config",
        "--local",
        "commit.template",
        &file.to_string_lossy(),
    ])?;
    Ok("New commits here start from the template".to_owned())
}
