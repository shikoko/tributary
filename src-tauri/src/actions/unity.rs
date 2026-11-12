//! Unity projects: Unity's Smart Merge (UnityYAMLMerge, which comes with the editor)
//! merges scenes, prefabs and other assets Unity saves as YAML by what's in them (objects
//! and their properties) rather than line by line, so most conflicts in them resolve by
//! themselves.
//!
//! Setting it up here is local to this repository on this computer (the tool's path is
//! this computer's): git's merge driver in the repository's config, and which files use it
//! in `.git/info/attributes`. Nothing the team shares changes.

use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use super::support::{LITERAL, file_name};
use super::validate::check_file_paths;
use crate::error::{Error, Result};
use crate::git::Git;

/// The merge driver's name in git's config and in attributes.
const DRIVER: &str = "unityyamlmerge";
/// Marks the lines this app adds to `.git/info/attributes`.
const BEGIN: &str = "# Tributary: Unity's Smart Merge for files Unity saves as YAML";
const END: &str = "# End of Tributary's Smart Merge lines";

/// The kinds of files Unity saves as YAML (with Force Text serialization, its default).
pub const YAML_ASSETS: [&str; 24] = [
    "unity",
    "prefab",
    "asset",
    "mat",
    "anim",
    "controller",
    "overrideController",
    "physicMaterial",
    "physicsMaterial2D",
    "playable",
    "mask",
    "brush",
    "flare",
    "fontsettings",
    "guiskin",
    "giparams",
    "renderTexture",
    "spriteatlas",
    "terrainlayer",
    "mixer",
    "shadervariants",
    "preset",
    "lighting",
    "signal",
];

/// A repository's Unity project, and Smart Merge's setup for it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UnitySetup {
    /// There's a Unity project in it (at the top, or in a folder just below).
    pub project: bool,
    /// The editor version it's made with, like "2022.3.10f1".
    pub editor_version: Option<String>,
    /// The UnityYAMLMerge programs found on this computer, the project's version's first.
    pub tools: Vec<String>,
    /// Scenes and prefabs are merged with Smart Merge (set up here, or by the team).
    pub configured: bool,
    /// The program git runs to merge them, when set up.
    pub configured_tool: Option<String>,
}

/// The Unity project in `workdir` (or a folder just below it): its folder and editor version.
pub(super) fn find_project(workdir: &Path) -> Option<(PathBuf, Option<String>)> {
    let version_of = |folder: &Path| -> Option<Option<String>> {
        let text =
            std::fs::read_to_string(folder.join("ProjectSettings").join("ProjectVersion.txt"))
                .ok()?;
        Some(
            text.lines()
                .find_map(|line| line.strip_prefix("m_EditorVersion:"))
                .map(|version| version.trim().to_owned()),
        )
    };
    if let Some(version) = version_of(workdir) {
        return Some((workdir.to_owned(), version));
    }
    let mut folders: Vec<PathBuf> = std::fs::read_dir(workdir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    folders.sort();
    folders
        .into_iter()
        .find_map(|folder| version_of(&folder).map(|version| (folder, version)))
}

/// An editor version's numbers, to sort by: "2022.3.10f1" is [2022, 3, 10, 1].
fn version_key(version: &str) -> Vec<u64> {
    version
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|part| part.parse().ok())
        .collect()
}

