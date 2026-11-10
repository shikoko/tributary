//! Where a repository stands, at a glance, for the recent repositories on the start
//! screen: its branch, how far it is from the branch it tracks, and uncommitted changes.

use std::path::Path;

use serde::Serialize;

use crate::git::Git;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    /// The folder is there and holds a repository.
    pub found: bool,
    /// The checked-out branch (None when HEAD is detached).
    pub branch: Option<String>,
    /// Like "origin/main".
    pub upstream: Option<String>,
    /// How far it's ahead of the upstream, and behind it, along each one's own line (a merged
    /// pull request counts once).
    pub ahead: u32,
    pub behind: u32,
    /// Files with changes not committed yet (new files included), and with conflicts.
    pub changes: u32,
    pub conflicts: u32,
}

/// The summary of the repository at `path` (`found` false when it isn't there any more).
pub fn summary(path: &Path) -> RepoSummary {
    if !path.exists() {
        return RepoSummary::default();
    }
    let Ok(git) = Git::find(path.to_owned()) else {
        return RepoSummary::default();
    };
    // Without optional locks: reading it shouldn't get in the way of git elsewhere.
    match git.in_background().run_with_env(
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=normal",
        ],
        &[("GIT_OPTIONAL_LOCKS", "0")],
    ) {
        Ok(status) => {
            let mut summary = read_status(&status);
            // Counted like the toolbar's: along each branch's own line, a merge once.
            if summary.ahead + summary.behind > 0
                && let Ok(counts) = git.in_background().run(&[
                    "rev-list",
                    "--count",
                    "--left-right",
                    "--first-parent",
                    "HEAD...@{upstream}",
                ])
                && let Some((ahead, behind)) = counts.trim().split_once('\t')
                && let (Ok(ahead), Ok(behind)) = (ahead.parse(), behind.parse())
            {
                summary.ahead = ahead;
                summary.behind = behind;
            }
            summary
        }
        Err(_) => RepoSummary::default(),
    }
}

/// `git status --porcelain=v2 --branch`, summed up.
fn read_status(status: &str) -> RepoSummary {
    let mut summary = RepoSummary {
        found: true,
        ..RepoSummary::default()
    };
    for line in status.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            summary.branch = (head != "(detached)").then(|| head.to_owned());
        } else if let Some(upstream) = line.strip_prefix("# branch.upstream ") {
            summary.upstream = Some(upstream.to_owned());
        } else if let Some(counts) = line.strip_prefix("# branch.ab ") {
            for count in counts.split_whitespace() {
                if let Some(ahead) = count.strip_prefix('+') {
                    summary.ahead = ahead.parse().unwrap_or(0);
                } else if let Some(behind) = count.strip_prefix('-') {
                    summary.behind = behind.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("u ") {
            summary.conflicts += 1;
            summary.changes += 1;
        } else if line.starts_with("1 ") || line.starts_with("2 ") || line.starts_with("? ") {
            summary.changes += 1;
        }
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_up_status() {
        let status = "\
# branch.oid 1234567890abcdef1234567890abcdef12345678
# branch.head feature/sync
# branch.upstream origin/feature/sync
# branch.ab +2 -5
1 .M N... 100644 100644 100644 abc abc src/app.ts
2 R. N... 100644 100644 100644 abc abc R100 new.ts\told.ts
u UU N... 100644 100644 100644 100644 a b c conflict.ts
? notes.txt
! ignored.log
";
        assert_eq!(
            read_status(status),
            RepoSummary {
                found: true,
                branch: Some("feature/sync".into()),
                upstream: Some("origin/feature/sync".into()),
                ahead: 2,
                behind: 5,
                changes: 4,
                conflicts: 1,
            }
        );
        let detached = read_status("# branch.oid abc\n# branch.head (detached)\n");
        assert_eq!((detached.branch, detached.found), (None, true));
    }
}
