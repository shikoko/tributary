//! What kind of failure an error is, when the app knows it: the frontend explains it in
//! plain words and offers what fixes it from this, never from the message's wording.
//!
//! The app's own failures say their kind where they're made ([`super::Error::known`]).
//! git's are recognised here, by what git says: git runs in English
//! (`crate::git::command`), so its messages are the same on every computer.

use serde::Serialize;
use ts_rs::TS;

/// Which of a commit and a push a hook stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Stopped {
    Commit,
    Push,
}

/// A failure the app knows, with what it needs to explain it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ErrorKind {
    /// The person stopped it.
    Cancelled,
    /// A sync stopped before pulling: the branch was amended or rebased after it was pushed,
    /// so pulling would bring back the old versions of its commits. It needs a force push.
    Rewritten,
    /// There didn't seem to be room on the disk for the Git LFS files it downloads.
    NotEnoughSpace,
    /// One of the repository's hooks stopped a commit or push: which, and what it printed.
    HookFailed {
        hook: String,
        stopped: Stopped,
        output: String,
    },
    /// The remote refused a push: its `branch` has commits this one doesn't.
    PushRejected { branch: String },
    /// A force push stopped: the remote's `branch` has commits that haven't been fetched.
    StaleLease { branch: String },
    /// The branch's remote branch, `branch` on the remote, isn't there any more: it was
    /// renamed or deleted.
    UpstreamGone { branch: String },
    /// git only fast-forwards (`pull.ff = only`), and both sides have new commits.
    NotFastForward,
    /// A file (`file`, when git named it) is bigger than the host takes.
    TooLarge {
        file: Option<String>,
        host: Option<String>,
    },
    /// The branch is protected on the host: changes go in through a pull request.
    Protected { host: Option<String> },
    /// git couldn't sign in to the host.
    SignIn { host: Option<String> },
    /// The host has no such repository, or not one this account can see.
    RepositoryNotFound { host: Option<String> },
    /// The host couldn't be reached.
    Unreachable { host: Option<String> },
    /// The connection dropped partway.
    ConnectionDropped { host: Option<String> },
    /// Uncommitted changes are in the way: `files` of them listed (0 when git didn't list
    /// them), new files when `untracked`.
    ChangesInTheWay { files: u32, untracked: bool },
    /// The branch has no remote branch to pull from.
    NoUpstream,
    /// Another git program is busy in the repository (or left `.git/index.lock` behind).
    IndexLocked,
    /// The two histories have no commit in common.
    UnrelatedHistories,
    /// The disk is full.
    DiskFull,
    /// Git LFS isn't installed.
    NoLfs,
    /// The branch has commits that aren't merged anywhere, so git won't delete it.
    NotFullyMerged,
    /// The branch is checked out in another working tree, at `path`.
    CheckedOutElsewhere { path: String },
    /// A working tree has uncommitted changes, so it isn't removed.
    WorktreeChanged,
    /// It stopped at conflicts, for the person to resolve (a patch applied with conflicts).
    Conflicts,
}

