//! Git LFS file locking: who has which file locked, and locking or unlocking files.
//!
//! Binary files like game assets can't be merged, so teams lock a file before editing
//! it. The locks live on the LFS server, so listing them needs the network.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::git::Git;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lock {
    pub id: String,
    /// Relative to the repository's root, with forward slashes.
    pub path: String,
    /// Who holds it: their name on the server (on GitHub, their username).
    pub owner: String,
    /// When it was locked, like "2016-05-17T15:49:06+00:00".
    pub locked_at: Option<String>,
    /// Locked by you.
    pub mine: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Locks {
    /// The repository uses Git LFS and its server supports locking. When false, there is
    /// nothing to show and no reason to ask again.
    pub supported: bool,
    /// Yours first, then by path.
    pub locks: Vec<Lock>,
    /// Why the locks couldn't be listed this time (offline, signed out, …).
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct RawLock {
    id: String,
    path: String,
    #[serde(default)]
    owner: Option<RawOwner>,
    #[serde(default)]
    locked_at: Option<String>,
}

#[derive(Deserialize)]
struct RawOwner {
    #[serde(default)]
    name: String,
}

/// `git lfs locks --verify --json`: the server tells yours from everyone else's.
#[derive(Deserialize)]
struct Verified {
    #[serde(default)]
    ours: Option<Vec<RawLock>>,
    #[serde(default)]
    theirs: Option<Vec<RawLock>>,
}

impl RawLock {
    fn into_lock(self, mine: bool) -> Lock {
        Lock {
            id: self.id,
            path: self.path.replace('\\', "/"),
            owner: self.owner.map(|owner| owner.name).unwrap_or_default(),
            locked_at: self.locked_at.filter(|time| !time.is_empty()),
            mine,
        }
    }
}

/// Whether the repository uses Git LFS: its `.gitattributes` sends files through LFS
/// or marks them lockable, or it has an `.lfsconfig`. Other repositories never ask a
/// server about locks.
pub fn uses_lfs(workdir: &Path) -> bool {
    if workdir.join(".lfsconfig").is_file() {
        return true;
    }
    std::fs::read_to_string(workdir.join(".gitattributes"))
        .is_ok_and(|text| text.contains("filter=lfs") || text.contains("lockable"))
}

/// Errors that mean locking isn't available here at all, rather than right now.
fn unsupported(error: &str) -> bool {
    let error = error.to_lowercase();
    [
        "not a git command",
        "does not support",
        "not supported",
        "not implemented",
        "not found",
        "404",
        "501",
        "unsupported",
    ]
    .iter()
    .any(|sign| error.to_string().contains(sign))
}

/// Don't pop up sign-in windows for listing locks.
const QUIET: [(&str, &str); 1] = [("GCM_INTERACTIVE", "never")];

/// What's known about servers that can't tell whose locks are whose.
#[derive(Default)]
struct State {
    /// Working trees whose server can't verify lock owners.
    without_verify: HashSet<PathBuf>,
    /// Your name on each of those servers, from the locks you made.
    my_names: HashMap<PathBuf, HashSet<String>>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Default::default);

fn without_verify(workdir: &Path) -> bool {
    STATE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .without_verify
        .contains(workdir)
}

/// After you lock a file: the server's name for you, for servers that can't verify.
pub(crate) fn remember_owner(workdir: &Path, owner: &str) {
    if owner.is_empty() {
        return;
    }
    STATE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .my_names
        .entry(workdir.to_owned())
        .or_default()
        .insert(owner.to_owned());
}

/// The owners of the locks Git LFS remembers making from this computer.
fn cached_owners(git: &Git) -> HashSet<String> {
    git.run_with_env(&["lfs", "locks", "--local", "--json"], &QUIET)
        .ok()
        .and_then(|local| parse_list(&local, true).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|lock| lock.owner)
        .collect()
}

/// Every lock, without the server's help telling yours apart: yours are those with
/// your name, as far as it's known.
fn list_all(git: &Git, workdir: &Path) -> Result<Vec<Lock>, Error> {
    let all = parse_list(
        &git.run_with_env(&["lfs", "locks", "--json"], &QUIET)?,
        false,
    )?;
    let mut names = cached_owners(git);
    if let Some(known) = STATE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .my_names
        .get(workdir)
    {
        names.extend(known.iter().cloned());
    }
    Ok(all
        .into_iter()
        .map(|lock| Lock {
            mine: names.contains(&lock.owner),
            ..lock
        })
        .collect())
}

/// The owner of a lock `git lfs lock --json` just made.
pub(crate) fn owner_of_new_lock(output: &str) -> Option<String> {
    let lock: RawLock = serde_json::from_str(output.trim()).ok()?;
    lock.owner.map(|owner| owner.name)
}

/// The locks on the repository's LFS server.
pub fn locks(path: &Path) -> Result<Locks, Error> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let Some(workdir) = repo.workdir() else {
        return Ok(Locks::default());
    };
    if !uses_lfs(workdir) {
        return Ok(Locks::default());
    }
    let git = Git::find(workdir.to_owned())?.in_background();

    let workdir = workdir.to_owned();
    let listed = if without_verify(&workdir) {
        list_all(&git, &workdir)
    } else {
        // Locks made from this computer, read before the server is asked: when the server
        // can't tell yours apart, asking it empties this list.
        let cached = cached_owners(&git);
        // The server tells yours from everyone else's. Servers that can't do that answer
        // with no locks at all, so an empty answer is checked against the plain list.
        let verified = git
            .run_with_env(&["lfs", "locks", "--verify", "--json"], &QUIET)
            .and_then(|output| parse_verified(&output));
        match verified {
            Ok(locks) if !locks.is_empty() => Ok(locks),
            verified => match list_all(&git, &workdir) {
                Ok(all) if all.is_empty() => Ok(all),
                Ok(_) => {
                    // There are locks, so the server can't verify: remember that, and
                    // that the locks made here were yours.
                    let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
                    state.without_verify.insert(workdir.clone());
                    state
                        .my_names
                        .entry(workdir.clone())
                        .or_default()
                        .extend(cached);
                    drop(state);
                    list_all(&git, &workdir)
                }
                Err(error) => {
                    if unsupported(&error.to_string())
                        || verified
                            .as_ref()
                            .is_err_and(|e| unsupported(&e.to_string()))
                    {
                        return Ok(Locks::default());
                    }
                    Err(error)
                }
            },
        }
    };
    match listed {
        Ok(mut locks) => {
            locks.sort_by(|a, b| b.mine.cmp(&a.mine).then_with(|| a.path.cmp(&b.path)));
            Ok(Locks {
                supported: true,
                locks,
                error: None,
            })
        }
        Err(error) => Ok(Locks {
            supported: true,
            locks: Vec::new(),
            error: Some(error.to_string()),
        }),
    }
}

