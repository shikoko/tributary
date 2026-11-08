//! Staging, unstaging and throwing away some of a file's changed lines.

mod common;

use common::{TempRepo, outcome, read, run, with_identity};
use tributary_lib::actions::{Action, LineMode};

const BEFORE: &str = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve\n";
const AFTER: &str =
    "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\nELEVEN\ntwelve\nthirteen\n";

fn lines(file: &str, mode: LineMode, added: &[u32], removed: &[u32]) -> Action {
    Action::ApplyLines {
        file: file.into(),
        mode,
        added: added.to_vec(),
        removed: removed.to_vec(),
    }
}

/// What's staged of `file` (the helper trims git's output: the last newline goes back).
fn staged(repo: &TempRepo, file: &str) -> String {
    format!("{}\n", repo.git(&["show", &format!(":{file}")]))
}

#[test]
fn stages_and_unstages_some_lines() {
    let repo = TempRepo::new("lines-stage");
    with_identity(&repo);
    std::fs::write(repo.path().join("list.txt"), BEFORE).unwrap();
    repo.git(&["add", "list.txt"]);
    repo.git(&["commit", "-qm", "the list"]);
    std::fs::write(repo.path().join("list.txt"), AFTER).unwrap();

    // Just the change to line 2 ("two" → "TWO").
    let message = run(&repo, lines("list.txt", LineMode::Stage, &[2], &[2])).unwrap();
    assert_eq!(message, "Staged 2 lines of list.txt");
    assert_eq!(staged(&repo, "list.txt"), BEFORE.replace("two", "TWO"));
    // The file itself is untouched.
    assert_eq!(read(&repo, "list.txt"), AFTER);

    // Then "thirteen", at the end: numbered as in the file.
    run(&repo, lines("list.txt", LineMode::Stage, &[13], &[])).unwrap();
    assert_eq!(
        staged(&repo, "list.txt"),
        format!("{}thirteen\n", BEFORE.replace("two", "TWO"))
    );

    // Unstage "TWO" again, numbered as in what's staged.
    let message = run(&repo, lines("list.txt", LineMode::Unstage, &[2], &[2])).unwrap();
    assert_eq!(message, "Unstaged 2 lines of list.txt");
    assert_eq!(staged(&repo, "list.txt"), format!("{BEFORE}thirteen\n"));

    // Lines that aren't changed (any more) are refused.
    assert!(run(&repo, lines("list.txt", LineMode::Stage, &[13], &[])).is_err());
    assert!(run(&repo, lines("list.txt", LineMode::Stage, &[], &[])).is_err());
}

#[test]
fn discards_some_lines_and_puts_them_back() {
    let repo = TempRepo::new("lines-discard");
    with_identity(&repo);
    std::fs::write(repo.path().join("list.txt"), BEFORE).unwrap();
    repo.git(&["add", "list.txt"]);
    repo.git(&["commit", "-qm", "the list"]);
    std::fs::write(repo.path().join("list.txt"), AFTER).unwrap();

    let discarded = outcome(&repo, lines("list.txt", LineMode::Discard, &[11], &[11]));
    assert_eq!(discarded.message, "Discarded 2 lines of list.txt");
    assert_eq!(read(&repo, "list.txt"), AFTER.replace("ELEVEN", "eleven"));

    let reference = discarded.backup.expect("kept for undo");
    assert_eq!(
        run(
            &repo,
            Action::RestoreDiscarded {
                reference: reference.clone()
            }
        )
        .unwrap(),
        "Put the discarded lines back"
    );
    assert_eq!(read(&repo, "list.txt"), AFTER);
    assert!(run(&repo, Action::RestoreDiscarded { reference }).is_err());
}

#[test]
fn unstages_part_of_a_new_file() {
    let repo = TempRepo::new("lines-new");
    with_identity(&repo);
    std::fs::write(repo.path().join("base.txt"), "base\n").unwrap();
    repo.git(&["add", "base.txt"]);
    repo.git(&["commit", "-qm", "base"]);
    std::fs::write(repo.path().join("new.txt"), "a\nb\nc\n").unwrap();
    repo.git(&["add", "new.txt"]);

    run(&repo, lines("new.txt", LineMode::Unstage, &[2], &[])).unwrap();
    assert_eq!(staged(&repo, "new.txt"), "a\nc\n");
    assert_eq!(read(&repo, "new.txt"), "a\nb\nc\n");
}
