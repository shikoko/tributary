//! Reading repositories: history, refs, uncommitted changes, stashes, the reflog.

mod common;

use common::{TempRepo, files, head, options, remote_turn, run, with_identity};
use tributary_lib::actions::Action;
use tributary_lib::error::Error;
use tributary_lib::repo::{FileStatus, LoadOptions, RefKind, RowKind};
use tributary_lib::{actions, repo};

#[test]
fn reads_branches_merges_and_tags() {
    let mut repo = TempRepo::new("merge");
    let root = repo.commit("readme.md", "Initial commit");
    repo.git(&["checkout", "--quiet", "-b", "feature"]);
    let feature = repo.commit("feature.txt", "Add feature");
    repo.git(&["checkout", "--quiet", "main"]);
    let fix = repo.commit("readme.md", "Fix readme");
    repo.clock += 60;
    repo.git(&[
        "merge",
        "--quiet",
        "--no-ff",
        "feature",
        "-m",
        "Merge feature\n\nWith a body.",
    ]);
    let merge = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["tag", "-a", "v1.0", "-m", "Release 1.0"]);

    let snapshot = repo::load(repo.path(), 100, true).unwrap();
    let ids: Vec<&str> = snapshot.commits.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            merge.as_str(),
            fix.as_str(),
            feature.as_str(),
            root.as_str()
        ]
    );
    assert_eq!(snapshot.head_branch.as_deref(), Some("main"));
    assert_eq!(snapshot.head_commit.as_deref(), Some(merge.as_str()));
    assert_eq!(snapshot.lane_count, 2);
    assert!(!snapshot.truncated);

    let top = &snapshot.commits[0];
    assert_eq!(top.summary, "Merge feature");
    assert_eq!(top.author_name, "Test Author");
    assert_eq!(top.parents, vec![fix.clone(), feature.clone()]);
    let labels: Vec<(&str, RefKind, bool)> = top
        .refs
        .iter()
        .map(|r| (r.name.as_str(), r.kind, r.current))
        .collect();
    assert_eq!(
        labels,
        vec![
            ("main", RefKind::Branch, true),
            ("v1.0", RefKind::Tag, false)
        ]
    );
    assert_eq!(snapshot.commits[2].refs[0].name, "feature");
    assert!(!snapshot.commits[2].refs[0].current);
    assert_eq!(snapshot.commits[2].graph.column, 1);

    let details = repo::details(repo.path(), &merge).unwrap();
    assert_eq!(details.summary, "Merge feature");
    assert_eq!(details.body, "With a body.");
    assert_eq!(details.committer.email, "committer@example.com");
    let files: Vec<(&str, FileStatus)> = details
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.status))
        .collect();
    assert_eq!(files, vec![("feature.txt", FileStatus::Added)]);

    let details = repo::details(repo.path(), &fix).unwrap();
    let files: Vec<(&str, FileStatus)> = details
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.status))
        .collect();
    assert_eq!(files, vec![("readme.md", FileStatus::Modified)]);
}

#[test]
fn children_come_before_parents_even_with_skewed_clocks() {
    let mut repo = TempRepo::new("skew");
    repo.commit("a.txt", "First");
    let parent = repo.commit("b.txt", "Second");
    // A commit dated a day before its parent.
    std::fs::write(repo.path().join("c.txt"), "third").unwrap();
    repo.git(&["add", "c.txt"]);
    repo.git_at(&["commit", "--quiet", "-m", "Third"], repo.clock - 86_400);
    let child = repo.git(&["rev-parse", "HEAD"]);

    let snapshot = repo::load(repo.path(), 100, true).unwrap();
    let child_row = snapshot.commits.iter().position(|c| c.id == child).unwrap();
    let parent_row = snapshot
        .commits
        .iter()
        .position(|c| c.id == parent)
        .unwrap();
    assert!(child_row < parent_row);
}

#[test]
fn respects_the_commit_limit() {
    let mut repo = TempRepo::new("limit");
    for i in 0..5 {
        repo.commit("file.txt", &format!("Commit {i}"));
    }
    let snapshot = repo::load(repo.path(), 3, true).unwrap();
    assert_eq!(snapshot.commits.len(), 3);
    assert!(snapshot.truncated);
    assert_eq!(snapshot.commits[0].summary, "Commit 4");
}

