//! A short record of what the setup did, for when something goes unseen: how it was
//! started, where its window went, how long the installer took and how it ended. It's
//! `setup.log` in Tributary's log folder, beside its `problems.log` (Help → Diagnostics shows
//! the folder), and starts over past 64 KB.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// The log starts over (the old one kept beside it) past this size.
const MAX_SIZE: u64 = 64 * 1024;

/// Where the log goes: Tributary's log folder (on Windows, where Tauri puts it for the app).
fn file() -> Option<PathBuf> {
    #[cfg(windows)]
    let folder = PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
        .join(crate::APP_ID)
        .join("logs");
    #[cfg(not(windows))]
    let folder = std::env::temp_dir().join("tributary-setup");
    Some(folder.join("setup.log"))
}

/// Adds a line to the log, with the time and the version being installed. Nothing that goes
/// wrong here stops the setup.
pub fn note(what: &str) {
    let Some(path) = file() else {
        return;
    };
    if let Some(folder) = path.parent() {
        let _ = fs::create_dir_all(folder);
    }
    if fs::metadata(&path).is_ok_and(|file| file.len() > MAX_SIZE) {
        let _ = fs::rename(&path, path.with_extension("old.log"));
    }
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(
            file,
            "{} setup {}: {}",
            utc(seconds),
            crate::VERSION,
            what.trim()
        );
    }
}

/// "2026-11-12 21:03:33Z" for a time in seconds since the Unix epoch.
fn utc(seconds: u64) -> String {
    let days = seconds / 86_400;
    let (hour, minute, second) = (seconds % 86_400 / 3600, seconds % 3600 / 60, seconds % 60);
    // Days to a date (Howard Hinnant's civil_from_days).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}Z")
}

#[cfg(test)]
mod tests {
    use super::utc;

    #[test]
    fn writes_times_as_dates() {
        assert_eq!(utc(0), "1970-01-01 00:00:00Z");
        assert_eq!(utc(1_794_517_413), "2026-11-12 21:03:33Z");
        assert_eq!(utc(951_782_400), "2000-02-29 00:00:00Z");
    }
}
