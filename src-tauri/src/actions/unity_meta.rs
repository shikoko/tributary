//! Unity's `.meta` files: every file and folder under a Unity project's `Assets` has one
//! next to it (`Hero.png` and `Hero.png.meta`), holding its id. Other assets refer to it by
//! that id, so a new asset committed without its `.meta` gets a new id on everyone else's
//! computer, and whatever used it loses it. These are the slips that cause that: a new
//! file or folder without a `.meta`, a `.meta` whose asset is gone, and a deleted (or moved)
//! asset whose `.meta` was left behind.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

/// A file whose `.meta` is wrong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MetaProblem {
    /// The asset (or folder) or, for an orphan, the `.meta` file.
    pub path: String,
    pub problem: MetaKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum MetaKind {
    /// A new file or folder without its `.meta` (Unity hasn't seen it yet).
    Missing,
    /// A `.meta` whose file or folder isn't there.
    Orphan,
    /// A deleted file or folder whose `.meta` is still there.
    LeftBehind,
}

/// Whether Unity looks at `path` (inside `Assets`): not hidden (`.git`, `.DS_Store`), not
/// ending in `~` (Unity's way to hide a folder), and not a `.meta` itself.
fn imported(path: &str) -> bool {
    !path.ends_with(".meta")
        && path
            .split('/')
            .all(|part| !part.is_empty() && !part.starts_with('.') && !part.ends_with('~'))
}

/// The `.meta` problems among a repository's changes. `assets` is the project's `Assets`
/// folder, relative to the repository's top (like "Game/Assets"); `changed` are the files
/// added or changed (relative to the top), `deleted` those deleted.
pub(super) fn meta_problems(
    workdir: &Path,
    assets: &str,
    changed: &[&str],
    deleted: &[&str],
) -> Vec<MetaProblem> {
    let prefix = format!("{assets}/");
    let inside = |path: &str| path.starts_with(prefix.as_str());
    let exists = |path: &str| workdir.join(path).exists();
    let mut problems = Vec::new();
    let mut seen = HashSet::new();
    let mut flag = |path: String, problem: MetaKind, problems: &mut Vec<MetaProblem>| {
        if seen.insert(path.clone()) {
            problems.push(MetaProblem { path, problem });
        }
    };
    for path in changed.iter().filter(|path| inside(path)) {
        if let Some(asset) = path.strip_suffix(".meta") {
            // A .meta added or changed without its file or folder.
            if imported(&asset[prefix.len()..]) && !exists(asset) {
                flag((*path).to_owned(), MetaKind::Orphan, &mut problems);
            }
            continue;
        }
        if !imported(&path[prefix.len()..]) || !exists(path) {
            continue;
        }
        // The file, and each folder it's in under Assets, need a .meta.
        let mut at = *path;
        loop {
            if !exists(&format!("{at}.meta")) {
                flag(at.to_owned(), MetaKind::Missing, &mut problems);
            }
            match at.rsplit_once('/') {
                Some((folder, _)) if folder.len() > assets.len() => at = folder,
                _ => break,
            }
        }
    }
    for path in deleted.iter().filter(|path| inside(path)) {
        if path.ends_with(".meta") || !imported(&path[prefix.len()..]) || exists(path) {
            continue;
        }
        if exists(&format!("{path}.meta")) && !deleted.contains(&format!("{path}.meta").as_str()) {
            flag((*path).to_owned(), MetaKind::LeftBehind, &mut problems);
        }
    }
    problems.sort_by(|a, b| a.path.cmp(&b.path));
    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_missing_orphaned_and_left_behind_metas() {
        let dir = std::env::temp_dir().join(format!("tributary-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let write = |path: &str| {
            let file = dir.join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, "x").unwrap();
        };
        write("Game/Assets/Hero.png");
        write("Game/Assets/Hero.png.meta");
        write("Game/Assets/Props/Stool.fbx");
        write("Game/Assets/Props.meta");
        write("Game/Assets/New/Lamp.prefab");
        write("Game/Assets/Old.mat.meta");
        write("Game/Assets/Gone.png.meta");
        write("Game/Assets/.hidden/notes.txt");
        write("Game/Assets/Docs~/readme.md");
        let found = meta_problems(
            &dir,
            "Game/Assets",
            &[
                "Game/Assets/Hero.png",
                "Game/Assets/Props/Stool.fbx",
                "Game/Assets/New/Lamp.prefab",
                "Game/Assets/Old.mat.meta",
                "Game/Assets/.hidden/notes.txt",
                "Game/Assets/Docs~/readme.md",
                "Game/README.md",
            ],
            &[
                "Game/Assets/Gone.png",
                "Game/Assets/Away.png",
                "Game/Assets/Away.png.meta",
            ],
        );
        let found: Vec<(&str, MetaKind)> =
            found.iter().map(|p| (p.path.as_str(), p.problem)).collect();
        assert_eq!(
            found,
            vec![
                ("Game/Assets/Gone.png", MetaKind::LeftBehind),
                ("Game/Assets/New", MetaKind::Missing),
                ("Game/Assets/New/Lamp.prefab", MetaKind::Missing),
                ("Game/Assets/Old.mat.meta", MetaKind::Orphan),
                ("Game/Assets/Props/Stool.fbx", MetaKind::Missing),
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
