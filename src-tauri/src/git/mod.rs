//! Running the user's own `git`, so everything behaves exactly like git does on the
//! command line (line endings, LFS, hooks, credentials, …).

mod activity;
mod credentials;
pub mod lfs_progress;
mod progress;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Instant, SystemTime};

use self::activity::record;
use crate::error::{Error, Result};

pub(crate) use activity::without_credentials;
pub use activity::{LogEntry, activity, on_activity};
pub(crate) use credentials::Credential;
pub use progress::{Progress, cancel, parse_progress};

/// The `git` executable, run inside one working tree.
#[derive(Clone)]
pub(crate) struct Git {
    executable: PathBuf,
    workdir: PathBuf,
    /// Running on Tributary's own initiative, not because the user asked (for the log).
    background: bool,
}

impl Git {
    /// The git program that runs.
    pub(crate) fn executable(&self) -> &Path {
        &self.executable
    }

    /// The working tree git runs in.
    pub(crate) fn workdir(&self) -> &Path {
        &self.workdir
    }

    /// The same git, for work nobody asked for (a background fetch, refreshing the
    /// index): it's marked as such in the activity log.
    pub(crate) fn in_background(&self) -> Self {
        Git {
            background: true,
            ..self.clone()
        }
    }

    /// The user's git, to run in `workdir`. Apps started from the macOS Finder don't get
    /// the shell's `PATH`, so common install locations are tried as well.
    pub(crate) fn find(workdir: PathBuf) -> Result<Self, Error> {
        let candidates = [
            "git",
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/usr/bin/git",
        ];
        let executable = candidates
            .iter()
            .map(PathBuf::from)
            .find(|candidate| {
                command(candidate)
                    .arg("--version")
                    .output()
                    .is_ok_and(|output| output.status.success())
            })
            .ok_or("This needs git, which wasn't found. Install it from https://git-scm.com and try again.")?;
        Ok(Git {
            executable,
            workdir,
            background: false,
        })
    }

    /// Run git with `args`, returning its output, or its error message.
    pub(crate) fn run(&self, args: &[&str]) -> Result<String, Error> {
        self.run_with_env(args, &[])
    }

