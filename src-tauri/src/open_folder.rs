//! Folders Tributary is asked to open from outside it: Explorer's **Open in Tributary** (see
//! `windows/hooks.nsh`), or `tributary <folder>` on a command line, start it with the folder.
//! When Tributary is already running, the copy just started hands its folders to the running
//! one, which opens them and comes to the front, and quits (the single-instance plugin, in
//! `lib.rs`).

use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

/// The folders this start was asked to open, until the window asks for them.
static STARTED_WITH: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The event the window hears another start's folders by.
pub const EVENT: &str = "open-folder";

/// A folder as a program was given it: Windows passes the root of a drive as `"C:\"`, which
/// its rules read as `C:"` (the backslash escaping the quote).
fn as_given(arg: &str) -> String {
    let arg = arg.trim_end_matches('"');
    if arg.len() == 2 && arg.ends_with(':') {
        format!("{arg}\\")
    } else {
        arg.to_string()
    }
}

/// The folders among a program's arguments (the first is the program itself): the ones that
/// are folders that are there. Anything else (a flag, a file) is left alone.
pub fn folders_in(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .map(|arg| as_given(&arg))
        .filter(|arg| !arg.starts_with('-') && Path::new(arg).is_dir())
        .collect()
}

/// Notes the folders this start of Tributary was asked to open, for the window to open once
/// it's ready (`take`).
pub fn note_start() {
    let folders = folders_in(std::env::args());
    *STARTED_WITH.lock().unwrap_or_else(|e| e.into_inner()) = folders;
}

/// The folders this start was asked to open, once: the window asks as it opens.
pub fn take() -> Vec<String> {
    std::mem::take(&mut *STARTED_WITH.lock().unwrap_or_else(|e| e.into_inner()))
}

/// Tributary was started again with `args` while running: their folders open here, and the
/// window comes to the front.
pub fn another_start(app: &AppHandle, args: Vec<String>) {
    for folder in folders_in(args) {
        let _ = app.emit(EVENT, folder);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_folders_from_the_arguments_and_leaves_the_rest() {
        let here = std::env::temp_dir().to_string_lossy().into_owned();
        let file = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let args = ["tributary", "--flag", &here, &file, "/no/such/folder"].map(String::from);
        assert_eq!(folders_in(args), vec![here.clone()]);
        // The program itself is never one of them.
        assert_eq!(folders_in([here.clone()]), Vec::<String>::new());
    }

    #[test]
    fn reads_a_drive_as_windows_passes_it() {
        assert_eq!(as_given("C:\""), "C:\\");
        assert_eq!(as_given("D:"), "D:\\");
        assert_eq!(as_given("C:\\Projects\\tavern"), "C:\\Projects\\tavern");
    }
}
