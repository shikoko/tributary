//! What changed in a file: in a commit, staged, unstaged or new; text and images.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{TempRepo, outcome};
use tributary_lib::actions::{self, Action, DiffSource, FileDiff, LineKind, MediaKind, file_diff};

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
    let images = changed.media.unwrap();
    assert_eq!(images.kind, MediaKind::Image);
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

#[test]
fn shows_text_stored_with_git_lfs_line_by_line() {
    if !common::lfs_installed() {
        return;
    }
    let mut repo = TempRepo::new("diff-lfs-text");
    repo.git(&["lfs", "install", "--local"]);
    std::fs::write(
        repo.path().join(".gitattributes"),
        "*.json filter=lfs diff=lfs merge=lfs -text\n",
    )
    .unwrap();
    repo.git(&["add", ".gitattributes"]);
    repo.commit(
        "level.json",
        "{\n  \"enemies\": 3,\n  \"name\": \"Tavern\"\n}\n",
    );
    let second = repo.commit(
        "level.json",
        "{\n  \"enemies\": 5,\n  \"name\": \"Tavern\"\n}\n",
    );

    // A commit: the real lines, not the pointer files' oid and size lines.
    let changed = diff(&repo, DiffSource::Commit { id: second }, "level.json");
    assert!(changed.lfs && !changed.binary);
    assert_eq!((changed.additions, changed.deletions), (1, 1));
    assert!(lines(&changed).contains(&"+  \"enemies\": 5,".to_owned()));

    // Your changes too.
    std::fs::write(
        repo.path().join("level.json"),
        "{\n  \"enemies\": 5,\n  \"name\": \"Cellar\"\n}\n",
    )
    .unwrap();
    let edited = diff(&repo, DiffSource::Unstaged, "level.json");
    assert_eq!(
        lines(&edited)
            .into_iter()
            .filter(|line| !line.starts_with(' '))
            .collect::<Vec<_>>(),
        vec!["-  \"name\": \"Tavern\"", "+  \"name\": \"Cellar\""]
    );
}

