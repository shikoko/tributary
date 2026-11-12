//! A merge, rebase, cherry-pick or revert that stopped, and what its two sides are called.

use gix::ObjectId;
use gix::bstr::ByteSlice;
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub kind: OperationKind,
    /// The commit message git prepared, for a merge, cherry-pick or revert.
    pub message: Option<String>,
    /// For a rebase: the branch being rebased (HEAD is detached while it runs).
    pub branch: Option<String>,
    /// What the two sides of a conflict are called: yours (the checked-out branch, or
    /// the branch being rebased) and theirs (what's being merged, picked, reverted or
    /// rebased onto), like "main" and "feat/x" or "commit a1b2c3d".
    pub mine: Option<String>,
    pub theirs: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum OperationKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    /// Applying patches as commits (`git am`).
    ApplyPatches,
    /// Something else.
    Other,
}

/// A merge, rebase, cherry-pick or revert that is waiting to be continued or aborted.
pub(crate) fn operation(repo: &gix::Repository) -> Option<Operation> {
    use gix::state::InProgress;
    let kind = match repo.state()? {
        // A bisect isn't stuck on anything: it has its own bar (see bisect.rs).
        InProgress::Bisect => return None,
        InProgress::Merge => OperationKind::Merge,
        InProgress::Rebase | InProgress::RebaseInteractive | InProgress::ApplyMailboxRebase => {
            OperationKind::Rebase
        }
        InProgress::CherryPick | InProgress::CherryPickSequence => OperationKind::CherryPick,
        InProgress::Revert | InProgress::RevertSequence => OperationKind::Revert,
        InProgress::ApplyMailbox => OperationKind::ApplyPatches,
    };
    // The message git prepared, without its "# Conflicts:" comment lines.
    let message = std::fs::read_to_string(repo.git_dir().join("MERGE_MSG"))
        .ok()
        .map(|text| {
            text.lines()
                .filter(|line| !line.starts_with('#'))
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_owned()
        })
        .filter(|message| !message.is_empty());
    let branch = (kind == OperationKind::Rebase)
        .then(|| {
            ["rebase-merge/head-name", "rebase-apply/head-name"]
                .iter()
                .find_map(|file| std::fs::read_to_string(repo.git_dir().join(file)).ok())
        })
        .flatten()
        .map(|name| name.trim().trim_start_matches("refs/heads/").to_owned())
        .filter(|name| !name.is_empty() && name != "detached HEAD");
    let head_branch = || {
        repo.head_name().ok().flatten().and_then(|name| {
            name.as_bstr()
                .to_str()
                .ok()?
                .strip_prefix("refs/heads/")
                .map(str::to_owned)
        })
    };
    let read_id = |file: &str| {
        std::fs::read_to_string(repo.git_dir().join(file))
            .ok()
            .and_then(|text| ObjectId::from_hex(text.trim().as_bytes()).ok())
    };
    let short = |id: ObjectId| format!("commit {}", id.to_hex_with_len(7));
    let (mine, theirs) = match kind {
        OperationKind::Merge => (
            head_branch(),
            read_id("MERGE_HEAD").map(|id| name_at(repo, id).unwrap_or_else(|| short(id))),
        ),
        OperationKind::Rebase => (
            branch.clone(),
            ["rebase-merge/onto", "rebase-apply/onto"]
                .iter()
                .find_map(|file| read_id(file))
                .map(|id| name_at(repo, id).unwrap_or_else(|| short(id))),
        ),
        OperationKind::CherryPick => (head_branch(), read_id("CHERRY_PICK_HEAD").map(short)),
        OperationKind::Revert => (
            head_branch(),
            read_id("REVERT_HEAD").map(|id| format!("the revert of {}", id.to_hex_with_len(7))),
        ),
        OperationKind::ApplyPatches => (
            head_branch(),
            // The patch it stopped at, by its subject.
            [
                "rebase-apply/msg-clean",
                "rebase-apply/msg",
                "rebase-apply/final-commit",
            ]
            .iter()
            .find_map(|file| std::fs::read_to_string(repo.git_dir().join(file)).ok())
            .and_then(|text| {
                text.lines()
                    .map(str::trim)
                    .find(|line| !line.is_empty())
                    .map(str::to_owned)
            })
            .map(|subject| format!("the patch \"{subject}\""))
            .or_else(|| Some("the patch".to_owned())),
        ),
        OperationKind::Other => (None, None),
    };
    Some(Operation {
        kind,
        message,
        branch,
        mine,
        theirs,
    })
}

/// A branch (or else remote branch, or tag) pointing at `id`, by its short name.
pub(super) fn name_at(repo: &gix::Repository, id: ObjectId) -> Option<String> {
    let references = repo.references().ok()?;
    let mut found: Vec<(usize, String)> = Vec::new();
    for reference in references.all().ok()?.flatten() {
        let name = reference.name().as_bstr().to_str_lossy().into_owned();
        let rank = ["refs/heads/", "refs/remotes/", "refs/tags/"]
            .iter()
            .position(|prefix| name.starts_with(prefix));
        let Some(rank) = rank else { continue };
        if name.ends_with("/HEAD") {
            continue;
        }
        let mut reference = reference;
        if reference.peel_to_id().ok().map(|peeled| peeled.detach()) == Some(id) {
            let short = name.splitn(3, '/').nth(2).unwrap_or(&name).to_owned();
            found.push((rank, short));
        }
    }
    found.sort();
    found.into_iter().next().map(|(_, name)| name)
}
