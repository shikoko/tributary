//! Noticing changes made outside the app (an editor saving a file, a commit from the
//! command line, a pull by an agent), so the open repository shows them at once instead
//! of the next time the window gets the focus.
//!
//! One repository is watched at a time: the open tab's. Changes come in bursts (a build,
//! a checkout), so they're gathered for a moment and reported once. Files git ignores
//! (build output, caches) don't count, and on Linux their folders aren't even watched:
//! inotify needs one watch per folder, and big projects have a lot of them.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{RecvTimeoutError, channel};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

/// How long changes have to stop before they're reported.
const QUIET: Duration = Duration::from_millis(400);
/// On Linux, folders watched at most; a bigger tree falls back to refreshing on focus.
const MAX_FOLDERS: usize = 20_000;

/// The watcher for the repository being watched, if any.
#[derive(Default)]
pub struct Watching(Mutex<Option<(PathBuf, Arc<Mutex<RecommendedWatcher>>)>>);

/// Whether a change at `path` (absolute, inside `workdir`) can change what the app shows.
fn matters(path: &Path, workdir: &Path, ignored: &Gitignore) -> bool {
    let Ok(relative) = path.strip_prefix(workdir) else {
        return false;
    };
    let mut parts = relative.components();
    if parts
        .next()
        .is_some_and(|first| first.as_os_str() == ".git")
    {
        // Inside .git: the index, HEAD, refs and the merge or rebase state matter; objects
        // (written by every commit and fetch, which change refs too), logs and lock files don't.
        let rest: Vec<String> = parts
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .collect();
        let name = rest.last().map(String::as_str).unwrap_or("");
        return !rest.is_empty()
            && rest[0] != "objects"
            && rest[0] != "logs"
            && rest[0] != "lfs"
            && !name.ends_with(".lock");
    }
    !ignored
        .matched_path_or_any_parents(relative, path.is_dir())
        .is_ignore()
}