/// What a failure's message says, read the way the frontend used to: the first kind that
/// matches, or None when it isn't one known here.
pub fn classify(message: &str) -> Option<ErrorKind> {
    // ASCII lower case keeps every byte where it was, so places found in it are places in
    // the message.
    let lower = message.to_ascii_lowercase();
    let says = |words: &[&str]| words.iter().any(|word| lower.contains(word));

    if let Some((branch, reason)) = rejected(message) {
        match reason {
            "fetch first" | "non-fast-forward" => return Some(ErrorKind::PushRejected { branch }),
            "stale info" => return Some(ErrorKind::StaleLease { branch }),
            _ => {}
        }
    }
    if let Some(branch) = gone(message, &lower) {
        return Some(ErrorKind::UpstreamGone { branch });
    }
    if says(&["not possible to fast-forward"]) {
        return Some(ErrorKind::NotFastForward);
    }
    if says(&[
        "gh001",
        "exceeds github's file size limit",
        "large files detected",
    ]) {
        return Some(ErrorKind::TooLarge {
            file: too_large_file(message),
            host: host(message),
        });
    }
    if says(&[
        "gh006",
        "protected branch hook declined",
        "not allowed to push code to protected branches",
    ]) {
        return Some(ErrorKind::Protected {
            host: host(message),
        });
    }
    if says(&[
        "git needs your credentials",
        "authentication failed",
        "could not read username",
        "terminal prompts disabled",
        "permission denied (publickey",
    ]) {
        return Some(ErrorKind::SignIn {
            host: host(message),
        });
    }
    if says(&[
        "repository not found",
        "does not appear to be a git repository",
    ]) || lower.lines().any(|line| {
        line.find("repository '")
            .is_some_and(|at| line[at + "repository '".len()..].contains("' not found"))
    }) {
        return Some(ErrorKind::RepositoryNotFound {
            host: host(message),
        });
    }
    if says(&[
        "could not resolve host",
        "failed to connect to",
        "connection timed out",
        "couldn't connect to server",
        "network is unreachable",
        "operation timed out",
        "connection refused",
    ]) {
        return Some(ErrorKind::Unreachable {
            host: host(message),
        });
    }
    if says(&[
        "the remote end hung up unexpectedly",
        "early eof",
        "rpc failed",
        "unexpected disconnect",
    ]) {
        return Some(ErrorKind::ConnectionDropped {
            host: host(message),
        });
    }
    if says(&[
        "untracked working tree files would be overwritten",
        "untracked working tree files would be removed",
    ]) {
        return Some(ErrorKind::ChangesInTheWay {
            files: listed_files(message),
            untracked: true,
        });
    }
    if says(&[
        "would be overwritten by",
        "commit your changes or stash them",
        "your local changes",
        "you have unstaged changes",
        "your index contains uncommitted changes",
    ]) {
        return Some(ErrorKind::ChangesInTheWay {
            files: listed_files(message),
            untracked: false,
        });
    }
    if says(&[
        "there is no tracking information for the current branch",
        "has no upstream branch",
    ]) {
        return Some(ErrorKind::NoUpstream);
    }
    if says(&["index.lock': file exists"]) {
        return Some(ErrorKind::IndexLocked);
    }
    if says(&["refusing to merge unrelated histories"]) {
        return Some(ErrorKind::UnrelatedHistories);
    }
    if says(&["no space left on device"]) {
        return Some(ErrorKind::DiskFull);
    }
    if says(&[
        "git: 'lfs' is not a git command",
        "git-lfs: command not found",
        "git-lfs was not found",
    ]) {
        return Some(ErrorKind::NoLfs);
    }
    if says(&["not fully merged"]) {
        return Some(ErrorKind::NotFullyMerged);
    }
    if let Some(path) = elsewhere(message, &lower) {
        return Some(ErrorKind::CheckedOutElsewhere { path });
    }
    None
}

/// A push git refused: the remote branch and why, from a line like
/// ` ! [rejected]        main -> main (fetch first)`.
fn rejected(message: &str) -> Option<(String, &str)> {
    message.lines().find_map(|line| {
        let rest = &line[line.find("! [rejected]")? + "! [rejected]".len()..];
        let (_, rest) = rest.split_once("->")?;
        let rest = rest.trim_start();
        let (branch, rest) = rest.split_once(char::is_whitespace)?;
        let reason = rest.trim_start().strip_prefix('(')?;
        Some((branch.to_owned(), &reason[..reason.find(')')?]))
    })
}

/// The branch a pull went with that the remote doesn't have any more: "Your configuration
/// specifies to merge with the ref 'refs/heads/master' from the remote, but no such ref was
/// fetched."
fn gone(message: &str, lower: &str) -> Option<String> {
    const SPECIFIES: &str = "your configuration specifies to merge with the ref 'refs/heads/";
    let start = lower.find(SPECIFIES)? + SPECIFIES.len();
    let end = start + message[start..].find('\'')?;
    lower[end..]
        .contains("but no such ref was fetched")
        .then(|| message[start..end].to_owned())
}

/// The file GitHub said is too big: "File assets/hall.psd is 120.00 MB; this exceeds …".
fn too_large_file(message: &str) -> Option<String> {
    message.lines().find_map(|line| {
        let lower = line.to_ascii_lowercase();
        if !lower.contains("mb; this exceeds") {
            return None;
        }
        let mut words = line[lower.find("file ")? + "file ".len()..].split_whitespace();
        let file = words.next()?;
        (words.next()? == "is").then(|| file.to_owned())
    })
}

/// The worktree a branch is checked out in: "… is already used by worktree at '/path'" or
/// "… is already checked out at '/path'".
fn elsewhere(message: &str, lower: &str) -> Option<String> {
    ["already used by worktree at '", "already checked out at '"]
        .iter()
        .find_map(|words| {
            let start = lower.find(words)? + words.len();
            let end = start + message[start..].find('\'')?;
            Some(message[start..end].to_owned())
        })
}

