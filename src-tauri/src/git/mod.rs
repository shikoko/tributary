//! Running the user's own `git`, so everything behaves exactly like git does on the
//! command line (line endings, LFS, hooks, credentials, …).

mod activity;
pub mod lfs_progress;
mod progress;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Instant, SystemTime};

use self::activity::record;
use crate::error::{Error, Result};

pub use activity::{LogEntry, activity, on_activity};
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

    /// The password (for GitHub, a token) git's credential helper keeps for `https://{host}`,
    /// if it has one. Never prompts, and gives up after a few seconds.
    pub(crate) fn stored_password(&self, host: &str) -> Option<String> {
        use std::io::Write;
        use std::time::Duration;
        let mut child = command(&self.executable)
            .args(["credential", "fill"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "never")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        child
            .stdin
            .take()?
            .write_all(format!("protocol=https\nhost={host}\n\n").as_bytes())
            .ok()?;
        let mut stdout = child.stdout.take()?;
        let (sender, answer) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stdout.read_to_string(&mut text);
            let _ = sender.send(text);
        });
        let text = answer.recv_timeout(Duration::from_secs(10)).ok();
        let _ = child.kill();
        let _ = child.wait();
        text?
            .lines()
            .find_map(|line| line.strip_prefix("password="))
            .map(str::to_owned)
            .filter(|password| !password.is_empty())
    }

    /// Run git with `args`, returning its output, or its error message.
    pub(crate) fn run(&self, args: &[&str]) -> Result<String, Error> {
        self.run_with_env(args, &[])
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
    if message.is_empty() {
        format!("git {} failed ({status})", args.join(" "))
    } else {
        message
    }
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
