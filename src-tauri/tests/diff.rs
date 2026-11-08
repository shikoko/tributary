//! What changed in a file: in a commit, staged, unstaged or new; text and images.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{TempRepo, outcome};
use tributary_lib::actions::{self, Action, DiffSource, FileDiff, LineKind, file_diff};

fn diff(repo: &TempRepo, source: DiffSource, file: &str) -> FileDiff {
    file_diff(repo.path(), source, file, None, false).unwrap()
}

/// The lines as "+text", "-text" and " text".
fn lines(diff: &FileDiff) -> Vec<String> {
    diff.hunks
        .iter()
        .flat_map(|hunk| &hunk.lines)
        .map(|line| {
            let mark = match line.kind {
                LineKind::Added => '+',
                LineKind::Removed => '-',
                LineKind::Context => ' ',
            };
            format!("{mark}{}", line.text)
        })
        .collect()
}

#[test]
fn shows_what_changed_in_commits_and_in_your_changes() {
    let mut repo = TempRepo::new("diff");
    let first = repo.commit("notes.txt", "one\ntwo\nthree\n");
    // A repository's first commit is compared with nothing.
    let initial = diff(&repo, DiffSource::Commit { id: first }, "notes.txt");
    assert_eq!(lines(&initial), vec!["+one", "+two", "+three"]);

    let second = repo.commit("notes.txt", "one\nTWO\nthree\n");
    let changed = diff(&repo, DiffSource::Commit { id: second }, "notes.txt");
    assert_eq!(lines(&changed), vec![" one", "-two", "+TWO", " three"]);
    assert_eq!((changed.additions, changed.deletions), (1, 1));
    let numbers: Vec<_> = changed.hunks[0]
        .lines
        .iter()
        .map(|l| (l.old, l.new))
        .collect();
    assert_eq!(
        numbers,
        vec![
            (Some(1), Some(1)),
            (Some(2), None),
            (None, Some(2)),
            (Some(3), Some(3))
        ]
    );

    // Staged, then a further change that isn't.
    std::fs::write(repo.path().join("notes.txt"), "one\nTWO\nthree\nfour\n").unwrap();
    repo.git(&["add", "notes.txt"]);
    std::fs::write(
        repo.path().join("notes.txt"),
        "zero\none\nTWO\nthree\nfour\n",
    )
    .unwrap();
    assert_eq!(
        lines(&diff(&repo, DiffSource::Staged, "notes.txt")),
        vec![" one", " TWO", " three", "+four"]
    );
    assert_eq!(
        lines(&diff(&repo, DiffSource::Unstaged, "notes.txt"))[0],
        "+zero"
    );

    // A new file: every line is added.
    std::fs::write(repo.path().join("new.txt"), "hello\nworld\n").unwrap();
    assert_eq!(
        lines(&diff(&repo, DiffSource::Unstaged, "new.txt")),
        vec!["+hello", "+world"]
    );

    // Changes to spacing only, with whitespace ignored: nothing to show.
    repo.git(&["checkout", "--quiet", "--", "notes.txt"]);
    repo.git(&["reset", "--quiet"]);
    std::fs::write(repo.path().join("notes.txt"), "one  \nTWO\nthree\n").unwrap();
    assert_eq!(
        diff(&repo, DiffSource::Unstaged, "notes.txt").hunks.len(),
        1
    );
    let ignoring = file_diff(repo.path(), DiffSource::Unstaged, "notes.txt", None, true).unwrap();
    assert!(ignoring.hunks.is_empty());

    // Paths that look like options are refused.
    assert!(file_diff(repo.path(), DiffSource::Staged, "--output=x", None, false).is_err());
}

#[test]
fn shows_images_before_and_after() {
    let repo = TempRepo::new("diff-images");
    // Two tiny "images": not text, so git treats them as binary.
    let png = |shade: u8| -> Vec<u8> { [&b"\x89PNG\r\n\x1a\n\0\0\0"[..], &[shade; 64]].concat() };
    std::fs::write(repo.path().join("hero.png"), png(1)).unwrap();
    repo.git(&["add", "hero.png"]);
    repo.git(&["commit", "--quiet", "-m", "Hero"]);
    std::fs::write(repo.path().join("hero.png"), png(2)).unwrap();
    repo.git(&["add", "hero.png"]);
    repo.git(&["commit", "--quiet", "-m", "Hero, brighter"]);
    let id = repo.git(&["rev-parse", "HEAD"]);

    let changed = diff(&repo, DiffSource::Commit { id }, "hero.png");
    assert!(changed.binary && changed.hunks.is_empty());
    assert_eq!(
        (changed.size_before, changed.size_after),
        (Some(75), Some(75))
    );
    let images = changed.images.unwrap();
    assert!(images.before.unwrap().starts_with("data:image/png;base64,"));
    assert_ne!(images.after, None);
}

#[test]
fn opens_the_diff_tool_set_up_in_git() {
    let mut repo = TempRepo::new("difftool");
    repo.commit("notes.txt", "one\n");
    let second = repo.commit("notes.txt", "two\n");
    // A "diff tool" that writes down the two versions it was given.
    let recorded = repo.path().join(".git").join("recorded.txt");
    repo.git(&["config", "diff.tool", "record"]);
    let command = format!(r#"cat "$LOCAL" "$REMOTE" > '{}'"#, recorded.display());
    repo.git(&["config", "difftool.record.cmd", &command]);

    let opened = outcome(
        &repo,
        Action::OpenInDiffTool {
            source: DiffSource::Commit { id: second },
            path: "notes.txt".into(),
        },
    );
    assert_eq!(opened.message, "Opened notes.txt in your diff tool");
    assert_eq!(std::fs::read_to_string(&recorded).unwrap(), "one\ntwo\n");

    // A new file has nothing to be compared with.
    std::fs::write(repo.path().join("new.txt"), "new\n").unwrap();
    let new = actions::run_with_progress(
        repo.path(),
        Action::OpenInDiffTool {
            source: DiffSource::Unstaged,
            path: "new.txt".into(),
        },
        &|_| {},
    );
    assert!(new.unwrap_err().to_string().contains("is new"));
}
