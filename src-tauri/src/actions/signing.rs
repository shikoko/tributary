//! Signing commits with GPG or SSH in one repository, and the keys there are to sign with.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::git::Git;

/// How commits in this repository are signed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SigningMode {
    /// As git is set up for every repository.
    Usual,
    /// Never, here.
    Off,
    /// With a GPG key.
    Gpg,
    /// With an SSH key.
    Ssh,
}

/// A key commits could be signed with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SigningKey {
    /// What `user.signingkey` takes: a GPG key id, or an SSH public key's file.
    pub id: String,
    /// Who or what it is: the GPG key's user, or the SSH key's file and comment.
    pub label: String,
    pub format: SigningMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SigningSettings {
    /// What's set for this repository (`Usual` when nothing is).
    pub mode: SigningMode,
    /// Whether commits here end up signed, and how (from every level of git's config).
    pub signs: bool,
    /// "openpgp", "ssh" or "x509".
    pub format: String,
    pub key: Option<String>,
    /// The keys found: GPG's secret keys, and SSH public keys in ~/.ssh.
    pub keys: Vec<SigningKey>,
}

fn read(git: &Git, args: &[&str]) -> Option<String> {
    git.run(args)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// How commits in the repository at `path` are signed, and the keys to sign with.
pub fn signing_settings(path: &Path) -> Result<SigningSettings, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let folder = repo.workdir().unwrap_or_else(|| repo.git_dir()).to_owned();
    let git = Git::find(folder)?.in_background();
    let local = |key: &str| read(&git, &["config", "--local", "--get", key]);
    let any = |key: &str| read(&git, &["config", "--get", key]);
    let local_sign = local("commit.gpgsign").map(|value| is_true(&value));
    let local_format = local("gpg.format");
    let mode = match (local_sign, local_format.as_deref()) {
        (Some(false), _) => SigningMode::Off,
        (Some(true), Some("ssh")) => SigningMode::Ssh,
        (Some(true), _) => SigningMode::Gpg,
        (None, _) => SigningMode::Usual,
    };
    // The GPG git signs with (gpg.program), which may not be the one on the PATH.
    let program = any("gpg.program").unwrap_or_else(|| "gpg".to_owned());
    let mut keys = gpg_keys(&program);
    keys.extend(ssh_keys());
    Ok(SigningSettings {
        mode,
        signs: any("commit.gpgsign").is_some_and(|value| is_true(&value)),
        format: any("gpg.format").unwrap_or_else(|| "openpgp".to_owned()),
        key: any("user.signingkey"),
        keys,
    })
}

fn is_true(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "true" | "yes" | "on" | "1"
    )
}

/// Sign commits here with `mode`, using `key` (a GPG key id, or an SSH public key's file).
pub(super) fn set_signing(git: &Git, mode: SigningMode, key: Option<String>) -> Result<String> {
    let key = key
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty());
    // Exit code 5: it wasn't set, which is fine.
    let unset = |name: &str| {
        let _ = git.run(&["config", "--local", "--unset", name]);
    };
    match mode {
        SigningMode::Usual => {
            for name in ["commit.gpgsign", "gpg.format", "user.signingkey"] {
                unset(name);
            }
            Ok("Commits here are signed as git is set up for every repository".to_owned())
        }
        SigningMode::Off => {
            git.run(&["config", "--local", "commit.gpgsign", "false"])?;
            Ok("Commits here aren't signed".to_owned())
        }
        SigningMode::Gpg => {
            git.run(&["config", "--local", "gpg.format", "openpgp"])?;
            match &key {
                Some(key) => git.run(&["config", "--local", "user.signingkey", key])?,
                // GPG picks the key that matches the committer's email.
                None => {
                    unset("user.signingkey");
                    String::new()
                }
            };
            git.run(&["config", "--local", "commit.gpgsign", "true"])?;
            Ok(match key {
                Some(key) => format!("Commits here are signed with GPG key {key}"),
                None => "Commits here are signed with GPG, with the key for your email".to_owned(),
            })
        }
        SigningMode::Ssh => {
            let key = key.ok_or("Choose the SSH key to sign with.")?;
            // A file, unless it's the key itself ("key::ssh-ed25519 …" or "ssh-ed25519 …").
            let literal = key.starts_with("key::") || key.starts_with("ssh-");
            if !literal && !expand_home(&key).exists() {
                return Err(format!("There's no SSH key at {key}.").into());
            }
            git.run(&["config", "--local", "gpg.format", "ssh"])?;
            git.run(&["config", "--local", "user.signingkey", &key])?;
            git.run(&["config", "--local", "commit.gpgsign", "true"])?;
            Ok(format!(
                "Commits here are signed with the SSH key {}",
                key_name(&key)
            ))
        }
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), home()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

