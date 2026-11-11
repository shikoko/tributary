//! Signing in to GitHub: the token is checked with GitHub, then kept by git's own
//! credential helper (the system keychain, Git Credential Manager, …), so pushes and
//! pull request badges both use it. Tributary never stores it itself.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{HOST, api_request, client};
use crate::error::{Error, Result};
use crate::git::{Credential, Git};

/// How long to wait for the user to sign in with Git Credential Manager.
const BROWSER_SIGN_IN: Duration = Duration::from_secs(300);
/// How long to wait for a stored token.
const LOOKUP: Duration = Duration::from_secs(10);

/// A GitHub user.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "GitHubAccount")]
pub struct Account {
    pub login: String,
    #[serde(default)]
    pub name: Option<String>,
    /// Where GitHub keeps the account's picture.
    #[serde(default, rename(deserialize = "avatar_url"), skip_serializing)]
    pub avatar_url: Option<String>,
    /// The account's picture, as a `data:` URL (for showing who's signed in).
    #[serde(default, skip_deserializing)]
    pub picture: Option<String>,
}

/// Who's signed in to GitHub, and how one can sign in.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GitHubStatus {
    pub account: Option<Account>,
    /// Git keeps a token that GitHub no longer accepts.
    pub token_rejected: bool,
    /// Git can keep a token: it has a credential helper.
    pub can_keep_token: bool,
    /// Git Credential Manager is set up, so signing in can happen in the browser.
    pub browser_sign_in: bool,
}

fn git() -> Result<Git> {
    Ok(Git::find(std::env::temp_dir())?.in_background())
}

/// Who `token` belongs to, or None if GitHub doesn't accept it.
async fn user(token: &str) -> Result<Option<Account>> {
    let response = api_request(
        &client()?,
        "https://api.github.com/user".into(),
        Some(token),
    )
    .send()
    .await
    .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
    match response.status().as_u16() {
        200..=299 => response
            .json()
            .await
            .map(Some)
            .map_err(|e| Error::Message(format!("Couldn't read GitHub's answer ({e})"))),
        401 => Ok(None),
        status => Err(format!("GitHub answered with an error ({status}).").into()),
    }
}

/// Who's signed in, going by the token git keeps for github.com.
pub async fn status() -> Result<GitHubStatus> {
    let (stored, helpers) = tauri::async_runtime::spawn_blocking(|| {
        let git = git()?;
        Ok::<_, Error>((
            git.fill_credential(HOST, false, LOOKUP),
            git.credential_helpers(),
        ))
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut account = match &stored {
        Some(credential) => user(&credential.password).await?,
        None => None,
    };
    // The picture, small: what the account's chip shows.
    if let Some(account) = account.as_mut()
        && let Some(url) = &account.avatar_url
    {
        let separator = if url.contains('?') { '&' } else { '?' };
        account.picture = crate::avatars::picture_at(&format!("{url}{separator}s=64")).await;
    }
    Ok(GitHubStatus {
        token_rejected: stored.is_some() && account.is_none(),
        account,
        can_keep_token: !helpers.is_empty(),
        browser_sign_in: helpers.iter().any(|helper| is_credential_manager(helper)),
    })
}

/// Git Credential Manager, however it's set up: `manager`, `manager-core`, or its path.
pub(crate) fn is_credential_manager(helper: &str) -> bool {
    let name = helper.rsplit(['/', '\\']).next().unwrap_or(helper);
    name.starts_with("manager") || name.starts_with("git-credential-manager")
}

/// Sign in with a personal access token: check it with GitHub, then keep it.
pub async fn sign_in_with_token(token: &str) -> Result<Account> {
    let token = token.trim().to_owned();
    if token.is_empty() || token.contains(char::is_whitespace) {
        return Err("Paste the token GitHub made for you.".into());
    }
    let account = user(&token).await?.ok_or(
        "GitHub didn't accept that token. Check that it was copied whole and hasn't expired.",
    )?;
    let login = account.login.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let git = git()?;
        let credential = Credential {
            username: login,
            password: token.clone(),
        };
        // A token kept from before would be found first: forget it.
        git.reject_credential(HOST)?;
        git.approve_credential(HOST, &credential)?;
        // Without a credential helper, git keeps nothing, and says nothing about it.
        let kept = git.fill_credential(HOST, false, LOOKUP);
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

/// Sign in with Git Credential Manager, which opens GitHub's sign-in page in the browser.
pub async fn sign_in_with_browser() -> Result<Account> {
    let credential = tauri::async_runtime::spawn_blocking(|| {
        git()?
            .fill_credential(HOST, true, BROWSER_SIGN_IN)
            .ok_or_else(|| Error::Message("Signing in didn't finish.".into()))
    })
    .await
    .map_err(|e| e.to_string())??;
    let account = user(&credential.password)
        .await?
        .ok_or("GitHub didn't accept the sign-in. Try again.")?;
    tauri::async_runtime::spawn_blocking(move || git()?.approve_credential(HOST, &credential))
        .await
        .map_err(|e| e.to_string())??;
    Ok(account)
}

/// Forget the token git keeps for github.com.
pub fn sign_out() -> Result<()> {
    git()?.reject_credential(HOST)
}

#[cfg(test)]
mod tests {
    use super::{Account, is_credential_manager};

    #[test]
    fn reads_the_accounts_picture_address_but_only_passes_the_picture_on() {
        let account: Account = serde_json::from_str(
            r#"{"login":"maya-chen","name":"Maya Chen","avatar_url":"https://avatars.example.com/u/1?v=4"}"#,
        )
        .unwrap();
        assert_eq!(
            account.avatar_url.as_deref(),
            Some("https://avatars.example.com/u/1?v=4")
        );
        assert_eq!(account.picture, None);
        let sent = serde_json::to_value(&account).unwrap();
        assert!(sent.get("avatarUrl").is_none() && sent.get("avatar_url").is_none());
        assert_eq!(sent["login"], "maya-chen");
    }

    #[test]
    fn recognizes_git_credential_manager() {
        assert!(is_credential_manager("manager"));
        assert!(is_credential_manager("manager-core"));
        assert!(is_credential_manager(
            "/usr/local/share/gcm-core/git-credential-manager"
        ));
        assert!(is_credential_manager(
            "C:\\Program Files\\Git\\mingw64\\bin\\git-credential-manager.exe"
        ));
        assert!(!is_credential_manager("osxkeychain"));
        assert!(!is_credential_manager("store --file ~/.git-credentials"));
    }
}
