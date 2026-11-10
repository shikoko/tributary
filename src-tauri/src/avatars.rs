//! Profile pictures for commit authors, when they're switched on. Looked up by email
//! address, in order:
//!
//! 1. GitHub's `noreply` addresses name the account directly.
//! 2. For a repository on GitHub, GitHub knows which account each commit's email belongs
//!    to (it answers with the account's picture), even when the email isn't public.
//! 3. For a repository on GitLab, its server's avatar lookup.
//! 4. Gravatar, by a hash of the address.
//!
//! The pictures are downloaded here and handed to the interface as `data:` URLs, so the
//! page itself never talks to these sites. The answers are kept for the session, and on
//! this computer for a week (in the app's cache folder, by a hash of each address), so the
//! pictures show at once the next time: older ones show while they're asked for again.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::git::Git;
use crate::github::{self, api_request, client};
use crate::gitlab::{self, encode_path};

/// Pictures bigger than this aren't used.
const MAX_BYTES: usize = 256 * 1024;
/// At most this many authors are looked up one by one on GitHub per call (with a token).
const MAX_GITHUB_LOOKUPS: usize = 30;
/// Pictures downloaded at once.
const PARALLEL: usize = 8;
/// The size asked for: enough for the details panel on a high-density screen.
const SIZE: u32 = 80;

/// What's known about an address: its picture as a `data:` URL, or that it has none.
static PICTURES: LazyLock<Mutex<HashMap<String, Option<String>>>> = LazyLock::new(Default::default);
/// Email address → the picture address of its GitHub account, or None for an address
/// GitHub doesn't know.
type Accounts = HashMap<String, Option<String>>;
/// The accounts known per GitHub repository ("owner/name").
static GITHUB_AUTHORS: LazyLock<Mutex<HashMap<String, Accounts>>> = LazyLock::new(Default::default);

/// Where the pictures are kept between sessions (none in the browser preview).
static KEPT_IN: OnceLock<PathBuf> = OnceLock::new();
/// Kept pictures are asked for again once they're this old (and shown meanwhile).
const FRESH_FOR: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// Keep the pictures in `folder` between sessions.
pub fn keep_in(folder: PathBuf) {
    let _ = KEPT_IN.set(folder);
}

/// The file an address's picture is kept in: named by a hash, so the folder doesn't list
/// email addresses.
fn kept_file(address: &str) -> Option<PathBuf> {
    let hash = Sha256::digest(address.as_bytes());
    let name: String = hash.iter().map(|byte| format!("{byte:02x}")).collect();
    Some(KEPT_IN.get()?.join(name))
}

/// The picture kept for an address (None inside: it has none), and whether it's still fresh.
fn from_disk(address: &str) -> Option<(Option<String>, bool)> {
    let file = kept_file(address)?;
    let text = std::fs::read_to_string(&file).ok()?;
    let fresh = std::fs::metadata(&file)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age < FRESH_FOR);
    let picture = Some(text).filter(|text| text.starts_with("data:image/"));
    Some((picture, fresh))
}

fn to_disk(address: &str, picture: &Option<String>) {
    let Some(file) = kept_file(address) else {
        return;
    };
    if let Some(folder) = file.parent() {
        let _ = std::fs::create_dir_all(folder);
    }
    let _ = std::fs::write(file, picture.as_deref().unwrap_or(""));
}

/// Forget every kept picture (when profile pictures are turned off).
pub fn forget() {
    PICTURES.lock().unwrap_or_else(|e| e.into_inner()).clear();
    if let Some(folder) = KEPT_IN.get() {
        let _ = std::fs::remove_dir_all(folder);
    }
}

fn known(email: &str) -> Option<Option<String>> {
    PICTURES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(email)
        .cloned()
}

