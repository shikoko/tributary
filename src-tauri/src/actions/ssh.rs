//! The SSH keys git uses to reach remotes over SSH: the public halves in `~/.ssh` (the
//! private ones are never read), a new key made with `ssh-keygen`, and whether a host like
//! github.com accepts a key (`ssh -T`).

use std::path::{Path, PathBuf};
use std::process::Command;

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::error::{Error, Result};

/// An SSH key, by its public half.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    /// Its file's name, without ".pub", like "id_ed25519".
    pub name: String,
    /// The public key's file.
    pub path: String,
    /// Like "Ed25519" or "RSA".
    pub kind: String,
    /// What it says about itself, often who made it where ("maya@studio-laptop").
    pub comment: String,
    /// Like "SHA256:q0mB4c…", as `ssh-keygen -l` and GitHub show it.
    pub fingerprint: String,
    /// The whole public key, to add to GitHub or GitLab.
    pub public_key: String,
}

/// Whether a host let a key in, and as whom.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SshCheck {
    pub host: String,
    pub accepted: bool,
    /// The account the host knows the key as, like "maya-chen".
    pub user: Option<String>,
    /// What the host said, for when it's neither.
    pub message: String,
}

/// The folder the keys are in: `~/.ssh` (or `TRIBUTARY_SSH_DIR`, for the preview and tests).
pub fn ssh_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("TRIBUTARY_SSH_DIR") {
        return Some(PathBuf::from(dir));
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| PathBuf::from(home).join(".ssh"))
}

/// The key a public key's line describes, or None when it isn't one.
pub fn read_key(name: &str, path: &Path, line: &str) -> Option<SshKey> {
    let mut parts = line.split_whitespace();
    let kind = parts.next()?;
    let blob = parts.next()?;
    let label = match kind {
        "ssh-ed25519" => "Ed25519",
        "ssh-rsa" => "RSA",
        "ssh-dss" => "DSA",
        "sk-ssh-ed25519@openssh.com" => "Ed25519 (security key)",
        "sk-ecdsa-sha2-nistp256@openssh.com" => "ECDSA (security key)",
        other if other.starts_with("ecdsa-sha2-") => "ECDSA",
        _ => return None,
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(blob)
        .ok()?;
    let digest = Sha256::digest(&bytes);
    let fingerprint = format!(
        "SHA256:{}",
        base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest)
    );
    Some(SshKey {
        name: name.to_owned(),
        path: path.to_string_lossy().into_owned(),
        kind: label.to_owned(),
        comment: parts.collect::<Vec<_>>().join(" "),
        fingerprint,
        public_key: line.trim().to_owned(),
    })
}

/// The SSH keys in `dir`, by their public halves, by name.
pub fn keys_in(dir: &Path) -> Vec<SshKey> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut keys: Vec<SshKey> = entries
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "pub"))
        .filter_map(|path| {
            let text = std::fs::read_to_string(&path).ok()?;
            let name = path.file_stem()?.to_string_lossy().into_owned();
            read_key(&name, &path, text.lines().next()?)
        })
        .collect();
    keys.sort_by(|a, b| a.name.cmp(&b.name));
    keys
}

/// The SSH keys in `~/.ssh`.
pub fn ssh_keys() -> Vec<SshKey> {
    ssh_dir().map(|dir| keys_in(&dir)).unwrap_or_default()
}

