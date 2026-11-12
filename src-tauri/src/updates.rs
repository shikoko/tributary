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
//!
//! People who get beta versions read the beta channel's `latest.json` instead: the release
//! tagged `beta`, which the build of each merge into develop points at its new beta, and the
//! release of a new version points at that version, so it always offers the newest of
//! either. Before there's a beta channel, the stable one is read instead. Turning betas off
//! never goes back: an update is only ever newer than the version running.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use ts_rs::TS;

use crate::error::{Error, Result};

/// The beta channel's list of the newest version, beta or not.
const BETA: &str = "https://github.com/shikoko/tributary/releases/download/beta/latest.json";
/// The newest release's (as in tauri.conf.json).
const STABLE: &str = "https://github.com/shikoko/tributary/releases/latest/download/latest.json";

/// Where to look for a newer version: for betas, the beta channel, then the stable one if
/// there's no beta channel (the updater reads the first that answers). None: the stable one
/// in tauri.conf.json.
fn endpoints(beta: bool) -> Option<Vec<tauri::Url>> {
    beta.then(|| {
        [BETA, STABLE]
            .iter()
            .filter_map(|url| tauri::Url::parse(url).ok())
            .collect()
    })
}

/// A newer version that can be installed.
#[derive(Debug, Clone, Serialize, TS)]
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
#[derive(Debug, Clone, Serialize, TS)]
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

/// Look for a newer version (a beta too, if `beta`). Remembers it for [`download`]; one
/// already downloaded stays ready if it's still the newest.
pub async fn check<R: Runtime>(
    app: &AppHandle<R>,
    beta: bool,
) -> Result<Option<UpdateInfo>, Error> {
    let mut builder = app.updater_builder().timeout(Duration::from_secs(30));
    if let Some(urls) = endpoints(beta) {
        builder = builder.endpoints(urls).map_err(|e| e.to_string())?;
    }
    // On Windows the update is Tributary's setup, which updates the copy in this folder
    // (just for you, or for everyone on the PC).
    if cfg!(windows)
        && let Some(folder) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|folder| folder.display().to_string()))
    {
        builder = builder.installer_arg(format!("\"/INSTALLED={folder}\""));
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn betas_read_the_beta_channel_then_the_stable_one() {
        assert!(endpoints(false).is_none());
        let urls: Vec<String> = endpoints(true)
            .unwrap()
            .iter()
            .map(|url| url.to_string())
            .collect();
        assert_eq!(urls, [BETA, STABLE]);
    }

    #[test]
    fn the_stable_list_is_the_one_in_the_config() {
        let config = include_str!("../tauri.conf.json");
        assert!(config.contains(STABLE));
    }
}