fn parse_verified(output: &str) -> Result<Vec<Lock>, Error> {
    let verified: Verified = serde_json::from_str(output.trim())
        .map_err(|e| format!("Couldn't read the locks Git LFS listed ({e})"))?;
    let ours = verified
        .ours
        .unwrap_or_default()
        .into_iter()
        .map(|lock| lock.into_lock(true));
    let theirs = verified
        .theirs
        .unwrap_or_default()
        .into_iter()
        .map(|lock| lock.into_lock(false));
    Ok(ours.chain(theirs).collect())
}

fn parse_list(output: &str, mine: bool) -> Result<Vec<Lock>, Error> {
    let output = output.trim();
    if output.is_empty() || output == "null" {
        return Ok(Vec::new());
    }
    let locks: Vec<RawLock> = serde_json::from_str(output)
        .map_err(|e| format!("Couldn't read the locks Git LFS listed ({e})"))?;
    Ok(locks.into_iter().map(|lock| lock.into_lock(mine)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_verified_locks() {
        let output = r#"{"ours":[{"id":"1","path":"Content/Hero.uasset","owner":{"name":"maya"},"locked_at":"2026-05-17T15:49:06Z"}],"theirs":[{"id":"2","path":"Content/Map.umap","owner":{"name":"rosa"},"locked_at":"2026-05-18T09:00:00+02:00"}]}"#;
        let locks = parse_verified(output).unwrap();
        assert_eq!(locks.len(), 2);
        assert_eq!(locks[0].path, "Content/Hero.uasset");
        assert!(locks[0].mine);
        assert_eq!(locks[1].owner, "rosa");
        assert!(!locks[1].mine);
        assert_eq!(
            locks[1].locked_at.as_deref(),
            Some("2026-05-18T09:00:00+02:00")
        );
        // No locks at all: git-lfs leaves the lists out (or null).
        assert!(
            parse_verified(r#"{"ours":null,"theirs":null}"#)
                .unwrap()
                .is_empty()
        );
        assert!(parse_verified("{}").unwrap().is_empty());
    }

    #[test]
    fn reads_plain_lock_lists() {
        let output =
            r#"[{"id":"7","path":"Art\\Logo.psd","owner":{"name":"Rosa Bell"},"locked_at":""}]"#;
        let locks = parse_list(output, false).unwrap();
        assert_eq!(
            locks,
            vec![Lock {
                id: "7".into(),
                path: "Art/Logo.psd".into(),
                owner: "Rosa Bell".into(),
                locked_at: None,
                mine: false
            }]
        );
        assert!(parse_list("", false).unwrap().is_empty());
        assert!(parse_list("null\n", false).unwrap().is_empty());
        assert!(parse_list("[]", false).unwrap().is_empty());
    }

    #[test]
    fn tells_missing_locking_support_from_other_errors() {
        assert!(unsupported(
            "git: 'lfs' is not a git command. See 'git --help'."
        ));
        assert!(unsupported(
            "Remote \"origin\" does not support the LFS locking API."
        ));
        assert!(!unsupported("Could not resolve host: github.com"));
        assert!(!unsupported("Authentication required"));
    }
}
