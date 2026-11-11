//! HEAD's reflog: everything that moved HEAD, to get back commits that are on no branch.

use std::path::Path;

use gix::bstr::ByteSlice;
use serde::Serialize;
use ts_rs::TS;

use super::open;
use crate::error::{Error, Result};

/// One entry of HEAD's reflog: something that moved HEAD (a commit, checkout, reset, …).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    /// Where HEAD went.
    pub id: String,
    /// Where it was before (empty for the first entry).
    pub previous: Option<String>,
    /// What happened, as git wrote it, like "reset: moving to HEAD~2".
    pub message: String,
    /// When, in seconds since the Unix epoch.
    pub time: i64,
    /// The summary of the commit it went to.
    pub summary: String,
    pub author_name: String,
}

/// The most recent `limit` entries of HEAD's reflog, newest first: git's record of
/// everything that moved HEAD, which can bring back commits that are on no branch.
pub fn reflog(path: &Path, limit: usize) -> Result<Vec<ReflogEntry>, Error> {
    let repo = open(path)?;
    let reference = repo
        .find_reference("HEAD")
        .map_err(|e| format!("Couldn't read HEAD ({e})"))?;
    let mut log = reference.log_iter();
    let Ok(Some(lines)) = log.rev() else {
        return Ok(Vec::new());
    };
    let mut entries = Vec::new();
    for line in lines.flatten().take(limit) {
        if line.new_oid.is_null() {
            continue;
        }
        let (summary, author_name) = repo
            .find_commit(line.new_oid)
            .ok()
            .map(|commit| {
                let summary = commit
                    .message()
                    .map(|m| m.summary().to_str_lossy().into_owned())
                    .unwrap_or_default();
                let author = commit
                    .author()
                    .map(|a| a.name.to_str_lossy().trim().to_owned())
                    .unwrap_or_default();
                (summary, author)
            })
            .unwrap_or_default();
        entries.push(ReflogEntry {
            id: line.new_oid.to_string(),
            previous: (!line.previous_oid.is_null()).then(|| line.previous_oid.to_string()),
            message: line.message.to_str_lossy().trim().to_owned(),
            time: line.signature.time.seconds,
            summary,
            author_name,
        });
    }
    Ok(entries)
}
