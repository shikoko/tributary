//! New versions of Tributary, from the project's GitHub releases.
//!
//! The release workflow attaches a `latest.json` to each release, listing the signed
//! installers. The repository may be private, so GitHub is asked with the token git
//! already uses for github.com (from its credential helper), only when asking without
//! one finds nothing. Updates are verified against the public key in tauri.conf.json.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::actions::Git;

type Error = String;

/// Where releases come from.
const REPOSITORY: &str = "shikoko/tributary";

/// A newer version that can be installed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    /// The version running now.
    pub current: String,
    /// The release notes.
    pub notes: Option<String>,
    /// When it was released, like "2026-11-07T12:00:00Z".
    pub date: Option<String>,
}

/// How far the download has got, sent as `update-progress` events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// The update found by the last check, ready to install.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Deserialize)]
struct Release {
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    /// The API address, which serves the file itself when asked for octet-stream.
    url: String,
}

/// The latest release's `latest.json`, by its API address, and the token that found it.
async fn latest_manifest() -> Result<Option<(String, Option<String>)>, Error> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent("Tributary")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.github.com/repos/{REPOSITORY}/releases/latest");
    let ask = |token: Option<&str>| {
        let mut request = client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        request.send()
    };

    let mut token = None;
    let mut response = ask(None)
        .await
        .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
    if matches!(response.status().as_u16(), 401 | 403 | 404) {
        // A private repository looks missing without signing in.
        token = tauri::async_runtime::spawn_blocking(|| {
            let git = Git::find(std::env::temp_dir()).ok()?;
            git.stored_password("github.com")
        })
        .await
        .ok()
        .flatten();
        if let Some(token) = &token {
            response = ask(Some(token))
                .await
                .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
        }
    }
    match response.status().as_u16() {
        200 => {}
        // No published release yet, or no access to the repository.
        404 if token.is_some() => return Ok(None),
        404 | 401 | 403 => {
            return Err(
                "Couldn't see Tributary's releases on GitHub: sign in to GitHub with git on this computer (by cloning or fetching a GitHub repository), then try again.".into(),
            );
        }
        status => return Err(format!("GitHub answered with an error ({status})")),
    }
    let release: Release = response
        .json()
        .await
        .map_err(|e| format!("Couldn't read the release from GitHub ({e})"))?;
    Ok(release
        .assets
        .into_iter()
        .find(|asset| asset.name == "latest.json")
        .map(|asset| (asset.url, token)))
}

/// Look for a newer version. Remembers it for [`install`].
pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Option<UpdateInfo>, Error> {
    let Some((manifest, token)) = latest_manifest().await? else {
        return Ok(None);
    };
    let manifest = manifest
        .parse()
        .map_err(|e| format!("Unexpected address for the update ({e})"))?;
    let mut builder = app
        .updater_builder()
        .endpoints(vec![manifest])
        .map_err(|e| e.to_string())?
        // Release files are served by the API as files only when asked for octet-stream.
        .header("Accept", "application/octet-stream")
        .map_err(|e| e.to_string())?;
    if let Some(token) = token {
        // Only sent to api.github.com: the download it redirects to doesn't get it.
        builder = builder
            .header("Authorization", format!("Bearer {token}"))
            .map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Couldn't check for updates ({e})"))?;
    let info = update.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        current: update.current_version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
        date: update.date.map(|date| date.to_string()),
    });
    *app.state::<Pending>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = update;
    Ok(info)
}

/// Download and install the update found by [`check`], then restart into it.
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), Error> {
    let update = app
        .state::<Pending>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .ok_or("There's no update to install. Check for updates first.")?;
    let mut downloaded = 0u64;
    let progress = app.clone();
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.emit("update-progress", DownloadProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| format!("Couldn't install the update ({e})"))?;
    // On Windows the installer has already taken over; elsewhere, start the new version.
    app.restart();
}
