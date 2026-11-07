//! The error type for everything Tributary does with a repository.
//!
//! Every message is worded for the person using the app: the frontend shows them as they
//! are, so they say what happened and, where possible, what to do about it.

use serde::{Serialize, Serializer};

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
}

impl Error {
    /// The repository at `path` couldn't be opened.
    pub fn not_a_repository(path: &std::path::Path, reason: impl std::fmt::Display) -> Self {
        Error::NotARepository {
            path: path.display().to_string(),
            reason: reason.to_string(),
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

/// Errors reach the frontend as their message.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
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
        assert_eq!(
            serde_json::to_string(&Error::Cancelled).unwrap(),
            "\"Cancelled.\""
        );
        assert_eq!(Error::from("Nope.").to_string(), "Nope.");
    }
}
