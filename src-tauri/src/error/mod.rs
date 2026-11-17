//! The error type for everything Tributary does with a repository.
//!
//! Every message is worded for the person using the app: the frontend shows them as they
//! are, so they say what happened and, where possible, what to do about it. Beside its
//! message, an error says what kind of failure it is when the app knows ([`ErrorKind`]), so
//! the frontend can explain it and offer the fix without reading the message.

mod kind;

use serde::{Serialize, Serializer};
use ts_rs::TS;

pub use kind::{ErrorKind, Stopped, classify};

/// What went wrong.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The folder isn't a git repository (or inside one).
    #[error("{path} is not a git repository ({reason})")]
    NotARepository { path: String, reason: String },
    /// git itself isn't installed, or can't be found.
    #[error(
        "This needs git, which wasn't found. Install it from https://git-scm.com and try again."
    )]
    GitNotFound,
    /// A git command failed: what git said, tidied up.
    #[error("{0}")]
    Git(String),
    /// A fetch, pull, push or clone was stopped.
    #[error("Cancelled.")]
    Cancelled,
    /// Anything else, already worded for the user: a name that isn't valid, a commit that
    /// doesn't exist, a file that can't be written, …
    #[error("{0}")]
    Message(String),
    /// A failure the app knows the kind of, made where it happened, with its message.
    #[error("{message}")]
    Known { kind: ErrorKind, message: String },
}

impl Error {
    /// The repository at `path` couldn't be opened.
    pub fn not_a_repository(path: &std::path::Path, reason: impl std::fmt::Display) -> Self {
        Error::NotARepository {
            path: path.display().to_string(),
            reason: reason.to_string(),
        }
    }

    /// A failure of kind `kind`, saying `message`.
    pub fn known(kind: ErrorKind, message: impl Into<String>) -> Self {
        Error::Known {
            kind,
            message: message.into(),
        }
    }

    /// What kind of failure this is, when the app knows: said where it was made, or else
    /// recognised from what git said.
    pub fn kind(&self) -> Option<ErrorKind> {
        match self {
            Error::Known { kind, .. } => Some(kind.clone()),
            Error::Cancelled => Some(ErrorKind::Cancelled),
            Error::Git(message) | Error::Message(message) => classify(message),
            Error::NotARepository { .. } | Error::GitNotFound => None,
        }
    }
}

impl From<String> for Error {
    fn from(message: String) -> Self {
        Error::Message(message)
    }
}

impl From<&str> for Error {
    fn from(message: &str) -> Self {
        Error::Message(message.to_owned())
    }
}

/// How an error reaches the frontend: its message, and its kind when that's known.
#[derive(Debug, Clone, Serialize, TS)]
pub struct Failure {
    pub message: String,
    pub kind: Option<ErrorKind>,
}

impl From<&Error> for Failure {
    fn from(error: &Error) -> Self {
        Failure {
            message: error.to_string(),
            kind: error.kind(),
        }
    }
}

/// Errors reach the frontend as a [`Failure`].
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        Failure::from(self).serialize(serializer)
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_as_its_message() {
        let error = Error::not_a_repository(std::path::Path::new("/tmp/x"), "no .git");
        assert_eq!(
            error.to_string(),
            "/tmp/x is not a git repository (no .git)"
        );
        assert_eq!(Error::from("Nope.").to_string(), "Nope.");
    }

    #[test]
    fn reaches_the_frontend_with_its_kind() {
        assert_eq!(
            serde_json::to_value(Error::Cancelled).unwrap(),
            serde_json::json!({ "message": "Cancelled.", "kind": { "kind": "cancelled" } })
        );
        let rejected = Error::Git(" ! [rejected]        main -> main (fetch first)".into());
        assert_eq!(
            serde_json::to_value(&rejected).unwrap()["kind"],
            serde_json::json!({ "kind": "pushRejected", "branch": "main" })
        );
        let hook = Error::known(
            ErrorKind::HookFailed {
                hook: "pre-commit".into(),
                stopped: Stopped::Commit,
                output: "lint failed".into(),
            },
            "The pre-commit hook stopped the commit.",
        );
        assert_eq!(hook.to_string(), "The pre-commit hook stopped the commit.");
        assert_eq!(
            serde_json::to_value(&hook).unwrap()["kind"],
            serde_json::json!({ "kind": "hookFailed", "hook": "pre-commit", "stopped": "commit", "output": "lint failed" })
        );
        assert_eq!(
            serde_json::to_value(Error::from("Nope.")).unwrap(),
            serde_json::json!({ "message": "Nope.", "kind": null })
        );
    }
}