/// The pictures of these authors (by email address, as given), or None for those without one.
pub async fn avatars(path: &Path, emails: Vec<String>) -> Result<HashMap<String, Option<String>>> {
    let requests: Vec<(String, String)> = emails
        .into_iter()
        .map(|email| {
            let address = email.trim().to_lowercase();
            (email, address)
        })
        .collect();
    let mut missing: Vec<String> = Vec::new();
    let mut stale: Vec<String> = Vec::new();
    for (_, address) in &requests {
        if !address.contains('@') || known(address).is_some() || missing.contains(address) {
            continue;
        }
        match from_disk(address) {
            Some((picture, fresh)) => {
                PICTURES
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(address.clone(), picture);
                if !fresh {
                    stale.push(address.clone());
                }
            }
            None => missing.push(address.clone()),
        }
    }
    if !missing.is_empty() {
        look_up(path, &missing).await?;
    }
    // Old pictures show now, and are asked for again in the background for next time.
    if !stale.is_empty() {
        let path = path.to_owned();
        tauri::async_runtime::spawn(async move {
            let _ = look_up(&path, &stale).await;
        });
    }
    // Whatever is still unknown (a download that failed) shows initials for now.
    Ok(requests
        .into_iter()
        .map(|(email, address)| (email, known(&address).flatten()))
        .collect())
}

/// Where the repository's remotes are hosted, and the tokens git keeps for them.
struct Forges {
    github: Option<(String, Option<String>)>,
    gitlab: Option<String>,
}

async fn look_up(path: &Path, addresses: &[String]) -> Result<()> {
    let path = path.to_owned();
    let forges = tauri::async_runtime::spawn_blocking(move || {
        let git = Git::find(path.clone()).ok();
        let token = |host: &str| git.as_ref().and_then(|git| git.stored_password(host));
        let github = github::github_repository(&path)
            .ok()
            .flatten()
            .map(|(_, full_name)| (full_name, token(github::HOST)));
        let gitlab = gitlab::gitlab_project(&path)
            .ok()
            .flatten()
            .map(|project| project.api);
        Forges { github, gitlab }
    })
    .await
    .map_err(|e| Error::Message(e.to_string()))?;

    let client = client()?;
    let from_github = match &forges.github {
        Some((full_name, token)) => {
            github_accounts(&client, full_name, token.as_deref(), addresses).await
        }
        None => HashMap::new(),
    };

    // Each address's candidates, tried in order, a few addresses at a time.
    let mut queue: Vec<(String, Vec<String>)> = Vec::new();
    for address in addresses {
        let mut candidates = Vec::new();
        if let Some(url) = noreply_picture(address) {
            candidates.push(url);
        }
        if let Some(url) = from_github.get(address).cloned().flatten() {
            candidates.push(sized(&url));
        }
        if let Some(api) = &forges.gitlab
            && let Some(url) = gitlab_picture(&client, api, address).await
        {
            candidates.push(url);
        }
        candidates.push(gravatar(address));
        queue.push((address.clone(), candidates));
    }
    for batch in queue.chunks(PARALLEL) {
        let tasks: Vec<_> = batch
            .iter()
            .cloned()
            .map(|(address, candidates)| {
                let client = client.clone();
                tauri::async_runtime::spawn(async move {
                    (address, first_picture(&client, &candidates).await)
                })
            })
            .collect();
        for task in tasks {
            let Ok((address, found)) = task.await else {
                continue;
            };
            // A download that failed (offline, say) is tried again next time.
            if let Some(found) = found {
                to_disk(&address, &found);
                PICTURES
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(address, found);
            }
        }
    }
    Ok(())
}

/// GitHub's `noreply` addresses: `123+name@users.noreply.github.com` or `name@…`.
fn noreply_picture(address: &str) -> Option<String> {
    let user = address.strip_suffix("@users.noreply.github.com")?;
    Some(match user.split_once('+') {
        Some((id, _)) if id.chars().all(|c| c.is_ascii_digit()) => {
            format!("https://avatars.githubusercontent.com/u/{id}?s={SIZE}&v=4")
        }
        _ => format!("https://github.com/{}.png?size={SIZE}", encode_path(user)),
    })
}

/// GitHub's picture addresses, at the size wanted.
fn sized(url: &str) -> String {
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{url}{separator}s={SIZE}")
}