/// How many files git listed, one per line after a tab, as after "…would be overwritten by
/// checkout:".
fn listed_files(message: &str) -> u32 {
    let count = message
        .lines()
        .filter(|line| {
            line.strip_prefix('\t')
                .is_some_and(|name| name.starts_with(|c: char| !c.is_whitespace()))
        })
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// The host in git's message ("github.com"): where it pushed to (a line "To …"), or else
/// the first address in it.
fn host(message: &str) -> Option<String> {
    let pushed_to = message.lines().find_map(|line| {
        let rest = line.strip_prefix("To ")?;
        // An optional scheme ("https://"), then optional user ("git@").
        let rest = match rest.find("://") {
            Some(at)
                if !rest[..at].is_empty()
                    && rest[..at]
                        .chars()
                        .all(|c| c.is_ascii_alphabetic() || c == '+') =>
            {
                &rest[at + 3..]
            }
            _ => rest,
        };
        host_after_user(rest, &['/', ':'])
    });
    pushed_to.or_else(|| {
        message
            .split(|c: char| c.is_whitespace() || c == '\'' || c == '"')
            .find_map(address_host)
    })
}

/// The host in one word of a message, when it's an address: a URL ("https://github.com/…",
/// "ssh://git@host/…") or the short form of an SSH one ("git@github.com:team/repo.git").
fn address_host(word: &str) -> Option<String> {
    if let Some(at) = word.find("://") {
        let before = &word[..at];
        let start = before
            .rfind(|c: char| !c.is_ascii_alphabetic())
            .map_or(0, |end| end + 1);
        let scheme = before[start..].to_ascii_lowercase();
        let known = ["http", "https", "ssh", "git"];
        if known.contains(&scheme.as_str()) {
            return host_after_user(&word[at + 3..], &['/', ':']);
        }
    }
    let (user, rest) = word.split_once('@')?;
    let (host, _) = rest.split_once(':')?;
    let word_like = |text: &str| {
        !text.is_empty()
            && text
                .chars()
                .all(|c| c.is_alphanumeric() || c == '_' || c == '.' || c == '-')
    };
    let (_, top) = host.rsplit_once('.')?;
    let has_user = user
        .chars()
        .last()
        .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '.' || c == '-');
    (has_user && word_like(host) && top.len() >= 2 && top.chars().all(|c| c.is_ascii_alphabetic()))
        .then(|| host.to_owned())
}

