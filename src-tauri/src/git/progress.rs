//! Progress of fetches, pulls, pushes and clones, read from git's output (and Git LFS's
//! progress log), and cancelling them.

use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};

use serde::Serialize;
use ts_rs::TS;

use super::activity::record;
use super::{Git, command, error_message, lfs_progress, read_lines};
use crate::error::{Error, Result};

/// How far a fetch, pull or push has got.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// Like "Receiving objects".
    pub phase: String,
    /// None until git reports a percentage.
    pub percent: Option<u8>,
    /// More about it, like "2 of 5 files · 56 MB of 80 MB · 12 MB/s".
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Files done of how many, when the percentage is about something else (the bytes of all
    /// of them, or of the one being downloaded).
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<FileCount>,
    /// Bytes a second, the file being transferred, about how many seconds are left, and the
    /// biggest file still to come (Git LFS transfers).
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate: Option<u64>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<u64>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub biggest_left: Option<NamedSize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct NamedSize {
    pub name: String,
    pub size: u64,
}

/// Files a Git LFS transfer is expected to get, with their sizes.
pub type ExpectedFiles = Vec<(String, u64)>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub struct FileCount {
    pub done: u32,
    pub total: u32,
}

/// A fetch, pull or push that is running, so it can be cancelled.
struct Running {
    id: u64,
    /// The folder it runs in (a repository, or one of its submodules).
    workdir: PathBuf,
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

static RUNNING: Mutex<Vec<Running>> = Mutex::new(Vec::new());
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Stop the fetches, pulls and pushes running in the repository at `path` (and its
/// submodules), or every one without a path. Returns false if there are none.
pub fn cancel(path: Option<&Path>) -> bool {
    let path = path.map(canonical);
    let running = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    let mut stopped = false;
    for run in running.iter() {
        if path
            .as_ref()
            .is_some_and(|path| !run.workdir.starts_with(path))
        {
            continue;
        }
        run.cancelled.store(true, Ordering::SeqCst);
        let _ = run.child.lock().unwrap_or_else(|e| e.into_inner()).kill();
        stopped = true;
    }
    stopped
}

/// `path` as the file system has it, to compare: the same however it was written.
fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// "Receiving objects:  45% (450/1000), 1.2 MiB | 2.0 MiB/s" → "Receiving objects", 45%,
/// "1.2 MiB · 2.0 MiB/s". Also reads the lines Git LFS writes when its progress is forced on.
pub fn parse_progress(line: &str) -> Option<Progress> {
    let line = line.trim();
    let line = line.strip_prefix("remote:").unwrap_or(line).trim();
    let (phase, rest) = line.split_once(':')?;
    if phase.is_empty() || !phase.chars().all(|c| c.is_ascii_alphabetic() || c == ' ') {
        return None;
    }
    let rest = rest.trim_start();
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() || !rest[digits.len()..].starts_with('%') {
        return None;
    }
    let percent = digits.parse::<u8>().ok()?.min(100);

    // What follows: "(450/1000), 1.2 MiB | 2.0 MiB/s", "(3/3), done." or nothing.
    let after = rest[digits.len() + 1..].trim();
    let after = after
        .trim_end_matches('.')
        .trim_end_matches(", done")
        .trim();
    let (counts, amounts) = match after.split_once("), ") {
        Some((counts, amounts)) => (counts.trim_start_matches('('), Some(amounts)),
        None => (after.trim_start_matches('(').trim_end_matches(')'), None),
    };
    // Counts of files (rather than objects): Git LFS's, and a checkout's.
    let files = phase.contains("LFS") || phase == "Filtering content" || phase == "Updating files";
    let mut detail = Vec::new();
    let mut count = None;
    if files && let Some((done, total)) = counts.split_once('/') {
        detail.push(format!("{done} of {total} files"));
        // Git LFS's own line, when it logs nothing more: the files, for the second bar.
        if phase.contains("LFS")
            && let (Ok(done), Ok(total)) = (done.trim().parse(), total.trim().parse())
        {
            count = Some(FileCount { done, total });
        }
    }
    for amount in amounts.into_iter().flat_map(|amounts| amounts.split(" | ")) {
        let amount = amount.trim();
        // Transfers to a folder on this computer report no bytes at all.
        let nothing =
            amount == "0 B" || amount.starts_with("0 B/") || amount.starts_with("0 bytes");
        if !amount.is_empty() && !nothing {
            detail.push(amount.to_owned());
        }
    }
    let phase = match phase.trim() {
        "Uploading LFS objects" => "Uploading LFS files",
        "Downloading LFS objects" => "Downloading LFS files",
        // git's progress while Git LFS fills in the files it checks out.
        "Filtering content" => "Checking out LFS files",
        other => other,
    };
    Some(Progress {
        phase: phase.to_owned(),
        percent: Some(percent),
        detail: (!detail.is_empty()).then(|| detail.join(" · ")),
        files: count,
        ..Progress::default()
    })
}

/// Progress chatter that doesn't belong in an error message, like "remote: Total 3 (delta 0)".
fn is_progress_noise(line: &str) -> bool {
    let line = line.trim();
    let line = line.strip_prefix("remote:").unwrap_or(line).trim();
    if line.starts_with("Total ") || parse_progress(line).is_some() {
        return true;
    }
    // "Enumerating objects: 5, done."
    line.split_once(':').is_some_and(|(phase, rest)| {
        !phase.is_empty()
            && phase.chars().all(|c| c.is_ascii_alphabetic() || c == ' ')
            && rest.trim_start().starts_with(|c: char| c.is_ascii_digit())
    })
}

/// What a fetch, pull or push printed.
pub(crate) struct ProgressOutput {
    /// Messages on standard error, without the progress lines.
    pub(crate) messages: String,
}

impl Git {
    /// Run a fetch, pull or push, reporting progress and allowing [`cancel`].
    pub(crate) fn run_progress(
        &self,
        args: &[&str],
        on_progress: &dyn Fn(Progress),
    ) -> Result<ProgressOutput, Error> {
        self.run_progress_with_env(args, &[], on_progress)
    }

    /// [`Git::run_progress`], with extra environment variables.
    pub(crate) fn run_progress_with_env(
        &self,
        args: &[&str],
        env: &[(&str, &str)],
        on_progress: &dyn Fn(Progress),
    ) -> Result<ProgressOutput, Error> {
        self.run_progress_counting(args, env, on_progress, &|_| None)
    }

    /// [`Git::run_progress_with_env`], for commands that have Git LFS download files one at
    /// a time (a pull, a switch: git fills in each file as it checks it out, and LFS only
    /// knows about that one). Once LFS starts, `expected` says how many files it will
    /// download in all (given those it has started on already), so the progress can count
    /// them.
    pub(crate) fn run_progress_counting(
        &self,
        args: &[&str],
        env: &[(&str, &str)],
        on_progress: &dyn Fn(Progress),
        expected: &dyn Fn(&std::collections::HashSet<String>) -> Option<ExpectedFiles>,
    ) -> Result<ProgressOutput, Error> {
        use std::sync::mpsc::{RecvTimeoutError, channel};
        use std::time::Duration;

        self.wait_for_index();
        let _working = super::Working::start();
        let (started, took) = (SystemTime::now(), Instant::now());
        on_progress(Progress {
            phase: "Connecting".into(),
            ..Progress::default()
        });
        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        // Git LFS keeps quiet about its transfers unless it's writing to a terminal. Ask it
        // to log them to a file instead (byte by byte), and to print its own summary lines
        // anyway, for transfers the file doesn't cover.
        let lfs_log =
            std::env::temp_dir().join(format!("tributary-lfs-{}-{id}.log", std::process::id()));
        let _ = std::fs::remove_file(&lfs_log);
        let mut lfs = lfs_progress::ProgressLog::new(lfs_log.clone());
        let mut child = command(&self.executable)
            .arg("-C")
            .arg(&self.workdir)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_MERGE_AUTOEDIT", "no")
            .env("GIT_LFS_PROGRESS", &lfs_log)
            .env("GIT_LFS_FORCE_PROGRESS", "1")
            .envs(env.iter().copied())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not run git: {e}"))?;
        let stderr = child.stderr.take().ok_or("Could not read git's output")?;
        let stdout = child.stdout.take().ok_or("Could not read git's output")?;

        // git's helper processes share its output pipes and can outlive it when it's
        // cancelled, so the pipes are read on their own threads and never waited for
        // once git itself has exited.
        let (lines, received) = channel::<String>();
        let progress_lines = lines.clone();
        std::thread::spawn(move || {
            read_lines(stderr, |line| {
                let _ = lines.send(line);
            })
        });
        let (output, output_received) = channel::<String>();
        std::thread::spawn(move || {
            // Hooks write to standard output, and Git LFS's upload before a push (a hook)
            // reports its progress there, so progress is picked out of it as it comes.
            let mut text = String::new();
            read_lines(stdout, |line| {
                if is_progress_noise(&line) {
                    let _ = progress_lines.send(line);
                } else {
                    text.push_str(&line);
                    text.push('\n');
                }
            });
            let _ = output.send(text.trim_end().to_owned());
        });

        let child = Arc::new(Mutex::new(child));
        let cancelled = Arc::new(AtomicBool::new(false));
        RUNNING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(Running {
                id,
                workdir: canonical(&self.workdir),
                child: child.clone(),
                cancelled: cancelled.clone(),
            });

        let mut messages = String::new();
        let mut last: Option<Progress> = None;
        let mut report = |progress: Progress| {
            if last.as_ref() != Some(&progress) {
                on_progress(progress.clone());
                last = Some(progress);
            }
        };
        // Whether to ask how many files LFS will download: once it has started (the fetch
        // is done by then), and again at the end, when every file it got is in its log.
        let ask = std::cell::Cell::new(true);
        let mut handle = |text: String, lfs: &mut lfs_progress::ProgressLog| {
            if let Some(progress) = lfs.poll() {
                report(progress);
            }
            if ask.get() && lfs.active() {
                ask.set(false);
                if let Some(files) = expected(&lfs.seen()) {
                    lfs.expect(files);
                }
            }
            if let Some(progress) = parse_progress(&text) {
                // Git LFS's own lines only count files; its log, when there is one, is better.
                let from_lfs = progress.phase.contains("LFS");
                if !(from_lfs && lfs.active()) {
                    report(progress);
                }
            } else if !text.trim().is_empty() && !is_progress_noise(&text) {
                messages.push_str(text.trim_end());
                messages.push('\n');
            }
        };
        let exited = |child: &Arc<Mutex<Child>>| {
            child
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .try_wait()
                .map_err(|e| format!("Could not run git: {e}"))
        };
        let status = loop {
            match received.recv_timeout(Duration::from_millis(50)) {
                Ok(text) => handle(text, &mut lfs),
                Err(RecvTimeoutError::Timeout) => {
                    handle(String::new(), &mut lfs);
                    if let Some(status) = exited(&child)? {
                        break status;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if let Some(status) = exited(&child)? {
                        break status;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
        };
        RUNNING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|run| run.id != id);
        // What LFS logged at the end, which a quick transfer may not have given a poll the
        // time to read: read it now, count the files once more (exactly, now that they're
        // all in the log), and report that.
        lfs.force_next();
        ask.set(true);
        handle(String::new(), &mut lfs);
        lfs.force_next();
        handle(String::new(), &mut lfs);
        let _ = std::fs::remove_file(&lfs_log);
        if cancelled.load(Ordering::SeqCst) {
            record(self, args, started, took, false, "Cancelled.");
            return Err(Error::Cancelled);
        }

        // Whatever git wrote just before exiting.
        while let Ok(text) = received.recv_timeout(Duration::from_millis(200)) {
            handle(text, &mut lfs);
        }
        let stdout = output_received
            .recv_timeout(Duration::from_secs(2))
            .unwrap_or_default();
        let printed = format!("{}\n{}", stdout.trim_end(), messages.trim_end());
        record(self, args, started, took, status.success(), &printed);
        if status.success() {
            return Ok(ProgressOutput { messages });
        }
        Err(Error::Git(error_message(args, &status, &stdout, &messages)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancels_only_the_repository_asked_for() {
        let dir = std::env::temp_dir().join(format!("tributary-cancel-{}", std::process::id()));
        let (one, two) = (dir.join("one"), dir.join("two"));
        std::fs::create_dir_all(&one).unwrap();
        std::fs::create_dir_all(two.join("submodule")).unwrap();
        // A git waiting for input until it's stopped, in each (in the second's submodule).
        let start = |workdir: &Path| {
            let child = std::process::Command::new("git")
                .args(["hash-object", "--stdin"])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .spawn()
                .unwrap();
            let run = Running {
                id: NEXT_ID.fetch_add(1, Ordering::SeqCst),
                workdir: canonical(workdir),
                child: Arc::new(Mutex::new(child)),
                cancelled: Arc::new(AtomicBool::new(false)),
            };
            let started = (run.id, run.child.clone(), run.cancelled.clone());
            RUNNING.lock().unwrap().push(run);
            started
        };
        let (first, first_child, first_cancelled) = start(&one);
        let (second, second_child, second_cancelled) = start(&two.join("submodule"));

        assert!(cancel(Some(&two)));
        assert!(second_cancelled.load(Ordering::SeqCst));
        assert!(second_child.lock().unwrap().wait().is_ok());
        assert!(!first_cancelled.load(Ordering::SeqCst));
        assert!(first_child.lock().unwrap().try_wait().unwrap().is_none());

        // Only this test's: others may be running git at the same time.
        let _ = first_child.lock().unwrap().kill();
        let _ = first_child.lock().unwrap().wait();
        RUNNING
            .lock()
            .unwrap()
            .retain(|run| run.id != first && run.id != second);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_progress_lines() {
        let progress = |phase: &str, percent: u8, detail: Option<&str>| Progress {
            phase: phase.into(),
            percent: Some(percent),
            detail: detail.map(Into::into),
            ..Progress::default()
        };
        assert_eq!(
            parse_progress("Receiving objects:  45% (450/1000), 1.2 MiB | 2.0 MiB/s"),
            Some(progress(
                "Receiving objects",
                45,
                Some("1.2 MiB · 2.0 MiB/s")
            ))
        );
        assert_eq!(
            parse_progress("remote: Compressing objects: 100% (3/3), done."),
            Some(progress("Compressing objects", 100, None))
        );
        assert_eq!(
            parse_progress("Writing objects: 100% (6/6), 916 bytes | 916.00 KiB/s, done."),
            Some(progress(
                "Writing objects",
                100,
                Some("916 bytes · 916.00 KiB/s")
            ))
        );
        // Git LFS, with its progress forced on.
        assert_eq!(
            parse_progress("Uploading LFS objects:  67% (2/3), 56 MB | 30 MB/s          "),
            Some(Progress {
                files: Some(FileCount { done: 2, total: 3 }),
                ..progress(
                    "Uploading LFS files",
                    67,
                    Some("2 of 3 files · 56 MB · 30 MB/s"),
                )
            })
        );
        assert_eq!(
            parse_progress("Uploading LFS objects: 100% (2/2), 0 B | 0 B/s, done."),
            Some(Progress {
                files: Some(FileCount { done: 2, total: 2 }),
                ..progress("Uploading LFS files", 100, Some("2 of 2 files"))
            })
        );
        assert_eq!(
            parse_progress("Filtering content:  50% (1/2), 15 MB | 7.5 MB/s"),
            Some(progress(
                "Checking out LFS files",
                50,
                Some("1 of 2 files · 15 MB · 7.5 MB/s")
            ))
        );
        assert_eq!(
            parse_progress("Updating files:  37% (148/400)"),
            Some(progress("Updating files", 37, Some("148 of 400 files")))
        );
        assert_eq!(parse_progress("To github.com:someone/repo.git"), None);
        assert_eq!(
            parse_progress(" ! [rejected]        main -> main (fetch first)"),
            None
        );
        assert_eq!(parse_progress("error: failed to push some refs"), None);
    }

    #[test]
    fn leaves_progress_chatter_out_of_error_messages() {
        assert!(is_progress_noise("remote: Enumerating objects: 5, done."));
        assert!(is_progress_noise(
            "remote: Total 3 (delta 0), reused 0 (delta 0)"
        ));
        assert!(is_progress_noise(
            "Writing objects: 100% (3/3), 280 bytes | 280.00 KiB/s, done."
        ));
        assert!(!is_progress_noise(
            "error: failed to push some refs to 'origin'"
        ));
        assert!(!is_progress_noise(
            "hint: Updates were rejected because the remote contains work"
        ));
    }
}
