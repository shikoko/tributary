//! Tributary's settings in a git repository of your own: exported there as
//! `tributary-settings.json` (committed and pushed with your git, and your git's sign-in) and
//! imported from there, on any computer, with just the repository's link.
//!
//! The repository is cloned shallow and sparse into a temporary folder each time: only the
//! newest commit, and only the files at its top, so a repository with other things in it
//! costs little. The folder goes as soon as it's done.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{Error, Result};
use crate::git::Git;

/// The file the settings are in, at the repository's top.
pub const FILE: &str = "tributary-settings.json";

/// A clone in a temporary folder, removed when it's dropped.
struct Clone {
    dir: PathBuf,
    git: Git,
}

impl Drop for Clone {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn clone(url: &str) -> Result<Clone> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Give the repository's link first.".into());
    }
    if url.starts_with('-') {
        return Err("That isn't a repository's link.".into());
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_nanos())
        .unwrap_or_default();
    let dir =
        std::env::temp_dir().join(format!("tributary-settings-{}-{nanos}", std::process::id()));
    let target = dir.display().to_string();
    Git::find(std::env::temp_dir())?
        .run(&[
            "clone",
            "--depth",
            "1",
            "--filter=blob:none",
            "--sparse",
            "--quiet",
            "--",
            url,
            &target,
        ])
        .map_err(|e| Error::Message(format!("Couldn't get that repository: {}", plain(&e))))?;
    Ok(Clone {
        git: Git::find(dir.clone())?,
        dir,
    })
}

/// git's message, without its "fatal:" and the like.
fn plain(error: &Error) -> String {
    let text = error.to_string();
    let text = text.trim();
    text.strip_prefix("fatal: ")
        .or_else(|| text.strip_prefix("error: "))
        .unwrap_or(text)
        .to_owned()
}

/// Export the settings (`contents`, the JSON Tributary exports) to the repository at `url`:
/// commit them and push. `config` is git configuration for the commit, like an identity
/// (`user.name`); the app passes none, so your own is used.
pub fn export(url: &str, contents: &str, config: &[(&str, &str)]) -> Result<String> {
    let clone = clone(url)?;
    std::fs::write(clone.dir.join(FILE), contents)
        .map_err(|e| Error::Message(format!("Couldn't write the settings ({e}).")))?;
    clone.git.run(&["add", "--", FILE])?;
    let (unchanged, _) = clone.git.run_status(&["diff", "--cached", "--quiet"])?;
    if unchanged == Some(0) {
        return Ok("The repository has these settings already".into());
    }
    let settings: Vec<String> = config
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect();
    let mut args: Vec<&str> = settings
        .iter()
        .flat_map(|setting| ["-c", setting.as_str()])
        .collect();
    args.extend(["commit", "--quiet", "-m", "Tributary's settings"]);
    clone.git.run(&args).map_err(|e| {
        let text = e.to_string();
        if text.contains("Please tell me who you are") || text.contains("unable to auto-detect email") {
            Error::Message("Git doesn't know who you commit as yet. Set your name and email (git config --global user.name and user.email), then export again.".into())
        } else {
            Error::Message(format!("Couldn't commit the settings: {}", plain(&e)))
        }
    })?;
    clone
        .git
        .run(&["push", "--quiet", "origin", "HEAD"])
        .map_err(|e| Error::Message(format!("Couldn't push the settings: {}", plain(&e))))?;
    Ok("Exported your settings to the repository".into())
}

/// The settings exported to the repository at `url`.
pub fn import(url: &str) -> Result<String> {
    let clone = clone(url)?;
    std::fs::read_to_string(clone.dir.join(FILE)).map_err(|_| {
        Error::Message(format!(
            "That repository has no Tributary settings yet ({FILE}): export them there first."
        ))
    })
}
