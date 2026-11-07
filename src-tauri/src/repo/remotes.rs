//! Where remote branches point, and the commits that arrived on them.

use std::collections::HashMap;
use std::path::Path;

use gix::ObjectId;
use gix::bstr::ByteSlice;
use serde::Serialize;

use super::open;
use super::refs::upstream;
use crate::error::{Error, Result};

/// Where the remote branches point, and which one the checked-out branch tracks: enough
/// to tell, after a fetch, what's new.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteState {
    /// Like "origin/main" → its commit.
    pub tips: HashMap<String, String>,
    /// Like "origin/main".
    pub upstream: Option<String>,
    pub remotes: Vec<String>,
}

pub fn remote_state(path: &Path) -> Result<RemoteState, Error> {
    let repo = open(path)?;
    let mut tips = HashMap::new();
    if let Ok(references) = repo.references()
        && let Ok(remotes) = references.remote_branches()
    {
        for mut reference in remotes.flatten() {
            let name = reference.name().as_bstr().to_str_lossy().into_owned();
            let Some(short) = name.strip_prefix("refs/remotes/") else {
                continue;
            };
            if short.ends_with("/HEAD") {
                continue;
            }
            if let Ok(id) = reference.peel_to_id() {
                tips.insert(short.to_owned(), id.to_string());
            }
        }
    }
    let head_branch = repo.head_name().ok().flatten().and_then(|name| {
        name.as_bstr()
            .to_str()
            .ok()?
            .strip_prefix("refs/heads/")
            .map(str::to_owned)
    });
    Ok(RemoteState {
        tips,
        upstream: head_branch
            .as_deref()
            .and_then(|branch| upstream(&repo, branch))
            .map(|upstream| upstream.name),
        remotes: repo
            .remote_names()
            .iter()
            .map(|name| name.to_str_lossy().into_owned())
            .collect(),
    })
}

/// Commits that arrived on a branch.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCommits {
    pub count: usize,
    /// Who wrote them, most commits first.
    pub authors: Vec<String>,
}

/// The commits reachable from `to` but not from `from` (at most a thousand are counted).
pub fn commits_between(path: &Path, from: &str, to: &str) -> Result<NewCommits, Error> {
    let repo = open(path)?;
    let id = |hex: &str| {
        ObjectId::from_hex(hex.as_bytes()).map_err(|_| format!("Invalid commit id {hex}"))
    };
    let walk = repo
        .rev_walk([id(to)?])
        .with_hidden([id(from)?])
        .all()
        .map_err(|e| e.to_string())?;
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut count = 0;
    for info in walk.flatten().take(1000) {
        count += 1;
        if let Ok(commit) = info.object()
            && let Ok(author) = commit.author()
        {
            *counts
                .entry(author.name.to_str_lossy().trim().to_owned())
                .or_default() += 1;
        }
    }
    let mut authors: Vec<(String, usize)> = counts.into_iter().collect();
    authors.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    Ok(NewCommits {
        count,
        authors: authors.into_iter().map(|(name, _)| name).collect(),
    })
}