#[test]
fn opens_from_a_subdirectory_and_handles_detached_head() {
    let mut repo = TempRepo::new("detached");
    let first = repo.commit("a.txt", "First");
    repo.commit("a.txt", "Second");
    repo.git(&["checkout", "--quiet", "--detach", &first]);
    std::fs::create_dir_all(repo.path().join("nested/dir")).unwrap();

    let snapshot = repo::load(&repo.path().join("nested/dir"), 100, true).unwrap();
    assert_eq!(snapshot.head_branch, None);
    let head_row = snapshot.commits.iter().find(|c| c.id == first).unwrap();
    assert!(head_row.refs.iter().any(|r| r.kind == RefKind::Head));
}

#[test]
fn reports_folders_that_are_not_repositories() {
    let dir =
        std::env::temp_dir().join(format!("tributary-test-{}-not-a-repo", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let error = repo::load(&dir, 100, true).unwrap_err();
    assert!(matches!(error, Error::NotARepository { .. }), "{error}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn shows_uncommitted_changes_and_stashes() {
    let _turn = remote_turn();
    let mut repo = TempRepo::new("worktree");
    let first = repo.commit("a.txt", "First");
    let second = repo.commit("b.txt", "Second");
    // A stash made on top of the second commit…
    std::fs::write(repo.path().join("a.txt"), "stashed change").unwrap();
    repo.clock += 60;
    repo.git(&["stash", "push", "--quiet", "-m", "Half-done idea"]);
    // …then another commit, with uncommitted changes on top of it.
    let third = repo.commit("c.txt", "Third");
    std::fs::write(repo.path().join("b.txt"), "modified").unwrap();
    std::fs::write(repo.path().join("d.txt"), "staged").unwrap();
    repo.git(&["add", "d.txt"]);
    std::fs::write(repo.path().join("e.txt"), "untracked").unwrap();

    let snapshot = repo::load(repo.path(), 100, true).unwrap();
    let kinds: Vec<RowKind> = snapshot.commits.iter().map(|c| c.kind).collect();
    assert_eq!(
        kinds,
        vec![
            RowKind::Worktree,
            RowKind::Commit,
            RowKind::Stash,
            RowKind::Commit,
            RowKind::Commit
        ]
    );

    let worktree = &snapshot.commits[0];
    assert_eq!(worktree.id, repo::WORKTREE_ID);
    assert_eq!(worktree.parents, vec![third.clone()]);
    assert!(worktree.graph.lines.iter().all(|line| line.dashed));
    let status = snapshot.worktree.as_ref().unwrap();
    assert_eq!(files(&status.staged), vec![("d.txt", FileStatus::Added)]);
    assert_eq!(
        files(&status.unstaged),
        vec![
            ("b.txt", FileStatus::Modified),
            ("e.txt", FileStatus::Untracked)
        ]
    );

    assert_eq!(snapshot.commits[1].id, third);
    let stash = &snapshot.commits[2];
    assert_eq!(stash.summary, "On main: Half-done idea");
    assert_eq!(
        stash.parents,
        vec![second.clone()],
        "only the commit the stash was made from"
    );
    assert_eq!(stash.refs.len(), 1);
    assert_eq!(
        (stash.refs[0].name.as_str(), stash.refs[0].kind),
        ("stash@{0}", RefKind::Stash)
    );
    assert!(stash.graph.lines.iter().any(|line| line.dashed));
    assert_eq!(snapshot.commits[3].id, second);
    assert_eq!(snapshot.commits[4].id, first);

    let details = repo::details(repo.path(), &stash.id).unwrap();
    assert_eq!(files(&details.files), vec![("a.txt", FileStatus::Modified)]);
}

#[test]
fn stash_details_include_untracked_files() {
    let mut repo = TempRepo::new("stash-untracked");
    repo.commit("a.txt", "First");
    std::fs::write(repo.path().join("a.txt"), "changed").unwrap();
    std::fs::write(repo.path().join("new.txt"), "new").unwrap();
    repo.git(&[
        "stash",
        "push",
        "--quiet",
        "--include-untracked",
        "-m",
        "With a new file",
    ]);

    let snapshot = repo::load(repo.path(), 100, true).unwrap();
    assert!(snapshot.worktree.is_none(), "the stash took every change");
    let stash = snapshot
        .commits
        .iter()
        .find(|c| c.kind == RowKind::Stash)
        .unwrap();
    let details = repo::details(repo.path(), &stash.id).unwrap();
    assert_eq!(
        files(&details.files),
        vec![
            ("a.txt", FileStatus::Modified),
            ("new.txt", FileStatus::Untracked)
        ]
    );
}

#[test]
fn loads_only_the_checked_out_branch() {
    let mut repo = TempRepo::new("first-parent");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("b.txt", "feature work");
    repo.git(&["switch", "--quiet", "--create", "unrelated", "main"]);
    repo.commit("d.txt", "elsewhere");
    repo.git(&["switch", "--quiet", "main"]);
    repo.commit("c.txt", "main work");
    repo.git(&["merge", "--quiet", "--no-ff", "--no-edit", "feature"]);

    let all = repo::load(repo.path(), 100, false).unwrap();
    assert_eq!(all.commits.len(), 5);
    let options = LoadOptions {
        limit: 100,
        include_status: false,
        first_parent: true,
        ..LoadOptions::default()
    };
    let own = repo::load_with(repo.path(), options).unwrap();
    let summaries: Vec<&str> = own.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(
        summaries,
        vec!["Merge branch 'feature'", "main work", "base"]
    );
    assert!(own.first_parent);
    assert_eq!(own.lane_count, 1, "a straight line");
    assert_eq!(
        own.commits[0].parents.len(),
        2,
        "the merge still knows both parents"
    );
}

#[test]
fn hides_and_solos_branches() {
    let mut repo = TempRepo::new("hide");
    repo.commit("a.txt", "base");
    repo.git(&["switch", "--quiet", "--create", "feature"]);
    repo.commit("b.txt", "feature work");
    repo.git(&["tag", "v1"]);
    repo.git(&["switch", "--quiet", "--create", "old", "main"]);
    repo.commit("c.txt", "old work");
    repo.git(&["switch", "--quiet", "main"]);
    repo.commit("d.txt", "main work");

    let summaries = |snapshot: &repo::RepoSnapshot| -> Vec<String> {
        snapshot.commits.iter().map(|c| c.summary.clone()).collect()
    };
    let labels = |snapshot: &repo::RepoSnapshot| -> Vec<String> {
        let mut names: Vec<String> = snapshot
            .commits
            .iter()
            .flat_map(|c| c.refs.iter().map(|r| r.name.clone()))
            .collect();
        names.sort();
        names
    };

    let hidden = repo::load_with(
        repo.path(),
        LoadOptions {
            hidden: vec!["refs/heads/old".into(), "refs/heads/main".into()],
            ..options(100)
        },
    )
    .unwrap();
    assert!(!summaries(&hidden).contains(&"old work".to_owned()));
    assert_eq!(
        labels(&hidden),
        vec!["feature", "main", "v1"],
        "the checked-out branch stays"
    );
    assert_eq!(hidden.hidden_refs.len(), 1);
    assert_eq!(hidden.hidden_refs[0].name, "old");
    assert_eq!(hidden.hidden_refs[0].kind, RefKind::Branch);

    let solo = repo::load_with(
        repo.path(),
        LoadOptions {
            solo: vec!["refs/heads/feature".into()],
            ..options(100)
        },
    )
    .unwrap();
    assert_eq!(
        summaries(&solo),
        vec!["main work", "feature work", "base"],
        "the soloed branch and the checked-out one"
    );
    assert_eq!(labels(&solo), vec!["feature", "main"]);
    let hidden_names: Vec<&str> = solo.hidden_refs.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(hidden_names, vec!["old", "v1"]);
}

#[test]
fn reports_commit_times_identity_links_and_fetch_time() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("links-remote.git");
    let mut repo = TempRepo::new("links");
    with_identity(&repo);
    repo.git(&["remote", "add", "origin", remote.url()]);
    repo.commit("a.txt", "First");
    repo.git(&["push", "--quiet", "origin", "main"]);

    let before = repo::load(repo.path(), 100, false).unwrap();
    assert_eq!(before.last_fetched, None);
    assert!(
        before.web_remotes.is_empty(),
        "a local path has no web page"
    );
    let user = before.user.as_ref().unwrap();
    assert_eq!(user.email.as_deref(), Some("committer@example.com"));
    assert_eq!(before.commits[0].commit_time, before.commits[0].time);

    run(&repo, Action::Fetch { background: false }).unwrap();
    repo.git(&[
        "remote",
        "set-url",
        "origin",
        "git@github.com:owner/repo.git",
    ]);
    let after = repo::load(repo.path(), 100, false).unwrap();
    assert!(after.last_fetched.is_some());
    assert_eq!(after.web_remotes.len(), 1);
    assert_eq!(after.web_remotes[0].name, "origin");
    assert_eq!(after.web_remotes[0].url, "https://github.com/owner/repo");
}

#[test]
fn lists_what_moved_head_and_what_arrived_on_branches() {
    let mut repo = TempRepo::new("reflog");
    with_identity(&repo);
    let first = repo.commit("a.txt", "First");
    let lost = repo.commit("b.txt", "Soon lost");
    repo.git(&["reset", "--quiet", "--hard", &first]);

    let entries = repo::reflog(repo.path(), 10).unwrap();
    assert!(
        entries[0].message.starts_with("reset: moving to"),
        "{:?}",
        entries[0]
    );
    assert_eq!(entries[0].previous.as_deref(), Some(lost.as_str()));
    assert!(
        entries
            .iter()
            .any(|entry| entry.id == lost && entry.summary == "Soon lost")
    );
    assert_eq!(repo::reflog(repo.path(), 1).unwrap().len(), 1);

    // Commits between two points, for "new commits" notices.
    let mut other = TempRepo::new("reflog-between");
    with_identity(&other);
    let start = other.commit("a.txt", "Start");
    other.commit("b.txt", "One");
    other.commit("c.txt", "Two");
    let end = head(&other);
    let news = repo::commits_between(other.path(), &start, &end).unwrap();
    assert_eq!(news.count, 2);
    assert_eq!(news.authors, vec!["Test Author"]);
}

#[test]
fn reports_where_remote_branches_are() {
    let _turn = remote_turn();
    let remote = TempRepo::bare("state-remote.git");
    let mut alice = TempRepo::new("state-alice");
    alice.git(&["remote", "add", "origin", remote.url()]);
    let tip = alice.commit("a.txt", "First");
    alice.git(&["push", "--quiet", "-u", "origin", "main"]);
    let state = repo::remote_state(alice.path()).unwrap();
    assert_eq!(state.tips.get("origin/main"), Some(&tip));
    assert_eq!(state.upstream.as_deref(), Some("origin/main"));
    assert_eq!(state.remotes, vec!["origin"]);
}

#[test]
fn lists_the_commits_that_changed_a_file_or_folder() {
    let mut repo = TempRepo::new("history");
    with_identity(&repo);
    std::fs::create_dir_all(repo.path().join("Content")).unwrap();
    let first = repo.commit("Content/hero.txt", "Hero v1");
    let readme = repo.commit("readme.txt", "Readme");
    let second = repo.commit("Content/hero.txt", "Hero v2");
    repo.git(&["mv", "Content/hero.txt", "Content/main-hero.txt"]);
    repo.git(&["commit", "--quiet", "-m", "Rename the hero"]);
    let renamed = head(&repo);
    // A change on another branch counts too: the graph shows every branch.
    repo.git(&["switch", "--quiet", "--create", "side"]);
    let side = repo.commit("Content/main-hero.txt", "Hero on a side branch");
    repo.git(&["switch", "--quiet", "main"]);

    let history = actions::file_history(repo.path(), "Content/main-hero.txt").unwrap();
    assert!(!history.folder);
    assert_eq!(
        history.ids,
        vec![side.clone(), renamed.clone(), second.clone(), first.clone()]
    );
    assert_eq!(
        history.names,
        vec!["Content/main-hero.txt", "Content/hero.txt"]
    );

    let folder = actions::file_history(repo.path(), "Content").unwrap();
    assert!(folder.folder);
    assert_eq!(folder.path, "Content");
    assert_eq!(folder.ids, vec![side, renamed, second, first]);

    // An absolute path inside the repository, as a file picker gives it.
    let absolute = repo.path().join("readme.txt");
    let history = actions::file_history(repo.path(), absolute.to_str().unwrap()).unwrap();
    assert_eq!(history.path, "readme.txt");
    assert_eq!(history.ids, vec![readme]);

    // Names are taken literally, not as patterns.
    assert!(
        actions::file_history(repo.path(), "Content/*.txt")
            .unwrap()
            .ids
            .is_empty()
    );
    let outside = std::env::temp_dir().join("somewhere-else.txt");
    assert!(actions::file_history(repo.path(), outside.to_str().unwrap()).is_err());
    assert!(actions::file_history(repo.path(), "../elsewhere").is_err());
}

#[test]
fn shows_who_changed_each_line() {
    let repo = TempRepo::new("blame");
    std::fs::write(repo.path().join("notes.txt"), "one\ntwo\n").unwrap();
    repo.git(&["add", "notes.txt"]);
    repo.git(&["commit", "-qm", "First notes"]);
    let first = repo.git(&["rev-parse", "HEAD"]);
    std::fs::write(repo.path().join("notes.txt"), "one\nTWO\nthree\n").unwrap();
    repo.git(&["commit", "-qam", "Shout the second note"]);
    let second = repo.git(&["rev-parse", "HEAD"]);
    std::fs::write(repo.path().join("notes.txt"), "one\nTWO\nthree\nfour\n").unwrap();

    let blame = tributary_lib::actions::blame(repo.path(), "notes.txt", None).unwrap();
    let who: Vec<(&str, Option<&str>)> = blame
        .lines
        .iter()
        .map(|line| (line.text.as_str(), blame.commits[line.commit].id.as_deref()))
        .collect();
    assert_eq!(
        who,
        [
            ("one", Some(first.as_str())),
            ("TWO", Some(second.as_str())),
            ("three", Some(second.as_str())),
            // Not committed yet.
            ("four", None),
        ]
    );
    let shout = &blame.commits[blame.lines[1].commit];
    assert_eq!(shout.summary, "Shout the second note");
    assert_eq!(shout.author, "Test Author");

    // As it was at the first commit.
    let then = tributary_lib::actions::blame(repo.path(), "notes.txt", Some(&first)).unwrap();
    assert_eq!(then.lines.len(), 2);
    assert_eq!(then.commits.len(), 1);
    assert!(tributary_lib::actions::blame(repo.path(), "missing.txt", None).is_err());
}

#[test]
fn searches_history_by_file_and_by_code() {
    use tributary_lib::actions::{SearchMode, search_commits};
    let repo = TempRepo::new("search");
    std::fs::create_dir_all(repo.path().join("src/Store")).unwrap();
    std::fs::write(
        repo.path().join("src/Store/notes.ts"),
        "export const LIMIT = 10;\n",
    )
    .unwrap();
    std::fs::write(repo.path().join("README.md"), "Notes\n").unwrap();
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-qm", "Start"]);
    let start = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["switch", "-q", "-c", "feature"]);
    std::fs::write(
        repo.path().join("src/Store/notes.ts"),
        "export const LIMIT = 500;\n",
    )
    .unwrap();
    repo.git(&["commit", "-qam", "Bigger pages"]);
    let bigger = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["switch", "-q", "main"]);
    std::fs::write(repo.path().join("README.md"), "Notes, faster\n").unwrap();
    repo.git(&["commit", "-qam", "Readme"]);

    // Any branch, any case, anywhere in the path.
    let found = search_commits(repo.path(), SearchMode::Files, "store/NOTES").unwrap();
    assert_eq!(found.ids, [bigger.clone(), start.clone()]);
    let patterns = search_commits(repo.path(), SearchMode::Files, "*.md").unwrap();
    assert_eq!(patterns.ids.len(), 2);
    // Where "LIMIT = 500" came in.
    let code = search_commits(repo.path(), SearchMode::Code, "LIMIT = 500").unwrap();
    assert_eq!(code.ids, [bigger]);
    assert!(
        search_commits(repo.path(), SearchMode::Code, "")
            .unwrap()
            .ids
            .is_empty()
    );
    assert!(
        search_commits(repo.path(), SearchMode::Code, "--all")
            .unwrap()
            .ids
            .is_empty()
    );
}