/// Whether `name` can be a key's file name: letters, digits, dots, dashes and underscores.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// Make a new Ed25519 key called `name` in `dir` with `ssh-keygen`, with `comment` on it and
/// `passphrase` (empty for none) to unlock it. Never replaces a key already there.
pub fn generate_in(dir: &Path, name: &str, comment: &str, passphrase: &str) -> Result<SshKey> {
    if !valid_name(name) {
        return Err("A key's name can have letters, numbers, dots, dashes and underscores.".into());
    }
    let private = dir.join(name);
    let public = dir.join(format!("{name}.pub"));
    if private.exists() || public.exists() {
        return Err(format!("There's already a key called {name}: choose another name.").into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    let output = Command::new("ssh-keygen")
        .args(["-q", "-t", "ed25519", "-C", comment, "-N", passphrase, "-f"])
        .arg(&private)
        .output()
        .map_err(|e| format!("Could not run ssh-keygen (is OpenSSH installed?): {e}"))?;
    if !output.status.success() {
        return Err(Error::from(format!(
            "ssh-keygen could not make the key: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let text =
        std::fs::read_to_string(&public).map_err(|e| format!("Could not read the new key: {e}"))?;
    read_key(name, &public, text.lines().next().unwrap_or_default())
        .ok_or_else(|| "ssh-keygen made a key Tributary can't read.".into())
}

/// Make a new key in `~/.ssh`.
pub fn generate_ssh_key(name: &str, comment: &str, passphrase: &str) -> Result<SshKey> {
    let dir = ssh_dir().ok_or("Could not find your home folder.")?;
    generate_in(&dir, name, comment, passphrase)
}

/// What a host's greeting says about who it let in: "Hi maya-chen! You've successfully
/// authenticated…" (GitHub), "Welcome to GitLab, @maya!" (GitLab), or a refusal.
pub fn read_greeting(host: &str, said: &str) -> SshCheck {
    let user = said
        .split_once("Hi ")
        .and_then(|(_, rest)| rest.split_once('!'))
        .map(|(user, _)| user.trim().to_owned())
        .or_else(|| {
            said.split_once("Welcome to GitLab, @")
                .and_then(|(_, rest)| rest.split_once('!'))
                .map(|(user, _)| user.trim().to_owned())
        })
        .filter(|user| !user.is_empty() && !user.contains(char::is_whitespace));
    let accepted = user.is_some() || said.contains("successfully authenticated");
    SshCheck {
        host: host.to_owned(),
        accepted,
        user,
        message: said.trim().lines().last().unwrap_or_default().to_owned(),
    }
}

/// Whether `host` (like "github.com") lets the key at `public_key` (its .pub file) in, by
/// connecting as git with only that key. The private half is used by ssh, not read here.
pub fn check_ssh_key(host: &str, public_key: &str) -> Result<SshCheck> {
    if host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
    {
        return Err("That isn't a host name.".into());
    }
    let private = public_key
        .strip_suffix(".pub")
        .ok_or("That isn't a public key's file.")?;
    let output = Command::new("ssh")
        .args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "IdentitiesOnly=yes",
            "-i",
            private,
            &format!("git@{host}"),
        ])
        .output()
        .map_err(|e| format!("Could not run ssh (is OpenSSH installed?): {e}"))?;
    let said = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(read_greeting(host, &said))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxQ4oTTN0iSGKNPhlrkKZHzrqLmVp7HmVi2cQ6HTFxa maya@studio-laptop";

    #[test]
    fn reads_a_public_key() {
        let key = read_key(
            "id_ed25519",
            Path::new("/home/maya/.ssh/id_ed25519.pub"),
            KEY,
        )
        .unwrap();
        assert_eq!(key.kind, "Ed25519");
        assert_eq!(key.comment, "maya@studio-laptop");
        assert!(
            key.fingerprint.starts_with("SHA256:"),
            "{}",
            key.fingerprint
        );
        assert_eq!(key.fingerprint.len(), "SHA256:".len() + 43);
        assert!(read_key("x", Path::new("x.pub"), "not a key").is_none());
        assert!(read_key("x", Path::new("x.pub"), "ssh-ed25519 !!!").is_none());
    }

    #[test]
    fn reads_who_a_host_let_in() {
        let github = read_greeting(
            "github.com",
            "Hi maya-chen! You've successfully authenticated, but GitHub does not provide shell access.",
        );
        assert_eq!(
            (github.accepted, github.user.as_deref()),
            (true, Some("maya-chen"))
        );
        let gitlab = read_greeting("gitlab.com", "Welcome to GitLab, @mchen!");
        assert_eq!(gitlab.user.as_deref(), Some("mchen"));
        let refused = read_greeting(
            "github.com",
            "git@github.com: Permission denied (publickey).",
        );
        assert!(!refused.accepted && refused.user.is_none());
        assert_eq!(
            refused.message,
            "git@github.com: Permission denied (publickey)."
        );
    }

    #[test]
    fn checks_key_names() {
        assert!(valid_name("id_ed25519"));
        assert!(valid_name("work-2026.key"));
        assert!(!valid_name("../id"));
        assert!(!valid_name(".hidden"));
        assert!(!valid_name("a b"));
    }
}
