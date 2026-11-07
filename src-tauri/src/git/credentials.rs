//! The sign-ins git keeps with its credential helper (the system keychain, Git Credential
//! Manager, …): reading, saving and forgetting the one for a host. These carry passwords
//! and tokens, so they're never written to the activity log.

use std::io::{Read, Write};
use std::process::Stdio;
use std::time::Duration;

use super::{Git, command};
use crate::error::{Error, Result};

/// A user name and password (or token) for a host.
pub(crate) struct Credential {
    pub(crate) username: String,
    pub(crate) password: String,
}

/// How long to wait for a stored credential.
const LOOKUP: Duration = Duration::from_secs(10);

/// The request git's credential commands read: one `key=value` per line, then a blank
/// line. Values can't contain line breaks, which would let them add keys of their own.
fn request(host: &str, credential: Option<&Credential>) -> Result<String> {
    let mut fields = vec![("protocol", "https"), ("host", host)];
    if let Some(credential) = credential {
        fields.push(("username", &credential.username));
        fields.push(("password", &credential.password));
    }
    let mut text = String::new();
    for (key, value) in fields {
        if value.is_empty() || value.contains(['\n', '\r', '\0']) {
            return Err(Error::Message(format!("That {key} can't be saved.")));
        }
        text.push_str(&format!("{key}={value}\n"));
    }
    text.push('\n');
    Ok(text)
}

impl Git {
    /// The sign-in git's credential helper keeps for `https://{host}`, if it has one.
    /// With `interactive`, a helper like Git Credential Manager may ask the user to sign
    /// in (in a browser); otherwise it never asks. Gives up after `timeout`.
    pub(crate) fn fill_credential(
        &self,
        host: &str,
        interactive: bool,
        timeout: Duration,
    ) -> Option<Credential> {
        let input = request(host, None).ok()?;
        let mut child = command(&self.executable);
        child
            .args(["credential", "fill"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if !interactive {
            child.env("GCM_INTERACTIVE", "never");
        }
        let mut child = child.spawn().ok()?;
        child.stdin.take()?.write_all(input.as_bytes()).ok()?;
        let mut stdout = child.stdout.take()?;
        let (sender, answer) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stdout.read_to_string(&mut text);
            let _ = sender.send(text);
        });
        let text = answer.recv_timeout(timeout).ok();
        let _ = child.kill();
        let _ = child.wait();
        let text = text?;
        let field = |key: &str| {
            text.lines()
                .find_map(|line| line.strip_prefix(key)?.strip_prefix('='))
                .map(str::to_owned)
        };
        let password = field("password").filter(|password| !password.is_empty())?;
        Some(Credential {
            username: field("username").unwrap_or_default(),
            password,
        })
    }

    /// The password (for GitHub, a token) git keeps for `https://{host}`, if it has one.
    /// Never asks the user.
    pub(crate) fn stored_password(&self, host: &str) -> Option<String> {
        self.fill_credential(host, false, LOOKUP)
            .map(|credential| credential.password)
    }

    /// Keep `credential` for `https://{host}` with git's credential helper.
    pub(crate) fn approve_credential(&self, host: &str, credential: &Credential) -> Result<()> {
        self.credential_command("approve", &request(host, Some(credential))?)
    }

    /// Forget what git's credential helper keeps for `https://{host}`.
    pub(crate) fn reject_credential(&self, host: &str) -> Result<()> {
        self.credential_command("reject", &request(host, None)?)
    }

    /// The credential helpers git is set up with, like `osxkeychain` or `manager`.
    pub(crate) fn credential_helpers(&self) -> Vec<String> {
        self.run(&["config", "--get-all", "credential.helper"])
            .map(|helpers| {
                helpers
                    .lines()
                    .map(str::trim)
                    .filter(|helper| !helper.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    }

    fn credential_command(&self, verb: &str, input: &str) -> Result<()> {
        let mut child = command(&self.executable)
            .args(["credential", verb])
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "never")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not run git: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input.as_bytes())
                .map_err(|e| format!("Could not talk to git: {e}"))?;
        }
        let output = child
            .wait_with_output()
            .map_err(|e| format!("Could not run git: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(Error::Git(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Credential, request};

    #[test]
    fn writes_credential_requests_without_letting_values_add_lines() {
        assert_eq!(
            request("github.com", None).unwrap_or_default(),
            "protocol=https\nhost=github.com\n\n"
        );
        let good = Credential {
            username: "maya-chen".into(),
            password: "ghp_token".into(),
        };
        assert!(
            request("github.com", Some(&good))
                .unwrap_or_default()
                .ends_with("username=maya-chen\npassword=ghp_token\n\n")
        );
        let sneaky = Credential {
            username: "maya".into(),
            password: "token\nhost=evil.example".into(),
        };
        assert!(request("github.com", Some(&sneaky)).is_err());
    }
}
