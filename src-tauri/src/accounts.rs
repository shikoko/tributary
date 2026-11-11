//! Your repositories on GitHub and GitLab, to clone one from a list, and signing in to
//! GitLab (GitHub's sign-in is in [`crate::github::account`]). As there, the token is
//! git's: checked with the server, then kept by git's credential helper, so cloning and
//! pushing use it too. Tributary never stores it itself.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::git::{Credential, Git};
use crate::github;

/// How long to wait for a stored token.
const LOOKUP: Duration = Duration::from_secs(10);
/// How long to wait for the user to sign in with Git Credential Manager.
const BROWSER_SIGN_IN: Duration = Duration::from_secs(300);
/// At most this many pages of repositories (100 each) are listed.
const MOST_PAGES: u32 = 3;

/// One of your repositories, on GitHub or GitLab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AccountRepo {
    /// "GitHub" or "GitLab".
    pub forge: String,
    /// The user or organization (a GitLab group, with its subgroups) it belongs to.
    pub owner: String,
    pub name: String,
    pub description: Option<String>,
    pub private: bool,
    /// When it last changed, as the server says it (ISO 8601).
    pub updated: String,
    /// The address to clone it from (HTTPS).
    pub url: String,
}

fn git() -> Result<Git> {
    Ok(Git::find(std::env::temp_dir())?.in_background())
}

/// The token git keeps for `https://{host}`, if it keeps one.
async fn stored_token(host: &str) -> Result<Option<String>> {
    let host = host.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(git()?
            .fill_credential(&host, false, LOOKUP)
            .map(|credential| credential.password))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
struct RawGitHubRepo {
    name: String,
    owner: RawGitHubOwner,
    description: Option<String>,
    private: bool,
    pushed_at: Option<String>,
    updated_at: String,
    clone_url: String,
}

#[derive(Deserialize)]
struct RawGitHubOwner {
    login: String,
}

/// Your repositories on GitHub (yours, your organizations' and those you collaborate on),
/// the most recently pushed first. Empty when you aren't signed in.
pub async fn github_repositories() -> Result<Vec<AccountRepo>> {
    let Some(token) = stored_token(github::HOST).await? else {
        return Ok(Vec::new());
    };
    let client = github::client()?;
    let mut repos = Vec::new();
    for page in 1..=MOST_PAGES {
        let url = format!("https://api.github.com/user/repos?per_page=100&sort=pushed&page={page}");
        let response = github::api_request(&client, url, Some(&token))
            .send()
            .await
            .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
        if !response.status().is_success() {
            return Err(format!(
                "GitHub didn't list your repositories ({}).",
                response.status().as_u16()
            )
            .into());
        }
        let raw: Vec<RawGitHubRepo> = response
            .json()
            .await
            .map_err(|e| format!("Couldn't read GitHub's answer ({e})"))?;
        let full = raw.len() == 100;
        repos.extend(raw.into_iter().map(|repo| AccountRepo {
            forge: "GitHub".into(),
            owner: repo.owner.login,
            name: repo.name,
            description: repo.description.filter(|text| !text.trim().is_empty()),
            private: repo.private,
            updated: repo.pushed_at.unwrap_or(repo.updated_at),
            url: repo.clone_url,
        }));
        if !full {
            break;
        }
    }
    Ok(repos)
}

/// A GitLab user.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GitLabAccount {
    pub username: String,
    #[serde(default)]
    pub name: Option<String>,
    /// Where the server keeps the account's picture (maybe Gravatar).
    #[serde(default, rename(deserialize = "avatar_url"), skip_serializing)]
    pub avatar_url: Option<String>,
    /// The account's picture, as a `data:` URL (for showing who's signed in).
    #[serde(default, skip_deserializing)]
    pub picture: Option<String>,
}

/// Who's signed in to a GitLab server, and how one can sign in.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GitLabStatus {
    /// Like "gitlab.com".
    pub host: String,
    pub account: Option<GitLabAccount>,
    /// Git keeps a token that the server no longer accepts.
    pub token_rejected: bool,
    /// Git can keep a token: it has a credential helper.
    pub can_keep_token: bool,
    /// Git Credential Manager is set up, so signing in can happen in the browser.
    pub browser_sign_in: bool,
}