/// "id_ed25519.pub" for a key's file, or the start of a key given as text.
fn key_name(key: &str) -> String {
    let name = key.rsplit(['/', '\\']).next().unwrap_or(key);
    if name.len() > 40 {
        format!("{}…", &name[..40])
    } else {
        name.to_owned()
    }
}

/// GPG's secret keys that can sign, by `gpg --list-secret-keys --with-colons`.
fn gpg_keys(program: &str) -> Vec<SigningKey> {
    let output = crate::git::command(&expand_home(program))
        .args(["--list-secret-keys", "--with-colons", "--batch"])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            parse_gpg_keys(&String::from_utf8_lossy(&output.stdout))
        }
        _ => Vec::new(),
    }
}

fn parse_gpg_keys(listing: &str) -> Vec<SigningKey> {
    let mut keys: Vec<SigningKey> = Vec::new();
    let mut current: Option<String> = None;
    for line in listing.lines() {
        let fields: Vec<&str> = line.split(':').collect();
        match fields.first() {
            Some(&"sec") => {
                // Field 2 is its validity (e: expired, r: revoked), 12 what it can do.
                let usable = !matches!(fields.get(1), Some(&("e" | "r" | "d")));
                let can_sign = fields.get(11).is_some_and(|caps| caps.contains('S'));
                current = (usable && can_sign)
                    .then(|| fields.get(4).map(|id| (*id).to_owned()))
                    .flatten();
            }
            Some(&"uid") => {
                if let Some(id) = current.take() {
                    let user = fields.get(9).copied().unwrap_or_default();
                    keys.push(SigningKey {
                        label: user.replace("\\x3a", ":"),
                        id,
                        format: SigningMode::Gpg,
                    });
                }
            }
            _ => {}
        }
    }
    keys
}

/// The SSH public keys in ~/.ssh.
fn ssh_keys() -> Vec<SigningKey> {
    let Some(folder) = home().map(|home| home.join(".ssh")) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&folder) else {
        return Vec::new();
    };
    let mut keys: Vec<SigningKey> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "pub"))
        .filter_map(|path| {
            let text = std::fs::read_to_string(&path).ok()?;
            let mut parts = text.split_whitespace();
            let kind = parts.next()?;
            if !kind.starts_with("ssh-") && !kind.starts_with("ecdsa-") && !kind.starts_with("sk-")
            {
                return None;
            }
            let comment = parts.nth(1).unwrap_or_default();
            let file = path.file_name()?.to_string_lossy().into_owned();
            Some(SigningKey {
                id: path.to_string_lossy().into_owned(),
                label: if comment.is_empty() {
                    file
                } else {
                    format!("{file} ({comment})")
                },
                format: SigningMode::Ssh,
            })
        })
        .collect();
    keys.sort_by(|a, b| a.label.cmp(&b.label));
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_gpg_keys_that_can_sign() {
        let listing = "\
sec:u:255:22:A5EAD03C8BBDB70B:1794171624:::u:::scESC:::+:::ed25519:::0:
fpr:::::::::87D5FEE6A6B611DCD784ADCAA5EAD03C8BBDB70B:
uid:u::::1794171624::HASH::Maya Chen <maya@example.com>::::::::::0:
sec:e:255:22:1111222233334444:1694171624:::u:::scESC:::+:::ed25519:::0:
uid:e::::1694171624::HASH::Old key <old@example.com>::::::::::0:
sec:u:255:18:5555666677778888:1794171624:::u:::eE:::+:::cv25519:::0:
uid:u::::1794171624::HASH::Encrypt only <enc@example.com>::::::::::0:
";
        assert_eq!(
            parse_gpg_keys(listing),
            [SigningKey {
                id: "A5EAD03C8BBDB70B".into(),
                label: "Maya Chen <maya@example.com>".into(),
                format: SigningMode::Gpg,
            }]
        );
    }

    #[test]
    fn names_keys() {
        assert_eq!(key_name("/home/maya/.ssh/id_ed25519.pub"), "id_ed25519.pub");
        assert!(key_name("key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl").ends_with('…'));
    }
}
