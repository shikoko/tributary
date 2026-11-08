//! The activity log: every git command Tributary ran, with what it printed.

use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::Git;

/// A git command Tributary ran, for the activity log.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: u64,
    /// When it started, in milliseconds since the Unix epoch.
    pub started: u64,
    pub duration_ms: u64,
    /// The folder it ran in.
    pub folder: String,
    /// Everything after `git`.
    pub args: Vec<String>,
    pub success: bool,
    /// What git printed, shortened when it's long.
    pub output: String,
    /// Run by Tributary on its own, like the fetch every few minutes.
    pub background: bool,
}

const LOG_SIZE: usize = 300;
const LOG_OUTPUT: usize = 8_000;
static LOG: Mutex<VecDeque<LogEntry>> = Mutex::new(VecDeque::new());
type Listener = Box<dyn Fn(&LogEntry) + Send + Sync>;
static LISTENER: OnceLock<Listener> = OnceLock::new();

/// The most recent git commands, oldest first.
pub fn activity() -> Vec<LogEntry> {
    LOG.lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .cloned()
        .collect()
}

/// Call `listener` after every git command (for the app to update its activity log).
pub fn on_activity(listener: impl Fn(&LogEntry) + Send + Sync + 'static) {
    let _ = LISTENER.set(Box::new(listener));
}

/// Reading commands, and Tributary's own backups (see `back_up`), stay out of the log.
const UNLOGGED: &[&str] = &[
    "check-attr",
    "rev-parse",
    "rev-list",
    "check-ref-format",
    "merge-base",
    "for-each-ref",
    "update-ref",
    "ls-files",
    "log",
    "diff",
    "cat-file",
    "status",
];

/// `text` with the user names and passwords (or tokens) taken out of the web addresses in
/// it: `https://user:token@host/path` → `https://host/path`. SSH addresses keep their user.
pub(crate) fn without_credentials(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("://") {
        let (before, after) = rest.split_at(at + 3);
        result.push_str(before);
        // The address's authority: up to its path, or the end of the address.
        let end = after
            .find(|c: char| c == '/' || c.is_whitespace() || matches!(c, '\'' | '"' | '<' | '>'))
            .unwrap_or(after.len());
        let (authority, remainder) = after.split_at(end);
        let scheme = before[..before.len() - 3]
            .rsplit(|c: char| !c.is_ascii_alphanumeric() && c != '+' && c != '-' && c != '.')
            .next()
            .unwrap_or_default();
        match authority.rsplit_once('@') {
            Some((_, host)) if !scheme.eq_ignore_ascii_case("ssh") => result.push_str(host),
            _ => result.push_str(authority),
        }
        rest = remainder;
    }
    result.push_str(rest);
    result
}

pub(crate) fn record(
    git: &Git,
    args: &[&str],
    started: SystemTime,
    took: Instant,
    success: bool,
    output: &str,
) {
    if args.first().is_some_and(|first| UNLOGGED.contains(first))
        || args.starts_with(&["worktree", "list"])
        || args.starts_with(&["lfs", "locks"])
    {
        return;
    }
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let output = without_credentials(output.trim());
    let output = match output.char_indices().nth(LOG_OUTPUT) {
        Some((cut, _)) => format!("{}\n…", &output[..cut]),
        None => output.to_owned(),
    };
    let entry = LogEntry {
        id: NEXT.fetch_add(1, Ordering::SeqCst),
        started: started
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        duration_ms: took.elapsed().as_millis() as u64,
        folder: git.workdir.display().to_string(),
        args: args.iter().map(|arg| without_credentials(arg)).collect(),
        success,
        output,
        background: git.background,
    };
    {
        let mut log = LOG.lock().unwrap_or_else(|e| e.into_inner());
        if log.len() == LOG_SIZE {
            log.pop_front();
        }
        log.push_back(entry.clone());
    }
    if let Some(listener) = LISTENER.get() {
        listener(&entry);
    }
}

#[cfg(test)]
mod tests {
    use super::without_credentials;

    #[test]
    fn takes_credentials_out_of_addresses() {
        assert_eq!(
            without_credentials(
                "remote add origin https://maya:ghp_secret@github.com/acme/app.git"
            ),
            "remote add origin https://github.com/acme/app.git"
        );
        assert_eq!(
            without_credentials(
                "fatal: repository 'https://oauth2:glpat-x@gitlab.com/g/app/' not found"
            ),
            "fatal: repository 'https://gitlab.com/g/app/' not found"
        );
        assert_eq!(
            without_credentials("ssh://git@host:22/repo.git"),
            "ssh://git@host:22/repo.git"
        );
        assert_eq!(
            without_credentials("git@github.com:acme/app.git"),
            "git@github.com:acme/app.git"
        );
        assert_eq!(without_credentials("https://token@host"), "https://host");
        assert_eq!(
            without_credentials("no addresses here"),
            "no addresses here"
        );
    }
}