fn gravatar(address: &str) -> String {
    let hash: String = Sha256::digest(address.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    // d=404: no picture rather than a made-up one.
    format!("https://www.gravatar.com/avatar/{hash}?s={SIZE}&d=404")
}

#[derive(Deserialize)]
struct RawCommit {
    commit: RawCommitInfo,
    author: Option<RawAccount>,
    committer: Option<RawAccount>,
}

#[derive(Deserialize)]
struct RawCommitInfo {
    author: Option<RawPerson>,
    committer: Option<RawPerson>,
}

#[derive(Deserialize)]
struct RawPerson {
    email: Option<String>,
}

#[derive(Deserialize)]
struct RawAccount {
    avatar_url: Option<String>,
}

/// The accounts behind the email addresses of a page of commits.
fn accounts_of(commits: Vec<RawCommit>) -> Accounts {
    let mut found = HashMap::new();
    for commit in commits {
        let pairs = [
            (commit.commit.author, commit.author),
            (commit.commit.committer, commit.committer),
        ];
        for (person, account) in pairs {
            let Some(email) = person.and_then(|person| person.email) else {
                continue;
            };
            let picture = account.and_then(|account| account.avatar_url);
            // GitHub's own web commits are committed by "GitHub": not a person to show.
            if email == "noreply@github.com" {
                continue;
            }
            let entry = found.entry(email.to_lowercase()).or_insert(None);
            if entry.is_none() {
                *entry = picture;
            }
        }
    }
    found
}

/// The GitHub account picture of each address, as far as GitHub knows them: from the
/// latest commits (one request), then, with a token, by asking for each remaining
/// author's latest commit.
async fn github_accounts(
    client: &reqwest::Client,
    full_name: &str,
    token: Option<&str>,
    addresses: &[String],
) -> Accounts {
    let cached = |address: &str| -> Option<Option<String>> {
        GITHUB_AUTHORS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(full_name)
            .and_then(|authors| authors.get(address).cloned())
    };
    let remember = |found: Accounts| {
        GITHUB_AUTHORS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(full_name.to_owned())
            .or_default()
            .extend(found);
    };
    let fetch = |url: String| async move {
        let response = api_request(client, url, token).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.json::<Vec<RawCommit>>().await.ok()
    };

    let first_time = !GITHUB_AUTHORS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains_key(full_name);
    if first_time {
        let url = format!("https://api.github.com/repos/{full_name}/commits?per_page=100");
        remember(fetch(url).await.map(accounts_of).unwrap_or_default());
    }
    // Without a token GitHub allows few requests an hour: the first page has to do.
    if token.is_some() {
        let unknown: Vec<&String> = addresses
            .iter()
            .filter(|address| noreply_picture(address).is_none() && cached(address).is_none())
            .take(MAX_GITHUB_LOOKUPS)
            .collect();
        for address in unknown {
            let url = format!(
                "https://api.github.com/repos/{full_name}/commits?author={}&per_page=1",
                encode_path(address)
            );
            let mut found = fetch(url).await.map(accounts_of).unwrap_or_default();
            let picture = found.remove(address.as_str()).flatten();
            remember(HashMap::from([(address.clone(), picture)]));
        }
    }
    addresses
        .iter()
        .filter_map(|address| Some((address.clone(), cached(address)?)))
        .collect()
}

#[derive(Deserialize)]
struct RawGitLabAvatar {
    avatar_url: Option<String>,
}

/// The picture of a GitLab user with this public address. GitLab answers with a Gravatar
/// address for everyone else, which is left to the Gravatar lookup.
async fn gitlab_picture(client: &reqwest::Client, api: &str, address: &str) -> Option<String> {
    // `api` is the project's address: the avatar lookup is at the API's root.
    let root = api.split("/projects/").next()?;
    let url = format!("{root}/avatar?email={}&size={SIZE}", encode_path(address));
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let url = response.json::<RawGitLabAvatar>().await.ok()?.avatar_url?;
    (!url.contains("gravatar.com")).then_some(url)
}

/// The first of `candidates` that's a picture: Some(Some(data URL)) for one, Some(None)
/// when none of them is, None when a download failed (so it's worth trying again later).
async fn first_picture(client: &reqwest::Client, candidates: &[String]) -> Option<Option<String>> {
    let mut failed = false;
    for url in candidates {
        match download(client, url).await {
            Ok(Some(picture)) => return Some(Some(picture)),
            Ok(None) => {}
            Err(()) => failed = true,
        }
    }
    (!failed).then_some(None)
}

/// The picture at `url` (an account's own, say), as a `data:` URL, kept for the session.
/// None when there's no picture there or it couldn't be fetched (asked again next time).
pub(crate) async fn picture_at(url: &str) -> Option<String> {
    static KNOWN: LazyLock<Mutex<HashMap<String, Option<String>>>> =
        LazyLock::new(Default::default);
    if !url.starts_with("https://") {
        return None;
    }
    if let Some(known) = KNOWN.lock().ok()?.get(url) {
        return known.clone();
    }
    let found = download(&client().ok()?, url).await.ok()?;
    KNOWN.lock().ok()?.insert(url.to_owned(), found.clone());
    found
}

/// A picture as a `data:` URL; Ok(None) when there's none there, Err when it couldn't be asked.
async fn download(client: &reqwest::Client, url: &str) -> std::result::Result<Option<String>, ()> {
    let response = client.get(url).send().await.map_err(|_| ())?;
    let status = response.status();
    if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(());
    }
    if !status.is_success() {
        return Ok(None);
    }
    let kind = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_owned();
    if !kind.starts_with("image/") || kind.contains("svg") {
        return Ok(None);
    }
    let bytes = response.bytes().await.map_err(|_| ())?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Ok(None);
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:{kind};base64,{encoded}")))
}

