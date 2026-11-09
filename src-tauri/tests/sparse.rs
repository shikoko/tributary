//! Changing which folders are checked out after cloning (a sparse checkout).

mod common;

use common::{TempRepo, run, with_identity};
use tributary_lib::actions::{self, Action};

#[test]
fn checks_out_only_some_folders_and_all_again() {
    let mut repo = TempRepo::new("sparse");
    with_identity(&repo);
    for folder in ["Content/Characters", "Content/Maps", "Source"] {
        std::fs::create_dir_all(repo.path().join(folder)).unwrap_or_default();
    }
    repo.commit("README.md", "readme");
    repo.commit("Content/Characters/Barber.txt", "barber");
    repo.commit("Content/Maps/Tavern.txt", "tavern");
    repo.commit("Source/Game.cpp", "game");

    let settings = actions::sparse_settings(repo.path()).unwrap_or_default();
    assert!(!settings.sparse);
    let offered: Vec<&str> = settings
        .available
        .iter()
        .map(|folder| folder.path.as_str())
        .collect();
    assert_eq!(
        offered,
        ["Content", "Content/Characters", "Content/Maps", "Source"]
    );

    let message = run(
        &repo,
        Action::SetSparseFolders {
            folders: vec!["Content/Characters/".into()],
        },
    );
    assert_eq!(message.as_deref(), Ok("Checked out Content/Characters"));
    assert!(repo.path().join("Content/Characters/Barber.txt").exists());
    assert!(repo.path().join("README.md").exists());
    assert!(!repo.path().join("Content/Maps/Tavern.txt").exists());
    assert!(!repo.path().join("Source/Game.cpp").exists());
    let settings = actions::sparse_settings(repo.path()).unwrap_or_default();
    assert!(settings.sparse && settings.cone);
    assert_eq!(settings.folders, ["Content/Characters"]);

    // A change in a folder that would go away stops it.
    std::fs::write(repo.path().join("Content/Characters/Barber.txt"), "changed")
        .unwrap_or_default();
    let refused = run(
        &repo,
        Action::SetSparseFolders {
            folders: vec!["Source".into()],
        },
    );
    assert!(refused.is_err_and(|error| error.contains("Content/Characters/Barber.txt")));
    repo.git(&["checkout", "--", "Content/Characters/Barber.txt"]);

    assert!(
        run(
            &repo,
            Action::SetSparseFolders {
                folders: vec!["../outside".into()]
            }
        )
        .is_err()
    );
    let message = run(
        &repo,
        Action::SetSparseFolders {
            folders: Vec::new(),
        },
    );
    assert_eq!(message.as_deref(), Ok("Every folder is checked out"));
    assert!(repo.path().join("Source/Game.cpp").exists());
    assert!(
        !actions::sparse_settings(repo.path())
            .unwrap_or_default()
            .sparse
    );
}
