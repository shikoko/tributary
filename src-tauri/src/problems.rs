//! What went wrong in the window, kept in the app's log folder so it can be sent with a
//! report afterwards: a small log of WebKit's web content process stopping (macOS) and of
//! errors in the interface, and on macOS copies of the crash reports macOS wrote for
//! Tributary and its WebKit processes. When the web content process stops, the window would
//! stay empty: it's loaded again, and the interface says so once it's back.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// Where the log goes (the app's log folder), once the app knows it.
static FOLDER: Mutex<Option<PathBuf>> = Mutex::new(None);
/// Why the window was loaded again, for the interface to say once it's back.
static RECOVERED: Mutex<Option<String>> = Mutex::new(None);
/// When the window was last loaded again, to stop if it keeps happening.
static RELOADS: Mutex<Vec<Instant>> = Mutex::new(Vec::new());

/// The log starts over (the old one kept beside it) past this size.
const MAX_SIZE: u64 = 256 * 1024;
/// More than this many reloads in a minute, and the window is left as it is.
const MAX_RELOADS: usize = 3;
/// Crash reports older than this aren't copied.
const REPORTS_FROM: Duration = Duration::from_secs(14 * 24 * 60 * 60);
/// Nor bigger ones (they're usually well under 1 MB).
const MAX_REPORT_SIZE: u64 = 8 * 1024 * 1024;
/// At most this many are kept, the newest.
const MAX_REPORTS: usize = 10;
/// How many of the log's lines Diagnostics shows.
const RECENT_LINES: usize = 15;

/// Keep the log in `folder` (the app's log folder).
pub fn keep_in(folder: PathBuf) {
    if let Ok(mut kept) = FOLDER.lock() {
        *kept = Some(folder);
    }
}

/// The log file, once the app knows its log folder.
pub fn log_file() -> Option<PathBuf> {
    FOLDER
        .lock()
        .ok()?
        .as_ref()
        .map(|folder| folder.join("problems.log"))
}

/// Adds a line to the log, with the time and the app's version.
pub fn note(what: &str) {
    let Some(path) = log_file() else {
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
        let version = env!("CARGO_PKG_VERSION");
        let _ = writeln!(
            file,
            "{} Tributary {version}: {}",
            utc(seconds),
            what.trim()
        );
    }
}

/// The folder with the log and the saved crash reports, once the app knows it.
pub fn folder() -> Option<PathBuf> {
    FOLDER.lock().ok()?.clone()
}

/// WebKit's web content process stopped. Noted, and true if the window should be loaded
/// again (not when it's already happened more than a few times in the last minute).
pub fn web_content_stopped() -> bool {
    note("the window's web content process stopped (WebKit), so the window was empty");
    // macOS writes a crash report a few seconds later, if it crashed (rather than being
    // stopped for using too much memory): copy it once it's there.
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(20));
        save_crash_reports();
    });
    let Ok(mut reloads) = RELOADS.lock() else {
        return false;
    };
    let now = Instant::now();
    reloads.retain(|at| now.duration_since(*at) < Duration::from_secs(60));
    if reloads.len() >= MAX_RELOADS {
        note("not loading the window again: it stopped too often in the last minute");
        return false;
    }
    reloads.push(now);
    if let Ok(mut recovered) = RECOVERED.lock() {
        *recovered = Some("The window stopped responding and was loaded again.".into());
    }
    note("loading the window again");
    true
}

/// Why the window was loaded again, once: for the interface to say so when it's back.
pub fn take_recovery() -> Option<String> {
    RECOVERED.lock().ok()?.take()
}

/// What Diagnostics shows of the log and the saved crash reports.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// The folder with the log and the crash reports, once the app knows it.
    pub folder: Option<String>,
    /// The log's last few lines, oldest first.
    pub recent: Vec<String>,
    /// The crash reports saved in the folder, newest first.
    pub crash_reports: Vec<String>,
}

/// The log's last few lines and the saved crash reports, after saving any new ones.
pub fn summary() -> Summary {
    save_crash_reports();
    let Some(folder) = folder() else {
        return Summary::default();
    };
    let recent = fs::read_to_string(folder.join("problems.log"))
        .map(|log| {
            let lines: Vec<&str> = log.lines().filter(|line| !line.trim().is_empty()).collect();
            let from = lines.len().saturating_sub(RECENT_LINES);
            lines[from..]
                .iter()
                .map(|line| (*line).to_owned())
                .collect()
        })
        .unwrap_or_default();
    let crash_reports = newest_first(&folder.join("crashes"))
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    Summary {
        folder: Some(folder.display().to_string()),
        recent,
        crash_reports,
    }
}

/// Copy the crash reports macOS wrote for Tributary and its WebKit processes in the last
/// two weeks into the log folder's "crashes", where they're easy to find and send. Does
/// nothing elsewhere, or before the app knows its log folder.
pub fn save_crash_reports() {
    let (Some(folder), Some(reports)) = (folder(), crash_report_folder()) else {
        return;
    };
    let since = SystemTime::now()
        .checked_sub(REPORTS_FROM)
        .unwrap_or(UNIX_EPOCH);
    let to = folder.join("crashes");
    for from in [reports.join("Retired"), reports] {
        copy_crash_reports(&from, &to, since);
    }
}

