//! git hooks: scripts a repository runs before a commit or push (to lint, test, check the
//! message). When one stops a commit or push, git just fails with the script's output;
//! this says which hook it was, so the app can show its output plainly and offer to go
//! ahead without it (`--no-verify`).

use std::path::PathBuf;

use crate::error::{Error, ErrorKind, Stopped};
use crate::git::Git;

/// The folder git runs hooks from: core.hooksPath (husky and the like set it), or .git/hooks.
fn hooks_folder(git: &Git) -> Option<PathBuf> {
    let configured = git
        .run(&["config", "--get", "core.hooksPath"])
        .ok()
        .map(|path| path.trim().to_owned())
        .filter(|path| !path.is_empty());
    let folder = match configured {
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(git.run(&["rev-parse", "--git-path", "hooks"]).ok()?.trim()),
    };
    Some(if folder.is_absolute() {
        folder
    } else {
        git.workdir().join(folder)
    })
}

/// Whether the repository has hook `name` that git would run.
fn has_hook(git: &Git, name: &str) -> bool {
    let Some(file) = hooks_folder(git).map(|folder| folder.join(name)) else {
        return false;
    };
    let Ok(metadata) = std::fs::metadata(&file) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        metadata.is_file()
    }
}

/// When `error` came from a commit (or `push`) that one of the repository's hooks stopped:
/// an [`ErrorKind::HookFailed`] saying which, with what it printed. Other errors are as
/// they were.
pub(super) fn explain(git: &Git, error: Error, push: bool) -> Error {
    let text = error.to_string();
    let (hooks, stopped): (&[&str], Stopped) = if push {
        // A push the remote refused isn't the hook's doing.
        if text.contains("[rejected]") || text.contains("[remote rejected]") {
            return error;
        }
        (&["pre-push"], Stopped::Push)
    } else {
        (&["pre-commit", "commit-msg"], Stopped::Commit)
    };
    let Some(hook) = hooks.iter().find(|hook| has_hook(git, hook)) else {
        return error;
    };
    let output = text
        .lines()
        .filter(|line| !line.starts_with("error: failed to push some refs"))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned();
    let what = match stopped {
        Stopped::Commit => "commit",
        Stopped::Push => "push",
    };
    let message = format!("The {hook} hook stopped the {what}.\n\n{output}");
    Error::known(
        ErrorKind::HookFailed {
            hook: (*hook).to_owned(),
            stopped,
            output,
        },
        message,
    )
}
