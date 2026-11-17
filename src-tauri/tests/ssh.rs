//! SSH keys: listing the public halves in a folder, and making a new key with ssh-keygen.

use tributary_lib::actions::ssh::{generate_in, keys_in};

const KEY: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxQ4oTTN0iSGKNPhlrkKZHzrqLmVp7HmVi2cQ6HTFxa maya@studio-laptop\n";

#[test]
fn lists_public_keys_and_makes_new_ones() {
    let dir = std::env::temp_dir().join(format!("tributary-ssh-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("id_ed25519.pub"), KEY).unwrap();
    // A private key, a config and something that isn't a key: none of them listed.
    std::fs::write(dir.join("id_ed25519"), "PRIVATE").unwrap();
    std::fs::write(dir.join("config"), "Host *\n").unwrap();
    std::fs::write(dir.join("broken.pub"), "not a key\n").unwrap();

    let keys = keys_in(&dir);
    assert_eq!(keys.len(), 1, "{keys:?}");
    assert_eq!(
        (
            keys[0].name.as_str(),
            keys[0].kind.as_str(),
            keys[0].comment.as_str()
        ),
        ("id_ed25519", "Ed25519", "maya@studio-laptop")
    );
    assert_eq!(keys[0].public_key, KEY.trim());

    // Never over a key that's there, nor with a name that's a path.
    assert!(generate_in(&dir, "id_ed25519", "x", "").is_err());
    assert!(generate_in(&dir, "../elsewhere", "x", "").is_err());

    if std::process::Command::new("ssh-keygen")
        .arg("-?")
        .output()
        .is_err()
    {
        eprintln!("ssh-keygen isn't installed here: making a key isn't tested");
        let _ = std::fs::remove_dir_all(&dir);
        return;
    }
    let made = generate_in(&dir, "work", "maya@example.com", "").unwrap();
    assert_eq!(
        (made.kind.as_str(), made.comment.as_str()),
        ("Ed25519", "maya@example.com")
    );
    assert!(dir.join("work").exists() && dir.join("work.pub").exists());
    assert_eq!(keys_in(&dir).len(), 2);
    let _ = std::fs::remove_dir_all(&dir);
}
