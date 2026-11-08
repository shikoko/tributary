//! Signing commits with GPG, and checking their signatures, with throwaway keys.

#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::process::Command;

use common::{TempRepo, run};
use tributary_lib::actions::{Action, SigningMode, signing_settings};
use tributary_lib::repo::{self, SignatureStatus};

#[test]
#[cfg(unix)]
fn signs_commits_with_gpg_and_checks_them() {
    if Command::new("gpg").arg("--version").output().is_err() {
        eprintln!("skipped: GPG isn't installed");
        return;
    }
    // A short path: GPG's agent puts its socket there.
    let home = std::env::temp_dir().join(format!("trg{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let made = Command::new("gpg")
        .env("GNUPGHOME", &home)
        .args(["--batch", "--pinentry-mode", "loopback", "--passphrase", ""])
        .args([
            "--quick-gen-key",
            "Maya Chen <maya@example.com>",
            "ed25519",
            "sign",
            "never",
        ])
        .output()
        .unwrap();
    if !made.status.success() {
        eprintln!(
            "skipped: GPG couldn't make a key: {}",
            String::from_utf8_lossy(&made.stderr)
        );
        let _ = std::fs::remove_dir_all(&home);
        return;
    }
    // Git (and the app) use GPG through gpg.program: this one, with the throwaway keys.
    let wrapper = home.join("gpg.sh");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\nGNUPGHOME='{}' exec gpg \"$@\"\n",
            home.display()
        ),
    )
    .unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let result = std::panic::catch_unwind(|| check_signing(&wrapper.to_string_lossy()));
    let _ = Command::new("gpgconf")
        .env("GNUPGHOME", &home)
        .args(["--kill", "gpg-agent"])
        .status();
    let _ = std::fs::remove_dir_all(&home);
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

fn check_signing(gpg: &str) {
    let mut repo = TempRepo::new("signing");
    repo.git(&["config", "gpg.program", gpg]);
    let plain = repo.commit("a.txt", "plain");
    assert!(
        repo::details(repo.path(), &plain)
            .unwrap()
            .signature
            .is_none()
    );

    let settings = signing_settings(repo.path()).unwrap();
    assert_eq!(settings.mode, SigningMode::Usual);
    let key = settings
        .keys
        .iter()
        .find(|key| key.format == SigningMode::Gpg && key.label.contains("Maya Chen"))
        .expect("the new key is offered")
        .id
        .clone();

    let commit = |file: &str, message: &str| {
        std::fs::write(repo.path().join(file), message).unwrap();
        repo.git(&["add", file]);
        run(
            &repo,
            Action::Commit {
                message: message.into(),
                amend: false,
            },
        )
        .unwrap();
        repo.git(&["rev-parse", "HEAD"])
    };

    let message = run(
        &repo,
        Action::SetSigning {
            mode: SigningMode::Gpg,
            key: Some(key.clone()),
        },
    )
    .unwrap();
    assert!(message.contains(&key), "{message}");
    let settings = signing_settings(repo.path()).unwrap();
    assert_eq!((settings.mode, settings.signs), (SigningMode::Gpg, true));
    let signed = commit("b.txt", "Signed");
    let signature = repo::details(repo.path(), &signed)
        .unwrap()
        .signature
        .expect("signed");
    assert_eq!(signature.kind, "gpg");
    assert_eq!(signature.status, SignatureStatus::Good);
    assert!(
        signature
            .signer
            .as_deref()
            .unwrap_or_default()
            .contains("Maya Chen"),
        "{signature:?}"
    );

    // A commit changed after signing: the signature no longer matches.
    let raw = repo.git(&["cat-file", "commit", &signed]);
    let forged = raw.replace("Signed", "Forged");
    let forged_id = Command::new("git")
        .current_dir(repo.path())
        .args(["hash-object", "-t", "commit", "-w", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child.stdin.take().unwrap().write_all(
                format!("{raw}\n")
                    .replace("Signed\n", "Forged\n")
                    .as_bytes(),
            )?;
            child.wait_with_output()
        })
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap();
    assert_ne!(forged, raw);
    assert_ne!(forged_id, signed);
    let bad = repo::details(repo.path(), &forged_id)
        .unwrap()
        .signature
        .unwrap();
    assert_eq!(bad.status, SignatureStatus::Bad);

    run(
        &repo,
        Action::SetSigning {
            mode: SigningMode::Off,
            key: None,
        },
    )
    .unwrap();
    let unsigned = commit("c.txt", "Not signed");
    assert!(
        repo::details(repo.path(), &unsigned)
            .unwrap()
            .signature
            .is_none()
    );

    run(
        &repo,
        Action::SetSigning {
            mode: SigningMode::Usual,
            key: None,
        },
    )
    .unwrap();
    let local = repo.git(&["config", "--local", "--list"]);
    for key in ["commit.gpgsign", "gpg.format", "user.signingkey"] {
        assert!(!local.contains(key), "{key} left set");
    }
    let ssh = run(
        &repo,
        Action::SetSigning {
            mode: SigningMode::Ssh,
            key: Some("/nowhere/id_ed25519.pub".into()),
        },
    );
    assert!(ssh.unwrap_err().contains("no SSH key"));
}