/// The host at the start of `rest`, after a user ("git@") if there's one, up to one of `ends`.
fn host_after_user(rest: &str, ends: &[char]) -> Option<String> {
    let user_end = rest.find('@').filter(|&at| {
        let user = &rest[..at];
        !user.is_empty() && !user.contains('/') && !user.contains(char::is_whitespace)
    });
    let rest = user_end.map_or(rest, |at| &rest[at + 1..]);
    let end = rest
        .find(|c: char| ends.contains(&c) || c.is_whitespace())
        .unwrap_or(rest.len());
    (end > 0).then(|| rest[..end].to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// git's messages for the failures recognised here, as git words them.
    const FETCH_FIRST: &str = "To github.com:shikoko/notebook.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'github.com:shikoko/notebook.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally.";
    const STALE: &str = "To https://github.com/shikoko/notebook.git
 ! [rejected]        HEAD -> feat/environment-materials (stale info)
error: failed to push some refs to 'https://github.com/shikoko/notebook.git'";
    const NOT_FF: &str = "hint: Diverging branches can't be fast-forwarded, you need to either:
fatal: Not possible to fast-forward, aborting.";
    const PROTECTED: &str =
        "remote: error: GH006: Protected branch update failed for refs/heads/main.
To github.com:shikoko/notebook.git
 ! [remote rejected] main -> main (protected branch hook declined)";
    const LARGE: &str = "remote: error: File assets/hall.psd is 120.00 MB; this exceeds GitHub's file size limit of 100.00 MB
remote: error: GH001: Large files detected. You may want to try Git Large File Storage.
To github.com:shikoko/notebook.git
 ! [remote rejected] main -> main (pre-receive hook declined)";
    const OFFLINE: &str = "fatal: unable to access 'https://github.com/shikoko/notebook.git/': Could not resolve host: github.com";
    const LOCAL_CHANGES: &str =
        "error: Your local changes to the following files would be overwritten by checkout:
\tREADME.md
\tsrc/main.rs
Please commit your changes or stash them before you switch branches.
Aborting";
    const UNTRACKED: &str =
        "error: The following untracked working tree files would be overwritten by checkout:
\tnotes.txt
Please move or remove them before you switch branches.
Aborting";
    const GONE: &str = "Your configuration specifies to merge with the ref 'refs/heads/master'
from the remote, but no such ref was fetched.";

    #[test]
    fn knows_a_rejected_push_and_whose_branch() {
        assert_eq!(
            classify(FETCH_FIRST),
            Some(ErrorKind::PushRejected {
                branch: "main".into()
            })
        );
        assert_eq!(
            classify(STALE),
            Some(ErrorKind::StaleLease {
                branch: "feat/environment-materials".into()
            })
        );
        // A tag that's there already isn't a branch with others' commits.
        assert_eq!(
            classify(" ! [rejected]        v1.0 -> v1.0 (already exists)"),
            None
        );
    }

    #[test]
    fn knows_the_hosts_answers() {
        assert_eq!(
            classify(PROTECTED),
            Some(ErrorKind::Protected {
                host: Some("github.com".into())
            })
        );
        assert_eq!(
            classify(LARGE),
            Some(ErrorKind::TooLarge {
                file: Some("assets/hall.psd".into()),
                host: Some("github.com".into())
            })
        );
        assert_eq!(
            classify(OFFLINE),
            Some(ErrorKind::Unreachable {
                host: Some("github.com".into())
            })
        );
        assert_eq!(
            classify("fatal: Authentication failed for 'https://gitlab.com/team/game.git/'"),
            Some(ErrorKind::SignIn {
                host: Some("gitlab.com".into())
            })
        );
        assert_eq!(
            classify(
                "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."
            ),
            Some(ErrorKind::SignIn {
                host: Some("github.com".into())
            })
        );
        assert_eq!(
            classify(
                "remote: Repository not found.\nfatal: repository 'https://github.com/team/gone.git/' not found"
            ),
            Some(ErrorKind::RepositoryNotFound {
                host: Some("github.com".into())
            })
        );
        // The app's own words about credentials, before git's.
        assert_eq!(
            classify(
                "Git needs your credentials for this remote. Sign in once with git in a terminal \
                 (or set up a credential helper), then try again.\n\nfatal: could not read \
                 Username for 'https://gitlab.com': terminal prompts disabled"
            ),
            Some(ErrorKind::SignIn {
                host: Some("gitlab.com".into())
            })
        );
        assert_eq!(
            classify(
                "remote: error: File Content/Maps/Tavern.umap is 142.31 MB; this exceeds GitHub's \
                 file size limit of 100.00 MB\nremote: error: GH001: Large files detected."
            ),
            Some(ErrorKind::TooLarge {
                file: Some("Content/Maps/Tavern.umap".into()),
                host: None
            })
        );
        assert_eq!(
            classify("fatal: the remote end hung up unexpectedly"),
            Some(ErrorKind::ConnectionDropped { host: None })
        );
    }

    #[test]
    fn knows_changes_in_the_way_and_counts_them() {
        assert_eq!(
            classify(LOCAL_CHANGES),
            Some(ErrorKind::ChangesInTheWay {
                files: 2,
                untracked: false
            })
        );
        assert_eq!(
            classify(UNTRACKED),
            Some(ErrorKind::ChangesInTheWay {
                files: 1,
                untracked: true
            })
        );
        assert_eq!(
            classify("error: cannot pull with rebase: You have unstaged changes."),
            Some(ErrorKind::ChangesInTheWay {
                files: 0,
                untracked: false
            })
        );
    }

    #[test]
    fn knows_the_rest() {
        assert_eq!(
            classify(GONE),
            Some(ErrorKind::UpstreamGone {
                branch: "master".into()
            })
        );
        assert_eq!(classify(NOT_FF), Some(ErrorKind::NotFastForward));
        assert_eq!(
            classify("There is no tracking information for the current branch."),
            Some(ErrorKind::NoUpstream)
        );
        assert_eq!(
            classify("fatal: Unable to create '/work/notebook/.git/index.lock': File exists."),
            Some(ErrorKind::IndexLocked)
        );
        assert_eq!(
            classify("fatal: refusing to merge unrelated histories"),
            Some(ErrorKind::UnrelatedHistories)
        );
        assert_eq!(
            classify("error: unable to write file x: No space left on device"),
            Some(ErrorKind::DiskFull)
        );
        assert_eq!(
            classify("git: 'lfs' is not a git command. See 'git --help'."),
            Some(ErrorKind::NoLfs)
        );
        assert_eq!(
            classify("error: the branch 'art/barber' is not fully merged."),
            Some(ErrorKind::NotFullyMerged)
        );
        assert_eq!(
            classify("fatal: 'art/barber' is already used by worktree at '/work/barber'"),
            Some(ErrorKind::CheckedOutElsewhere {
                path: "/work/barber".into()
            })
        );
        assert_eq!(classify("pick-target already has the commit"), None);
        assert_eq!(classify("fatal: not a git repository"), None);
    }

    #[test]
    fn finds_the_host_in_any_kind_of_address() {
        assert_eq!(
            host("To github.com:team/game.git").as_deref(),
            Some("github.com")
        );
        assert_eq!(
            host("To ssh://git@gitlab.example.com:2222/team/game.git").as_deref(),
            Some("gitlab.example.com")
        );
        assert_eq!(
            host("fatal: unable to access 'https://bob@bitbucket.org/team/game.git/': x")
                .as_deref(),
            Some("bitbucket.org")
        );
        assert_eq!(
            host("fatal: Could not read from git@github.com:team/game.git").as_deref(),
            Some("github.com")
        );
        assert_eq!(host("fatal: nothing to see"), None);
    }
}