#[cfg(test)]
mod tests {
    #[test]
    fn keeps_pictures_on_disk_by_a_hash_and_forgets_them() {
        let folder = std::env::temp_dir().join(format!("tributary-avatars-{}", std::process::id()));
        keep_in(folder.clone());
        let picture = Some("data:image/png;base64,AAAA".to_owned());
        to_disk("rosa@example.com", &picture);
        to_disk("nobody@example.com", &None);
        assert_eq!(from_disk("rosa@example.com"), Some((picture, true)));
        assert_eq!(from_disk("nobody@example.com"), Some((None, true)));
        assert_eq!(from_disk("theo@example.com"), None);
        // The folder doesn't list the addresses.
        let names: Vec<String> = std::fs::read_dir(&folder)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            names
                .iter()
                .all(|name| name.len() == 64 && !name.contains('@')),
            "{names:?}"
        );
        forget();
        assert!(!folder.exists());
    }

    use super::*;

    #[test]
    fn knows_github_noreply_addresses() {
        assert_eq!(
            noreply_picture("123+maya@users.noreply.github.com").as_deref(),
            Some("https://avatars.githubusercontent.com/u/123?s=80&v=4")
        );
        assert_eq!(
            noreply_picture("maya@users.noreply.github.com").as_deref(),
            Some("https://github.com/maya.png?size=80")
        );
        assert_eq!(noreply_picture("maya@example.com"), None);
    }

    #[test]
    fn hashes_addresses_for_gravatar() {
        assert_eq!(
            gravatar("maya@example.com"),
            "https://www.gravatar.com/avatar/a813d5642c0c2fea0799d8b05fdb19dfe01ed1ebdf511c861d8c079ac655c9e6?s=80&d=404"
        );
    }

    #[test]
    fn finds_accounts_behind_commit_emails() {
        let commits: Vec<RawCommit> = serde_json::from_str(
            r#"[
              {"commit": {"author": {"email": "Maya@Example.com"}, "committer": {"email": "noreply@github.com"}},
               "author": {"avatar_url": "https://avatars.githubusercontent.com/u/1?v=4"},
               "committer": {"avatar_url": "https://avatars.githubusercontent.com/u/19864447?v=4"}},
              {"commit": {"author": {"email": "sam@example.com"}, "committer": {"email": "sam@example.com"}},
               "author": null, "committer": null}
            ]"#,
        )
        .unwrap();
        let found = accounts_of(commits);
        assert_eq!(
            found.get("maya@example.com"),
            Some(&Some(
                "https://avatars.githubusercontent.com/u/1?v=4".to_owned()
            ))
        );
        // Known to have no account.
        assert_eq!(found.get("sam@example.com"), Some(&None));
        assert!(!found.contains_key("noreply@github.com"));
        assert_eq!(
            sized("https://avatars.githubusercontent.com/u/1?v=4"),
            "https://avatars.githubusercontent.com/u/1?v=4&s=80"
        );
    }
}