/// Where Unity Hub installs editors, and where UnityYAMLMerge is inside each.
fn editor_folders() -> Vec<PathBuf> {
    let mut folders = Vec::new();
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    // A folder chosen in Unity Hub for new editors.
    let hub_settings = if cfg!(windows) {
        std::env::var_os("APPDATA").map(|folder| PathBuf::from(folder).join("UnityHub"))
    } else if cfg!(target_os = "macos") {
        home.as_ref()
            .map(|home| home.join("Library/Application Support/UnityHub"))
    } else {
        home.as_ref().map(|home| home.join(".config/UnityHub"))
    };
    if let Some(chosen) = hub_settings
        .and_then(|folder| std::fs::read_to_string(folder.join("secondaryInstallPath.json")).ok())
        .and_then(|text| serde_json::from_str::<String>(&text).ok())
        .filter(|path| !path.trim().is_empty())
    {
        folders.push(PathBuf::from(chosen));
    }
    if cfg!(windows) {
        for variable in ["ProgramFiles", "ProgramW6432"] {
            if let Some(folder) = std::env::var_os(variable) {
                folders.push(
                    PathBuf::from(folder)
                        .join("Unity")
                        .join("Hub")
                        .join("Editor"),
                );
            }
        }
    } else if cfg!(target_os = "macos") {
        folders.push(PathBuf::from("/Applications/Unity/Hub/Editor"));
    } else if let Some(home) = &home {
        folders.push(home.join("Unity/Hub/Editor"));
    }
    folders.dedup();
    folders
}

/// UnityYAMLMerge inside an editor's folder.
fn tool_in(editor: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        editor.join("Unity.app/Contents/Tools/UnityYAMLMerge")
    } else if cfg!(windows) {
        editor
            .join("Editor")
            .join("Data")
            .join("Tools")
            .join("UnityYAMLMerge.exe")
    } else {
        editor.join("Editor/Data/Tools/UnityYAMLMerge")
    }
}

/// The UnityYAMLMerge programs installed, the one for `version` first, then newest first.
fn find_tools(version: Option<&str>) -> Vec<PathBuf> {
    let mut found: Vec<(Vec<u64>, PathBuf)> = Vec::new();
    for folder in editor_folders() {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let tool = tool_in(&entry.path());
            if tool.is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                found.push((version_key(&name), tool));
            }
        }
    }
    // Editors installed without the Hub.
    let single = if cfg!(windows) {
        std::env::var_os("ProgramFiles").map(|folder| tool_in(&PathBuf::from(folder).join("Unity")))
    } else if cfg!(target_os = "macos") {
        Some(tool_in(Path::new("/Applications/Unity")))
    } else {
        None
    };
    if let Some(tool) = single.filter(|tool| tool.is_file()) {
        found.push((Vec::new(), tool));
    }
    let wanted = version.map(version_key);
    found.sort_by(|a, b| {
        let first = |key: &Vec<u64>| Some(key) == wanted.as_ref();
        first(&b.0).cmp(&first(&a.0)).then(b.0.cmp(&a.0))
    });
    found.dedup_by(|a, b| a.1 == b.1);
    found.into_iter().map(|(_, tool)| tool).collect()
}

/// The repository's Unity project, the Smart Merge programs found, and whether it's set up.
pub fn unity_setup(path: &Path) -> Result<UnitySetup> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let Some(workdir) = repo.workdir().map(Path::to_path_buf) else {
        return Ok(UnitySetup::default());
    };
    let Some((_, editor_version)) = find_project(&workdir) else {
        return Ok(UnitySetup::default());
    };
    let git = Git::find(workdir)?.in_background();
    let configured_tool = configured_tool(&git);
    Ok(UnitySetup {
        project: true,
        tools: find_tools(editor_version.as_deref())
            .into_iter()
            .map(|tool| tool.to_string_lossy().into_owned())
            .collect(),
        configured: configured_tool.is_some() && uses_driver(&git, "Scene.unity"),
        configured_tool,
        editor_version,
    })
}

/// The program git's merge driver runs, if there's one.
fn configured_tool(git: &Git) -> Option<String> {
    let driver = git
        .run(&["config", "--get", &format!("merge.{DRIVER}.driver")])
        .ok()?;
    let driver = driver.trim();
    // "'<tool>' merge …"
    let tool = match driver.strip_prefix('\'') {
        Some(rest) => rest.split_once('\'')?.0,
        None => driver.split_whitespace().next()?,
    };
    Some(tool.to_owned())
}

/// Whether git merges `file` (a name like "Scene.unity") with the Smart Merge driver.
fn uses_driver(git: &Git, file: &str) -> bool {
    git.run_with_env(&["check-attr", "merge", "--", file], &LITERAL)
        .is_ok_and(|output| output.trim_end().ends_with(&format!(": merge: {DRIVER}")))
}