/// Where macOS keeps the crash reports it writes. Other systems: none.
fn crash_report_folder() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    std::env::var_os("HOME").map(|home| Path::new(&home).join("Library/Logs/DiagnosticReports"))
}

/// Copy the crash reports in `from` that are Tributary's (its own, or its WebKit processes',
/// which name it as the app they worked for), written since `since`, into `to`. Ones
/// already there are left, and only the newest MAX_REPORTS are kept. How many were copied.
fn copy_crash_reports(from: &Path, to: &Path, since: SystemTime) -> usize {
    let Ok(entries) = fs::read_dir(from) else {
        return 0;
    };
    let mut copied = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_crash_report(&name) || to.join(&name).exists() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let recent = metadata.modified().is_ok_and(|modified| modified >= since);
        if !metadata.is_file() || !recent || metadata.len() > MAX_REPORT_SIZE {
            continue;
        }
        // WebKit's processes are shared by every app that shows web pages: only the ones
        // that worked for Tributary.
        let Ok(text) = fs::read_to_string(entry.path()) else {
            continue;
        };
        if !text.to_lowercase().contains("tributary") {
            continue;
        }
        if fs::create_dir_all(to).is_ok() && fs::write(to.join(&name), text).is_ok() {
            copied += 1;
        }
    }
    for (name, _) in newest_first(to).into_iter().skip(MAX_REPORTS) {
        let _ = fs::remove_file(to.join(name));
    }
    copied
}

/// Crash reports of Tributary itself or of WebKit's processes (web content, GPU, network).
fn is_crash_report(name: &str) -> bool {
    let kind = name.ends_with(".ips") || name.ends_with(".crash");
    let whose = ["com.apple.WebKit.", "Tributary", "tributary"]
        .iter()
        .any(|start| name.starts_with(start));
    kind && whose
}

/// The crash reports in `folder`, newest first, with when they were written.
fn newest_first(folder: &Path) -> Vec<(String, SystemTime)> {
    let mut reports: Vec<(String, SystemTime)> = fs::read_dir(folder)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let modified = entry.metadata().ok()?.modified().ok()?;
                    is_crash_report(&name).then_some((name, modified))
                })
                .collect()
        })
        .unwrap_or_default();
    reports.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
    reports
}

/// `seconds` since 1970 as a date and time in UTC, like "2026-11-11 11:30:09 UTC".
fn utc(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let rest = seconds % 86_400;
    // Days since 1970-01-01 to a civil date (Howard Hinnant's days_from_civil, reversed).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02} UTC",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_dates_in_utc() {
        assert_eq!(utc(0), "1970-01-01 00:00:00 UTC");
        assert_eq!(utc(1_794_396_609), "2026-11-11 11:30:09 UTC");
        // A leap day.
        assert_eq!(utc(1_709_208_000), "2024-02-29 12:00:00 UTC");
    }

    #[test]
    fn copies_only_tributarys_crash_reports() {
        let root = std::env::temp_dir().join(format!("tributary-problems-{}", std::process::id()));
        let (from, to) = (root.join("DiagnosticReports"), root.join("logs/crashes"));
        fs::create_dir_all(&from).unwrap();
        let ours =
            "{\"app_name\":\"com.apple.WebKit.WebContent\"}\n{\"responsibleProc\" : \"Tributary\"}";
        let safari =
            "{\"app_name\":\"com.apple.WebKit.WebContent\"}\n{\"responsibleProc\" : \"Safari\"}";
        fs::write(
            from.join("com.apple.WebKit.WebContent-2026-11-11-113009.ips"),
            ours,
        )
        .unwrap();
        fs::write(
            from.join("com.apple.WebKit.WebContent-2026-11-11-120000.ips"),
            safari,
        )
        .unwrap();
        fs::write(
            from.join("tributary-2026-11-10-090000.ips"),
            "{\"procName\":\"tributary\"}",
        )
        .unwrap();
        fs::write(from.join("Mail-2026-11-11-113009.ips"), "Tributary").unwrap();
        fs::write(from.join("notes.txt"), "Tributary").unwrap();

        assert_eq!(copy_crash_reports(&from, &to, UNIX_EPOCH), 2);
        let mut saved: Vec<String> = newest_first(&to)
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        saved.sort();
        assert_eq!(
            saved,
            [
                "com.apple.WebKit.WebContent-2026-11-11-113009.ips",
                "tributary-2026-11-10-090000.ips"
            ]
        );
        assert_eq!(fs::read_to_string(to.join(&saved[0])).unwrap(), ours);
        // Already copied: left as they are.
        assert_eq!(copy_crash_reports(&from, &to, UNIX_EPOCH), 0);
        // Too old.
        let later = SystemTime::now() + Duration::from_secs(60);
        fs::write(from.join("Tributary-2026-11-11-130000.ips"), "Tributary").unwrap();
        assert_eq!(copy_crash_reports(&from, &to, later), 0);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn stops_reloading_when_it_keeps_happening() {
        let reloaded: Vec<bool> = (0..5).map(|_| web_content_stopped()).collect();
        assert_eq!(reloaded, [true, true, true, false, false]);
        assert!(take_recovery().is_some());
        assert_eq!(take_recovery(), None);
    }
}
