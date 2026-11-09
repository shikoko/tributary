//! Saving commits as a patch file, and applying one as commits or as changes.

mod common;

use common::{TempRepo, read, run, with_identity};
use tributary_lib::actions::{self, Action};
use tributary_lib::repo::{self, OperationKind};

#[test]
fn saves_commits_as_a_patch_and_applies_it() {
    let mut repo = TempRepo::new("patch-from");
    with_identity(&repo);
    repo.commit("a.txt", "one\n");
    let base = repo.git(&["rev-parse", "HEAD"]);
    let first = repo.commit("a.txt", "one\ntwo\n");
    let second = repo.commit("b.txt", "bee\n");
    let file = repo.path().with_extension("patch");
    let file_name = file.to_string_lossy().into_owned();

    // Saved oldest first, whatever order they're chosen in.
    let message = run(
        &repo,
        Action::SavePatch {
            ids: vec![second.clone(), first.clone()],
            file: file_name.clone(),
        },
    );
    assert_eq!(
        message.as_deref(),
        Ok(format!(
            "Saved 2 commits as {}",
            file.file_name().unwrap_or_default().to_string_lossy()
        )
        .as_str())
    );
    let text = std::fs::read_to_string(&file).unwrap_or_default();
    assert!(
        text.find("[PATCH 1/2] one\ntwo") < text.find("[PATCH 2/2] bee"),
        "{text}"
    );
    assert_eq!(
        actions::patch_text(repo.path(), std::slice::from_ref(&first))
            .unwrap_or_default()
            .matches("Subject:")
            .count(),
        1
    );

    // Applied as commits on the base: the same two, with their author.
    repo.git(&["switch", "--quiet", "--create", "other", &base]);
    let info = actions::patch_info(repo.path(), &file).unwrap_or_default();
    assert_eq!(info.commits.len(), 2);
    assert_eq!(info.commits[1].summary, "bee");
    assert_eq!(info.files.len(), 2);
    assert!(info.applies);
    let message = run(
        &repo,
        Action::ApplyPatch {
            file: file_name.clone(),
            as_commits: true,
        },
    );
    assert_eq!(
        message.as_deref(),
        Ok(format!(
            "Applied 2 commits from {}",
            file.file_name().unwrap_or_default().to_string_lossy()
        )
        .as_str())
    );
    assert_eq!(
        repo.git(&["log", "-1", "--format=%s|%an"]),
        "bee|Test Author"
    );
    assert_eq!(read(&repo, "a.txt"), "one\ntwo\n");

    // As changes only: the files change, nothing is committed.
    repo.git(&["switch", "--quiet", "--create", "changes", &base]);
    let head = repo.git(&["rev-parse", "HEAD"]);
    assert!(
        run(
            &repo,
            Action::ApplyPatch {
                file: file_name.clone(),
                as_commits: false
            }
        )
        .is_ok()
    );
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(read(&repo, "b.txt"), "bee\n");
    repo.git(&["reset", "--quiet", "--hard"]);
    repo.git(&["clean", "-fdq"]);

    // A patch that conflicts stops for the conflicts, like a rebase; aborting goes back.
    repo.commit("a.txt", "one\nTWO\n");
    let before = repo.git(&["rev-parse", "HEAD"]);
    assert!(
        run(
            &repo,
            Action::ApplyPatch {
                file: file_name.clone(),
                as_commits: true
            }
        )
        .is_err()
    );
    let snapshot =
        repo::load_with(repo.path(), common::options(10)).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        snapshot.operation.map(|operation| operation.kind),
        Some(OperationKind::ApplyPatches)
    );
    assert!(run(&repo, Action::AbortOperation).is_ok());
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), before);
    let _ = std::fs::remove_file(&file);
}