/// What .gitignore (at the top) and .git/info/exclude ignore.
fn ignore_rules(workdir: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(workdir);
    builder.add(workdir.join(".gitignore"));
    builder.add(workdir.join(".git").join("info").join("exclude"));
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

/// Watch the repository at `workdir`, calling `changed` (on another thread) after each
/// burst of changes. Replaces what was watched before.
pub fn watch(
    state: &Watching,
    workdir: &Path,
    changed: impl Fn() + Send + 'static,
) -> Result<(), String> {
    let workdir = workdir
        .canonicalize()
        .map_err(|e| format!("Can't watch {}: {e}", workdir.display()))?;
    let mut current = state
        .0
        .lock()
        .map_err(|_| "The watcher is stuck.".to_owned())?;
    if current
        .as_ref()
        .is_some_and(|(watched, _)| *watched == workdir)
    {
        return Ok(());
    }
    // Stop watching the last one first.
    *current = None;

    let ignored = Arc::new(ignore_rules(&workdir));
    let (send, receive) = channel::<Event>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        if let Ok(event) = event {
            let _ = send.send(event);
        }
    })
    .map_err(|e| format!("Can't watch for changes: {e}"))?;

    if cfg!(target_os = "linux") {
        // One watch per folder that isn't ignored (and .git's own, which matter).
        let mut folders = Vec::new();
        for entry in ignore::WalkBuilder::new(&workdir)
            .hidden(false)
            .filter_entry(|entry| entry.file_name() != ".git")
            .build()
            .flatten()
        {
            if entry.file_type().is_some_and(|kind| kind.is_dir()) {
                folders.push(entry.into_path());
                if folders.len() > MAX_FOLDERS {
                    return Err(
                        "Too many folders to watch: changes show when you come back to the window."
                            .into(),
                    );
                }
            }
        }
        for folder in &folders {
            let _ = watcher.watch(folder, RecursiveMode::NonRecursive);
        }
        let git_dir = workdir.join(".git");
        if git_dir.is_dir() {
            let _ = watcher.watch(&git_dir, RecursiveMode::NonRecursive);
            let _ = watcher.watch(&git_dir.join("refs"), RecursiveMode::Recursive);
        }
    } else {
        watcher
            .watch(&workdir, RecursiveMode::Recursive)
            .map_err(|e| format!("Can't watch for changes: {e}"))?;
    }

    // Gather a burst of changes, then report it once. The thread holds the watcher weakly,
    // so it stops when the watcher is replaced or dropped.
    let root = workdir.clone();
    let watcher = Arc::new(Mutex::new(watcher));
    let weak: Weak<Mutex<RecommendedWatcher>> = Arc::downgrade(&watcher);
    std::thread::spawn(move || {
        loop {
            let Ok(first) = receive.recv() else {
                // The watcher was dropped: stop.
                return;
            };
            if weak.strong_count() == 0 {
                return;
            }
            watch_new_folders(&weak, &first, &root, &ignored);
            let mut relevant = first
                .paths
                .iter()
                .any(|path| matters(path, &root, &ignored))
                && !is_access(&first);
            loop {
                match receive.recv_timeout(QUIET) {
                    Ok(event) => {
                        watch_new_folders(&weak, &event, &root, &ignored);
                        relevant |= !is_access(&event)
                            && event
                                .paths
                                .iter()
                                .any(|path| matters(path, &root, &ignored));
                    }
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            if relevant {
                changed();
            }
        }
    });
    *current = Some((workdir, watcher));
    Ok(())
}

/// On Linux, a folder created after watching started gets a watch of its own.
fn watch_new_folders(
    watcher: &Weak<Mutex<RecommendedWatcher>>,
    event: &Event,
    root: &Path,
    ignored: &Gitignore,
) {
    if !cfg!(target_os = "linux") || !matches!(event.kind, EventKind::Create(_)) {
        return;
    }
    let Some(watcher) = watcher.upgrade() else {
        return;
    };
    for path in &event.paths {
        if !path.is_dir() || !matters(path, root, ignored) || path.starts_with(root.join(".git")) {
            continue;
        }
        let Ok(mut watcher) = watcher.lock() else {
            return;
        };
        // Folders made inside it at the same time (like `mkdir -p`) send no events of their own.
        for entry in ignore::WalkBuilder::new(path)
            .hidden(false)
            .build()
            .flatten()
        {
            if entry.file_type().is_some_and(|kind| kind.is_dir()) {
                let _ = watcher.watch(entry.path(), RecursiveMode::NonRecursive);
            }
        }
    }
}

/// Reading a file isn't a change.
fn is_access(event: &Event) -> bool {
    matches!(event.kind, EventKind::Access(_))
}

/// Stop watching.
pub fn stop(state: &Watching) {
    if let Ok(mut current) = state.0.lock() {
        *current = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_out_ignored_files_and_git_internals() {
        let root =
            std::env::temp_dir().join(format!("tributary-watch-rules-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".git").join("info")).unwrap();
        std::fs::write(root.join(".gitignore"), "Saved/\n*.log\n").unwrap();
        let rules = ignore_rules(&root);
        assert!(matters(&root.join("src/main.rs"), &root, &rules));
        assert!(!matters(
            &root.join("Saved/Autosave/level.umap"),
            &root,
            &rules
        ));
        assert!(!matters(&root.join("build.log"), &root, &rules));
        assert!(matters(&root.join(".git/index"), &root, &rules));
        assert!(matters(&root.join(".git/refs/heads/main"), &root, &rules));
        assert!(!matters(&root.join(".git/objects/ab/cdef"), &root, &rules));
        assert!(!matters(&root.join(".git/index.lock"), &root, &rules));
        assert!(!matters(Path::new("/elsewhere/file"), &root, &rules));
        let _ = std::fs::remove_dir_all(&root);
    }
}