/// "https://GitLab.example.com/" → "gitlab.example.com": the server's name (and port), or an
/// error when it isn't one.
pub fn gitlab_host(input: &str) -> Result<String> {
    let host = input.trim();
    let host = host
        .strip_prefix("https://")
        .or_else(|| host.strip_prefix("http://"))
        .unwrap_or(host);
    let host = host.trim_end_matches('/').to_ascii_lowercase();
    let (name, port) = match host.split_once(':') {
        Some((name, port)) => (name, Some(port)),
        None => (host.as_str(), None),
    };
    let name_ok = !name.is_empty()
        && name.split('.').all(|part| {
            !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        });
    let port_ok = port.is_none_or(|port| {
        !port.is_empty() && port.len() <= 5 && port.chars().all(|c| c.is_ascii_digit())
    });
    if name_ok && port_ok {
        Ok(host)
    } else {
        Err(Error::Message(
            "That isn't a server's name: type it like gitlab.com or gitlab.example.com.".into(),
        ))
    }
}

/// A GET from a GitLab server's API, with a personal access token (GitLab's own header) or
/// an OAuth token (which Git Credential Manager keeps), as a bearer token.
async fn gitlab_get(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    bearer: bool,
) -> Result<reqwest::Response> {
    let request = client.get(url);
    let request = if bearer {
        request.bearer_auth(token)
    } else {
        request.header("PRIVATE-TOKEN", token)
    };
    request
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitLab ({e})").into())
}

/// Who `token` belongs to on `host`, and whether it's sent as a bearer token; None if the
/// server accepts it neither way.
async fn gitlab_user(
    client: &reqwest::Client,
    host: &str,
    token: &str,
) -> Result<Option<(GitLabAccount, bool)>> {
    let url = format!("https://{host}/api/v4/user");
    for bearer in [false, true] {
        let response = gitlab_get(client, &url, token, bearer).await?;
        match response.status().as_u16() {
            200..=299 => {
                let account = response
                    .json()
                    .await
                    .map_err(|e| format!("Couldn't read GitLab's answer ({e})"))?;
                return Ok(Some((account, bearer)));
            }
            401 => continue,
            status => return Err(format!("{host} answered with an error ({status}).").into()),
        }
    }
    Ok(None)
}

