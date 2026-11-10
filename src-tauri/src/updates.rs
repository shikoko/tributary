//! New versions of Tributary, from the project's GitHub releases.
//!
//! The release workflow attaches a `latest.json` to each release, listing the signed
//! installers. It's read from the latest release's public download address (the updater's
//! endpoint in tauri.conf.json), so no GitHub account or token is involved. Updates are
//! verified against the public key in tauri.conf.json.
//!
//! An update is downloaded as soon as it's found, and installed only when the person
//! restarts Tributary for it (once no git command is running, so none is cut off), or
//! else when they quit.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{Error, Result};

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
    /// Downloaded (and its signature checked), ready to install.
    pub ready: bool,
}

/// How far the download has got, sent as `update-progress` events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// The update found by the last check, and its installer once downloaded.
#[derive(Default)]
pub struct Pending(Mutex<Found>);

#[derive(Default)]
pub struct Found {
    update: Option<Update>,
    installer: Option<Vec<u8>>,
    /// Being installed (a restart, or quitting): not to be installed twice.
    installing: bool,
}

/// Set to stop waiting to restart.
static STOP_WAITING: AtomicBool = AtomicBool::new(false);

fn found<R: Runtime>(app: &AppHandle<R>) -> std::sync::MutexGuard<'_, Found> {
    app.state::<Pending>()
        .inner()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Look for a newer version. Remembers it for [`download`]; one already downloaded stays
/// ready if it's still the newest.
pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Option<UpdateInfo>, Error> {
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let update = match updater.check().await {
        Ok(update) => update,
        // No release with a latest.json yet (one built without the signing key has none).
        Err(tauri_plugin_updater::Error::ReleaseNotFound) => None,
        Err(e) => return Err(format!("Couldn't check for updates ({e})").into()),
    };
    let mut found = found(app);
    let same = matches!((&found.update, &update), (Some(before), Some(now)) if before.version == now.version);
    if !same {
        found.installer = None;
    }
    let info = update.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        current: update.current_version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
        date: update.date.map(|date| date.to_string()),
        ready: same && found.installer.is_some(),
    });
    found.update = update;
    Ok(info)
}

/// Download the update found by [`check`] and check its signature, without installing it.
pub async fn download<R: Runtime>(app: &AppHandle<R>) -> Result<(), Error> {
    let update = {
        let found = found(app);
        if found.installer.is_some() {
            return Ok(());
        }
        found
            .update
            .clone()
            .ok_or("There's no update to download. Check for updates first.")?
    };
    let mut downloaded = 0u64;
    let progress = app.clone();
    let installer = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.emit("update-progress", DownloadProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| format!("Couldn't download the update ({e})"))?;
    let mut found = found(app);
    // Still the update that was asked for (a newer check may have replaced it).
    if found.update.as_ref().map(|now| &now.version) == Some(&update.version) {
        found.installer = Some(installer);
    }
    Ok(())
}

/// Install the downloaded update and restart into it, once no git command is running (so
/// none is cut off). Returns false if [`stop_waiting`] was called first.
pub async fn restart<R: Runtime>(app: &AppHandle<R>) -> Result<bool, Error> {
    STOP_WAITING.store(false, Ordering::SeqCst);
    let idle = tauri::async_runtime::spawn_blocking(|| {
        loop {
            if STOP_WAITING.load(Ordering::SeqCst) {
                return false;
            }
            if !crate::git::working() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    if !idle {
        return Ok(false);
    }
    let (update, installer) = {
        let mut found = found(app);
        let (Some(update), Some(installer)) = (found.update.clone(), found.installer.clone())
        else {
            return Err("The update isn't downloaded yet.".into());
        };
        found.installing = true;
        (update, installer)
    };
    // On Windows the installer takes over from here (it closes Tributary and opens the new
    // version); elsewhere the app is replaced in place, then started again.
    if let Err(e) = update.install(installer) {
        found(app).installing = false;
        return Err(format!("Couldn't install the update ({e})").into());
    }
    app.restart();
}

/// Stop waiting to restart for an update (it stays ready).
pub fn stop_waiting() {
    STOP_WAITING.store(true, Ordering::SeqCst);
}

/// As Tributary quits: install an update that's downloaded, so the next start is the new
/// version. On Windows the installer opens (without starting Tributary again).
pub fn install_on_quit<R: Runtime>(app: &AppHandle<R>) {
    let (update, installer) = {
        let mut found = found(app);
        if found.installing {
            return;
        }
        let (Some(update), Some(installer)) = (found.update.take(), found.installer.take()) else {
            return;
        };
        found.installing = true;
        (update, installer)
    };
    let _ = update.restart_after_install(false).install(installer);
}