/// Whether `file` (a name like "x.asset") is stored with Git LFS here.
fn in_lfs(git: &Git, file: &str) -> bool {
    git.run_with_env(&["check-attr", "filter", "--", file], &LITERAL)
        .is_ok_and(|output| output.trim_end().ends_with(": filter: lfs"))
}

/// A program the user chose or the app found: it has to be UnityYAMLMerge.
fn check_tool(tool: &str) -> Result<()> {
    let path = Path::new(tool);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !name.starts_with("unityyamlmerge") {
        return Err(format!("{tool} isn't Unity's Smart Merge (UnityYAMLMerge).").into());
    }
    if !path.is_file() {
        return Err(format!("There's no {tool}.").into());
    }
    Ok(())
}

/// `.git/info/attributes` (shared by the repository's worktrees).
fn info_attributes(git: &Git) -> Result<PathBuf> {
    let common = git.run(&["rev-parse", "--git-common-dir"])?;
    Ok(git
        .workdir()
        .join(common.trim())
        .join("info")
        .join("attributes"))
}

/// The attributes file without this app's Smart Merge lines.
fn without_our_lines(text: &str) -> String {
    let mut out = String::new();
    let mut ours = false;
    for line in text.lines() {
        if line == BEGIN {
            ours = true;
        } else if line == END {
            ours = false;
        } else if !ours {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Merge scenes, prefabs and Unity's other YAML files with `tool` from now on, in this
/// repository.
pub(super) fn set_up_unity_merge(git: &Git, tool: String) -> Result<String> {
    check_tool(&tool)?;
    let tool = tool.replace('\'', "'\\''");
    git.run(&[
        "config",
        &format!("merge.{DRIVER}.name"),
        "Unity's Smart Merge (UnityYAMLMerge)",
    ])?;
    // Base, theirs, ours, and the result written over ours: git's merge driver contract.
    git.run(&[
        "config",
        &format!("merge.{DRIVER}.driver"),
        &format!("'{tool}' merge -h -p --force %O %B %A %A"),
    ])?;
    git.run(&["config", &format!("merge.{DRIVER}.recursive"), "binary"])?;
    // The same tool for `git mergetool --tool=unityyamlmerge`, as Unity documents it.
    git.run(&[
        "config",
        &format!("mergetool.{DRIVER}.cmd"),
        &format!("'{tool}' merge -p \"$BASE\" \"$REMOTE\" \"$LOCAL\" \"$MERGED\""),
    ])?;
    git.run(&[
        "config",
        &format!("mergetool.{DRIVER}.trustExitCode"),
        "false",
    ])?;

    let file = info_attributes(git)?;
    let existing = std::fs::read_to_string(&file).unwrap_or_default();
    let mut text = without_our_lines(&existing);
    text.push_str(BEGIN);
    text.push('\n');
    // Files stored with Git LFS merge as their pointers: they're left out.
    for extension in YAML_ASSETS {
        if !in_lfs(git, &format!("x.{extension}")) {
            text.push_str(&format!("*.{extension} merge={DRIVER}\n"));
        }
    }
    text.push_str(END);
    text.push('\n');
    if let Some(folder) = file.parent() {
        std::fs::create_dir_all(folder).map_err(|e| format!("Couldn't set it up: {e}"))?;
    }
    std::fs::write(&file, text).map_err(|e| format!("Couldn't set it up: {e}"))?;
    Ok("Scenes and prefabs merge with Unity's Smart Merge now".to_owned())
}

/// Stop merging Unity's files with Smart Merge here (what the team set up stays).
pub(super) fn remove_unity_merge(git: &Git) -> Result<String> {
    for section in [format!("merge.{DRIVER}"), format!("mergetool.{DRIVER}")] {
        // Exit code 128 when it isn't there: fine.
        let _ = git.run(&["config", "--remove-section", &section]);
    }
    let file = info_attributes(git)?;
    if let Ok(existing) = std::fs::read_to_string(&file) {
        let text = without_our_lines(&existing);
        if text != existing {
            std::fs::write(&file, text).map_err(|e| format!("Couldn't turn it off: {e}"))?;
        }
    }
    Ok("Unity's files merge line by line again".to_owned())
}

/// Merge a conflicted file with Smart Merge (`tool`): both sides' changes, combined by
/// what they changed in the scene or prefab. Stages it when that works.
pub(super) fn unity_smart_merge(git: &Git, file: String, tool: String) -> Result<String> {
    check_tool(&tool)?;
    let checked = check_file_paths(std::slice::from_ref(&file))?;
    let file = checked[0];
    let folder = std::env::temp_dir().join(format!("tributary-smart-merge-{}", std::process::id()));
    std::fs::create_dir_all(&folder).map_err(|e| format!("Couldn't merge {file}: {e}"))?;
    let result = (|| -> Result<String> {
        let mut sides = Vec::new();
        for (stage, name) in [("1", "base"), ("3", "theirs"), ("2", "ours")] {
            let bytes = git
                .run_bytes(&["show", &format!(":{stage}:{file}")], None)
                .map_err(|_| {
                    Error::from(format!(
                        "{} isn't conflicted on both sides: Smart Merge needs both versions and the one they started from.",
                        file_name(file)
                    ))
                })?;
            let side = folder.join(name);
            std::fs::write(&side, bytes).map_err(|e| format!("Couldn't merge {file}: {e}"))?;
            sides.push(side);
        }
        let merged = folder.join("merged");
        let _ = std::fs::remove_file(&merged);
        let output = crate::git::command(Path::new(&tool))
            .arg("merge")
            .arg("-p")
            .args(&sides)
            .arg(&merged)
            .current_dir(git.workdir())
            .output()
            .map_err(|e| format!("Couldn't run Smart Merge: {e}"))?;
        let bytes = std::fs::read(&merged)
            .ok()
            .filter(|_| output.status.success());
        let Some(bytes) = bytes else {
            return Err(format!(
                "Smart Merge couldn't merge {} by itself: both sides changed the same thing. Keep one side, or merge it in Unity.",
                file_name(file)
            )
            .into());
        };
        std::fs::write(git.workdir().join(file), bytes)
            .map_err(|e| format!("Couldn't save {file}: {e}"))?;
        git.run_with_env(&["add", "--", file], &LITERAL)?;
        Ok(format!(
            "Merged {} with Unity's Smart Merge",
            file_name(file)
        ))
    })();
    let _ = std::fs::remove_dir_all(&folder);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_editor_versions() {
        assert!(version_key("2022.3.10f1") > version_key("2022.3.9f1"));
        assert!(version_key("6000.0.23f1") > version_key("2022.3.10f1"));
        assert_eq!(version_key("2021.3.4f1"), vec![2021, 3, 4, 1]);
    }

    #[test]
    fn keeps_other_attributes() {
        let text = format!("*.psd lockable\n{BEGIN}\n*.unity merge={DRIVER}\n{END}\n*.fbx -diff\n");
        assert_eq!(without_our_lines(&text), "*.psd lockable\n*.fbx -diff\n");
    }

    #[test]
    fn finds_the_project_and_its_version() {
        let folder = std::env::temp_dir().join(format!("tributary-unity-{}", std::process::id()));
        let project = folder.join("Game");
        let _ = std::fs::create_dir_all(project.join("ProjectSettings"));
        let _ = std::fs::write(
            project.join("ProjectSettings/ProjectVersion.txt"),
            "m_EditorVersion: 2022.3.10f1\nm_EditorVersionWithRevision: 2022.3.10f1 (ff3792e53c62)\n",
        );
        let found = find_project(&folder);
        let _ = std::fs::remove_dir_all(&folder);
        assert_eq!(found, Some((project, Some("2022.3.10f1".to_owned()))));
    }

    #[test]
    fn takes_only_unity_s_tool() {
        assert!(check_tool("/usr/bin/sh").is_err());
        assert!(check_tool("/nowhere/UnityYAMLMerge").is_err());
    }
}