    /// Run git with `args` when its exit code is an answer rather than a failure (like
    /// `git merge-tree`, where 1 means "it conflicts"): the code and what it printed.
    /// Only failing to run git at all is an error.
    pub(crate) fn run_status(&self, args: &[&str]) -> Result<(Option<i32>, String)> {
        let (started, took) = (SystemTime::now(), Instant::now());
        let output = command(&self.executable)
            .arg("-C")
            .arg(&self.workdir)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| format!("Could not run git: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr);
        let printed = format!("{}\n{}", stdout.trim_end(), stderr.trim_end());
        // An answer either way, as far as the log goes; only git's own errors (128) failed.
        let answered = output.status.code().is_some_and(|code| code < 128);
        record(self, args, started, took, answered, &printed);
        Ok((output.status.code(), stdout))
    }

    pub(crate) fn run_with_env(
        &self,
        args: &[&str],
        env: &[(&str, &str)],
    ) -> Result<String, Error> {
        let (started, took) = (SystemTime::now(), Instant::now());
        let output = command(&self.executable)
            .arg("-C")
            .arg(&self.workdir)
            .args(args)
            .envs(env.iter().copied())
            // Nobody can answer a prompt or edit a message here: fail or accept the default.
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_MERGE_AUTOEDIT", "no")
            .output()
            .map_err(|e| format!("Could not run git: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let printed = format!("{}\n{}", stdout.trim_end(), stderr.trim_end());
        record(self, args, started, took, output.status.success(), &printed);
        if output.status.success() {
            return Ok(stdout.into_owned());
        }
        Err(Error::Git(error_message(
            args,
            &output.status,
            &stdout,
            &stderr,
        )))
    }

    /// Run git with `args` (a command that only reads, like `cat-file`), returning exactly
    /// what it printed, which may not be text. Feeds it `input`, if there is any.
    pub(crate) fn run_bytes(&self, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>> {
        use std::io::Write;
        let mut child = command(&self.executable)
            .arg("-C")
            .arg(&self.workdir)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not run git: {e}"))?;
        if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
            // Written on its own thread, so a big input can't block on a full output pipe.
            let input = input.to_vec();
            std::thread::spawn(move || {
                let _ = stdin.write_all(&input);
            });
        }
        let output = child
            .wait_with_output()
            .map_err(|e| format!("Could not run git: {e}"))?;
        if output.status.success() {
            Ok(output.stdout)
        } else {
            Err(Error::Git(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ))
        }
    }

    /// Start git with `args` and leave it running, like a diff tool that stays open until
    /// it's closed. Waits up to `settle` for a quick failure (no tool set up, say), to
    /// report it.
    pub(crate) fn spawn(&self, args: &[&str], settle: std::time::Duration) -> Result<()> {
        let (started, took) = (SystemTime::now(), Instant::now());
        let mut child = command(&self.executable)
            .arg("-C")
            .arg(&self.workdir)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not run git: {e}"))?;
        // Read what it says on its own thread, so it can't block on a full pipe.
        let stderr = child.stderr.take();
        let said = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let collected = said.clone();
        std::thread::spawn(move || {
            if let Some(stderr) = stderr {
                read_lines(stderr, |line| {
                    if let Ok(mut text) = collected.lock() {
                        text.push_str(&line);
                        text.push('\n');
                    }
                });
            }
        });
        while took.elapsed() < settle {
            match child.try_wait() {
                Ok(Some(status)) => {
                    // Give the reader a moment to catch the last lines.
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    let message = said
                        .lock()
                        .map(|text| text.trim().to_owned())
                        .unwrap_or_default();
                    record(self, args, started, took, status.success(), &message);
                    return if status.success() {
                        Ok(())
                    } else if message.is_empty() {
                        Err(Error::Git(format!(
                            "git {} failed ({status})",
                            args.join(" ")
                        )))
                    } else {
                        Err(Error::Git(message))
                    };
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(e) => return Err(format!("Could not run git: {e}").into()),
            }
        }
        record(self, args, started, took, true, "(still open)");
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
}

/// Read `reader` to the end, a line at a time. git redraws its progress with carriage
/// returns, so those end lines too.
pub(super) fn read_lines(mut reader: impl Read, mut each: impl FnMut(String)) {
    let mut line = Vec::new();
    let mut chunk = [0u8; 4096];
    while let Ok(read) = reader.read(&mut chunk) {
        if read == 0 {
            break;
        }
        for &byte in &chunk[..read] {
            if byte == b'\r' || byte == b'\n' {
                each(String::from_utf8_lossy(&line).into_owned());
                line.clear();
            } else {
                line.push(byte);
            }
        }
    }
    if !line.is_empty() {
        each(String::from_utf8_lossy(&line).into_owned());
    }
}

/// git's error output, made a little friendlier.
pub(super) fn error_message(
    args: &[&str],
    status: &std::process::ExitStatus,
    stdout: &str,
    stderr: &str,
) -> String {
    // Merges report their conflicts on standard output.
    let conflicts: Vec<&str> = stdout
        .lines()
        .filter(|line| line.starts_with("CONFLICT") || line.starts_with("Automatic merge failed"))
        .collect();
    let message = [conflicts.join("\n"), stderr.trim().to_owned()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if message.contains("terminal prompts disabled") || message.contains("could not read Username")
    {
        return format!(
            "Git needs your credentials for this remote. Sign in once with git in a terminal \
             (or set up a credential helper), then try again.\n\n{message}"
        );
    }
    let message = if message.is_empty() {
        format!("git {} failed ({status})", args.join(" "))
    } else {
        message
    };
    activity::without_credentials(&message)
}

pub(crate) fn command(executable: &Path) -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut command = Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Don't flash a console window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}
