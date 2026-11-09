//! Unity's Smart Merge: setting it up as git's merge driver, and merging one conflicted file
//! with it. A small script stands in for UnityYAMLMerge.
#![cfg(unix)]

mod common;

use common::{TempRepo, read, run, with_identity};
use tributary_lib::actions::{self, Action, MergeMode};

/// A stand-in for Unity's tool: `merge [flags] <base> <theirs> <ours> <result>` writes a
/// result that says it merged, with both sides' lines.
fn fake_tool(repo: &TempRepo) -> String {
    let folder = repo.path().with_extension("tools");
    std::fs::create_dir_all(&folder).unwrap_or_default();
    let tool = folder.join("UnityYAMLMerge");
    std::fs::write(
        &tool,
        "#!/bin/sh\nshift\nwhile [ \"${1#-}\" != \"$1\" ]; do shift; done\n\
         { echo smart; cat \"$3\"; cat \"$2\"; } > \"$4.tmp\" && mv \"$4.tmp\" \"$4\"\n",
    )
    .unwrap_or_default();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap_or_default();
    tool.to_string_lossy().into_owned()
}

/// A Unity project whose scene was changed on two branches: merging them conflicts.
fn project(name: &str) -> TempRepo {
    let mut repo = TempRepo::new(name);
    with_identity(&repo);
    std::fs::create_dir_all(repo.path().join("ProjectSettings")).unwrap_or_default();
    std::fs::create_dir_all(repo.path().join("Assets")).unwrap_or_default();
    repo.commit(
        "ProjectSettings/ProjectVersion.txt",
        "m_EditorVersion: 2022.3.10f1\n",
    );
    repo.commit("Assets/Scene.unity", "scene\n");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("Assets/Scene.unity", "scene\ntheirs\n");
    repo.git(&["switch", "--quiet", "main"]);
    repo.commit("Assets/Scene.unity", "scene\nours\n");
    repo
}

fn merge(repo: &TempRepo) -> Result<String, String> {
    run(
        repo,
        Action::Merge {
            target: "feature".into(),
            mode: MergeMode::Default,
        },
    )
}

#[test]
fn sets_up_smart_merge_and_merges_scenes_with_it() {
    let repo = project("unity-driver");
    let tool = fake_tool(&repo);
    let setup = actions::unity_setup(repo.path()).unwrap_or_default();
    assert!(setup.project);
    assert_eq!(setup.editor_version.as_deref(), Some("2022.3.10f1"));
    assert!(!setup.configured);

    run(&repo, Action::SetUpUnityMerge { tool: tool.clone() }).unwrap_or_default();
    let setup = actions::unity_setup(repo.path()).unwrap_or_default();
    assert!(setup.configured);
    assert_eq!(setup.configured_tool.as_deref(), Some(tool.as_str()));
    // Only this repository's own files change, not the team's.
    assert!(!repo.path().join(".gitattributes").exists());

    // The scene merges by itself.
    assert!(merge(&repo).is_ok());
    assert_eq!(
        read(&repo, "Assets/Scene.unity"),
        "smart\nscene\nours\nscene\ntheirs\n"
    );

    run(&repo, Action::RemoveUnityMerge).unwrap_or_default();
    let setup = actions::unity_setup(repo.path()).unwrap_or_default();
    assert!(!setup.configured);
    let attributes =
        std::fs::read_to_string(repo.path().join(".git/info/attributes")).unwrap_or_default();
    assert!(!attributes.contains("unityyamlmerge"), "{attributes}");
    let _ = std::fs::remove_dir_all(repo.path().with_extension("tools"));
}

#[test]
fn merges_one_conflicted_scene_with_smart_merge() {
    let repo = project("unity-file");
    let tool = fake_tool(&repo);
    assert!(merge(&repo).is_err() || !repo.git(&["ls-files", "--unmerged"]).is_empty());
    let file = "Assets/Scene.unity".to_owned();
    let message = run(
        &repo,
        Action::UnitySmartMerge {
            file: file.clone(),
            tool: tool.clone(),
        },
    );
    assert_eq!(
        message.as_deref(),
        Ok("Merged Scene.unity with Unity's Smart Merge")
    );
    assert_eq!(read(&repo, &file), "smart\nscene\nours\nscene\ntheirs\n");
    assert!(repo.git(&["ls-files", "--unmerged"]).is_empty());
    // Not conflicted any more: nothing to merge.
    assert!(run(&repo, Action::UnitySmartMerge { file, tool }).is_err());
    // Only Unity's own tool is run.
    assert!(
        run(
            &repo,
            Action::UnitySmartMerge {
                file: "Assets/Scene.unity".into(),
                tool: "/bin/sh".into()
            }
        )
        .is_err()
    );
    let _ = std::fs::remove_dir_all(repo.path().with_extension("tools"));
}