#[test]
fn sets_the_diff_and_merge_tools() {
    use tributary_lib::actions::{Scope, diff_tool_settings, set_diff_tool};
    let repo = TempRepo::new("diff-tools");
    let here = Some(repo.path());
    // In this repository's own settings, so the computer's stay as they are.
    let set = |merge: bool, tool: Option<&str>, command: Option<&str>| {
        set_diff_tool(
            here,
            merge,
            tool.map(Into::into),
            command.map(Into::into),
            Scope::Local,
        )
    };
    assert_eq!(
        set(false, Some("vscode"), None).unwrap(),
        "Diffs open in Visual Studio Code"
    );
    assert_eq!(
        set(true, Some("custom"), Some(r#"mymerge "$MERGED""#)).unwrap(),
        "Conflicts open in your command"
    );
    let settings = diff_tool_settings(here, false).unwrap();
    assert_eq!(settings.diff.as_deref(), Some("vscode"));
    assert_eq!(
        settings.diff_command.as_deref(),
        Some(r#"code --wait --diff "$LOCAL" "$REMOTE""#)
    );
    assert_eq!(settings.merge.as_deref(), Some("custom"));
    assert_eq!(
        settings.merge_command.as_deref(),
        Some(r#"mymerge "$MERGED""#)
    );

    // A custom tool needs its command; odd names aren't taken.
    assert!(set(false, Some("custom"), None).is_err());
    assert!(set(false, Some("rm -rf"), None).is_err());

    // Back to git's default (twice is fine).
    set(false, None, None).unwrap();
    set(false, None, None).unwrap();
    // The repository's setting is gone (the computer's own may still apply).
    let local = repo.git(&["config", "--local", "--list"]);
    assert!(!local.contains("diff.tool="), "{local}");
}

#[test]
fn shows_sounds_videos_and_3d_models_as_what_they_are() {
    let mut repo = TempRepo::new("diff-media");
    // Not real recordings: what matters is that they're binary, and their kinds.
    let wav = |n: u8| [b"RIFF\0\0\0\0WAVE".as_slice(), &[0, n, 0, 1]].concat();
    std::fs::write(repo.path().join("Theme.wav"), wav(1)).unwrap();
    std::fs::write(repo.path().join("Intro.mp4"), [0u8, 0, 0, 24, 1]).unwrap();
    // OBJ models are text: shown in 3D, and line by line too.
    std::fs::write(
        repo.path().join("Chair.obj"),
        "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
    )
    .unwrap();
    repo.git(&["add", "."]);
    repo.git(&["commit", "--quiet", "-m", "Media"]);
    std::fs::write(repo.path().join("Theme.wav"), wav(2)).unwrap();
    std::fs::write(
        repo.path().join("Chair.obj"),
        "v 0 0 0\nv 2 0 0\nv 0 1 0\nf 1 2 3\n",
    )
    .unwrap();
    repo.commit("notes.txt", "notes");

    let sound = diff(&repo, DiffSource::Unstaged, "Theme.wav");
    let media = sound.media.unwrap();
    assert_eq!(
        (media.kind, media.format.as_str()),
        (MediaKind::Audio, "wav")
    );
    assert!(media.before.unwrap().starts_with("data:audio/wav;base64,"));
    assert!(media.after.unwrap().starts_with("data:audio/wav;base64,"));

    let model = diff(&repo, DiffSource::Unstaged, "Chair.obj");
    assert_eq!(model.media.unwrap().kind, MediaKind::Model);
    assert_eq!((model.additions, model.deletions), (1, 1));

    // A video added in a commit: nothing before it.
    let added = repo.git(&["log", "-1", "--format=%H", "--", "Intro.mp4"]);
    let video = diff(&repo, DiffSource::Commit { id: added }, "Intro.mp4");
    let media = video.media.unwrap();
    assert_eq!((media.kind, media.before), (MediaKind::Video, None));
    assert!(media.after.unwrap().starts_with("data:video/mp4;base64,"));
}

#[test]
fn compares_two_branches_directly_and_since_they_split() {
    let mut repo = TempRepo::new("diff-compare");
    let base = repo.commit("shared.txt", "shared");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("feature.txt", "feature work");
    let feature = repo.commit("shared.txt", "feature's take");
    repo.git(&["switch", "--quiet", "main"]);
    let main = repo.commit("main.txt", "main work");

    // Since they split: what the feature branch changed, like a pull request.
    let split = tributary_lib::repo::compare(repo.path(), &main, &feature, true).unwrap();
    assert_eq!(split.split_at.as_deref(), Some(base.as_str()));
    assert_eq!(split.base.as_deref(), Some(base.as_str()));
    assert_eq!((split.only_from, split.only_to), (1, 2));
    let paths: Vec<&str> = split.files.iter().map(|file| file.path.as_str()).collect();
    assert_eq!(paths, ["feature.txt", "shared.txt"]);

    // Directly: main's own file shows as removed too.
    let direct = tributary_lib::repo::compare(repo.path(), &main, &feature, false).unwrap();
    assert_eq!(direct.base.as_deref(), Some(main.as_str()));
    let paths: Vec<&str> = direct.files.iter().map(|file| file.path.as_str()).collect();
    assert_eq!(paths, ["feature.txt", "main.txt", "shared.txt"]);

    // A file's change between them.
    let diff = actions::file_diff(
        repo.path(),
        DiffSource::Range {
            from: base.clone(),
            to: feature.clone(),
        },
        "shared.txt",
        None,
        false,
    )
    .unwrap();
    assert_eq!((diff.additions, diff.deletions), (1, 1));
    assert!(tributary_lib::repo::compare(repo.path(), "nope", &feature, true).is_err());
}