/// Who's signed in to the GitLab server `host`, going by the token git keeps for it.
pub async fn gitlab_status(host: &str) -> Result<GitLabStatus> {
    let host = gitlab_host(host)?;
    let lookup = host.clone();
    let (stored, helpers) = tauri::async_runtime::spawn_blocking(move || {
        let git = git()?;
        Ok::<_, Error>((
            git.fill_credential(&lookup, false, LOOKUP),
            git.credential_helpers(),
        ))
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut account = match &stored {
        Some(credential) => gitlab_user(&github::client()?, &host, &credential.password)
            .await?
            .map(|(account, _)| account),
        None => None,
    };
    // The picture: what the account's chip shows.
    if let Some(account) = account.as_mut()
        && let Some(url) = &account.avatar_url
    {
        account.picture = crate::avatars::picture_at(url).await;
    }
    Ok(GitLabStatus {
        token_rejected: stored.is_some() && account.is_none(),
        account,
        host,
        can_keep_token: !helpers.is_empty(),
        browser_sign_in: helpers
            .iter()
            .any(|helper| github::account::is_credential_manager(helper)),
    })
}

/// Sign in to the GitLab server `host` with a personal access token: check it, then keep it.
pub async fn gitlab_sign_in(host: &str, token: &str) -> Result<GitLabAccount> {
    let host = gitlab_host(host)?;
    let token = token.trim().to_owned();
    if token.is_empty() || token.contains(char::is_whitespace) {
        return Err("Paste the token GitLab made for you.".into());
    }
    let (account, _) = gitlab_user(&github::client()?, &host, &token)
        .await?
        .ok_or(
            "GitLab didn't accept that token. Check that it was copied whole and hasn't expired.",
        )?;
    let username = account.username.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let git = git()?;
        let credential = Credential {
            username,
            password: token.clone(),
        };
        // A token kept from before would be found first: forget it.
        git.reject_credential(&host)?;
        git.approve_credential(&host, &credential)?;
        // Without a credential helper, git keeps nothing, and says nothing about it.
        let kept = git.fill_credential(&host, false, LOOKUP);
        if kept.is_none_or(|kept| kept.password != token) {
            return Err(Error::Message(
                "Git has nowhere safe to keep the token: set up a credential helper, like Git Credential Manager (https://gh.io/gcm), and try again.".into(),
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(account)
}

/// Sign in to the GitLab server `host` with Git Credential Manager, which opens its sign-in
/// page in the browser.
pub async fn gitlab_sign_in_with_browser(host: &str) -> Result<GitLabAccount> {
    let host = gitlab_host(host)?;
    let lookup = host.clone();
    let credential = tauri::async_runtime::spawn_blocking(move || {
        git()?
            .fill_credential(&lookup, true, BROWSER_SIGN_IN)
            .ok_or_else(|| Error::Message("Signing in didn't finish.".into()))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (account, _) = gitlab_user(&github::client()?, &host, &credential.password)
        .await?
        .ok_or("GitLab didn't accept the sign-in. Try again.")?;
    tauri::async_runtime::spawn_blocking(move || git()?.approve_credential(&host, &credential))
        .await
        .map_err(|e| e.to_string())??;
    Ok(account)
}

/// Forget the token git keeps for the GitLab server `host`.
pub fn gitlab_sign_out(host: &str) -> Result<()> {
    git()?.reject_credential(&gitlab_host(host)?)
}

#[derive(Deserialize)]
struct RawGitLabProject {
    path: String,
    namespace: RawGitLabNamespace,
    description: Option<String>,
    #[serde(default)]
    visibility: Option<String>,
    last_activity_at: String,
    http_url_to_repo: String,
}

#[derive(Deserialize)]
struct RawGitLabNamespace {
    full_path: String,
}

/// Your projects on the GitLab server `host` (those you're a member of), the most recently
/// active first. Empty when you aren't signed in there.
pub async fn gitlab_repositories(host: &str) -> Result<Vec<AccountRepo>> {
    let host = gitlab_host(host)?;
    let Some(token) = stored_token(&host).await? else {
        return Ok(Vec::new());
    };
    let client = github::client()?;
    let Some((_, bearer)) = gitlab_user(&client, &host, &token).await? else {
        return Ok(Vec::new());
    };
    let mut repos = Vec::new();
    for page in 1..=MOST_PAGES {
        let url = format!(
            "https://{host}/api/v4/projects?membership=true&archived=false&order_by=last_activity_at&sort=desc&per_page=100&page={page}"
        );
        let response = gitlab_get(&client, &url, &token, bearer).await?;
        if !response.status().is_success() {
            return Err(format!(
                "GitLab didn't list your projects ({}).",
                response.status().as_u16()
            )
            .into());
        }
        let raw: Vec<RawGitLabProject> = response
            .json()
            .await
            .map_err(|e| format!("Couldn't read GitLab's answer ({e})"))?;
        let full = raw.len() == 100;
        repos.extend(raw.into_iter().map(|project| AccountRepo {
            forge: "GitLab".into(),
            owner: project.namespace.full_path,
            name: project.path,
            description: project.description.filter(|text| !text.trim().is_empty()),
            private: project.visibility.as_deref() != Some("public"),
            updated: project.last_activity_at,
            url: project.http_url_to_repo,
        }));
        if !full {
            break;
        }
    }
    Ok(repos)
}

#[cfg(test)]
mod tests {
    use super::gitlab_host;

    #[test]
    fn reads_a_gitlab_servers_name() {
        assert_eq!(gitlab_host("gitlab.com").unwrap(), "gitlab.com");
        assert_eq!(
            gitlab_host(" https://GitLab.Example.com/ ").unwrap(),
            "gitlab.example.com"
        );
        assert_eq!(
            gitlab_host("gitlab.example.com:8443").unwrap(),
            "gitlab.example.com:8443"
        );
        for bad in [
            "",
            "gitlab.com/group",
            "gitlab..com",
            "git lab.com",
            "gitlab.com:",
            "gitlab.com:abc",
            "user@gitlab.com",
            "gitlab.com\nhost=evil",
        ] {
            assert!(gitlab_host(bad).is_err(), "{bad:?} isn't a server's name");
        }
    }
}
