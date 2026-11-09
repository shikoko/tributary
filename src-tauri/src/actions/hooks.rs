//! git hooks: scripts a repository runs before a commit or push (to lint, test, check the
//! message). When one stops a commit or push, git just fails with the script's output;
//! this says which hook it was, so the app can show its output plainly and offer to go
//! ahead without it (`--no-verify`).

use std::path::PathBuf;

use crate::error::Error;
use crate::git::Git;

/// What a hook failure's message starts with, for the app to recognise it.
pub const HOOK_FAILED: &str = "The ";
const STOPPED: &str = " hook stopped the ";

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
/// a message saying which, with what it printed. Other errors are as they were.
pub(super) fn explain(git: &Git, error: Error, push: bool) -> Error {
    let text = error.to_string();
    let (hooks, what): (&[&str], &str) = if push {
        // A push the remote refused isn't the hook's doing.
        if text.contains("[rejected]") || text.contains("[remote rejected]") {
            return error;
        }
        (&["pre-push"], "push")
    } else {
        (&["pre-commit", "commit-msg"], "commit")
    };
    let Some(hook) = hooks.iter().find(|hook| has_hook(git, hook)) else {
        return error;
    };
    let output = text
        .lines()
        .filter(|line| !line.starts_with("error: failed to push some refs"))
        .collect::<Vec<_>>()
        .join("\n");
    Error::Message(format!(
        "{HOOK_FAILED}{hook}{STOPPED}{what}.\n\n{}",
        output.trim()
    ))
}

#[cfg(test)]
mod tests {
    #[test]
    fn hook_failures_start_the_same_way() {
        let message = format!(
            "{}pre-commit{}commit.\n\nlint failed",
            super::HOOK_FAILED,
            super::STOPPED
        );
        assert!(message.starts_with("The pre-commit hook stopped the commit."));
    }
}
