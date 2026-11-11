//! Git LFS: upload progress, file locks (against a small fake LFS server), big files, cleaning up.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::process::Command;

use common::{TempRepo, lfs_installed, remote_turn, run, with_identity};
use tributary_lib::actions::{Action, CloneOptions, LockRef};
use tributary_lib::git::{self, Progress};
use tributary_lib::{actions, locks};

/// Git LFS uploads its files before git's own push, and says nothing about it unless it's
/// writing to a terminal. The push reports those uploads too. Skipped without Git LFS.
#[test]
fn reports_git_lfs_uploads_while_pushing() {
    let installed = Command::new("git")
        .args(["lfs", "version"])
        .output()
        .is_ok_and(|output| output.status.success());
    if !installed {
        eprintln!("Git LFS isn't installed: skipped");
        return;
    }
    let _turn = remote_turn();
    let remote = TempRepo::bare("lfs-remote.git");
    let alice = TempRepo::new("lfs-alice");
    alice.git(&["lfs", "install", "--local"]);
    alice.git(&["lfs", "track", "*.bin"]);
    alice.git(&["remote", "add", "origin", remote.url()]);
    std::fs::write(alice.path().join("video.bin"), vec![7u8; 3_000_000]).unwrap();
    alice.git(&["add", ".gitattributes", "video.bin"]);
    alice.git(&["commit", "--quiet", "-m", "Add a video"]);

    let reports = std::cell::RefCell::new(Vec::new());
    actions::run_with_progress(
        alice.path(),
        Action::Push {
            force: false,
            no_verify: false,
        },
        &|progress| reports.borrow_mut().push(progress),
    )
    .unwrap();
    let reports = reports.into_inner();
    let uploads: Vec<_> = reports
        .iter()
        .filter(|progress| progress.phase == "Uploading LFS files")
        .collect();
    assert!(!uploads.is_empty(), "no LFS progress in {reports:?}");
    assert_eq!(uploads.last().unwrap().percent, Some(100));
    assert_eq!(
        uploads.last().unwrap().detail.as_deref(),
        Some("1 of 1 files")
    );
    assert!(
        remote.path().join("lfs/objects").is_dir(),
        "the file reached the remote"
    );
}

/// A pull checks out each Git LFS file in turn, and LFS downloads it then, knowing only
/// that one: the pull counts them all from the commits it brings in.
#[test]
fn counts_the_git_lfs_files_a_pull_downloads() {
    if !lfs_installed() {
        eprintln!("Git LFS isn't installed: skipped");
        return;
    }
    let _turn = remote_turn();
    let remote = TempRepo::bare("count-remote.git");
    let alice = TempRepo::new("count-alice");
    alice.git(&["lfs", "install", "--local"]);
    alice.git(&["lfs", "track", "*.bin"]);
    alice.git(&["remote", "add", "origin", remote.url()]);
    std::fs::write(alice.path().join("first.bin"), vec![1u8; 30_000]).unwrap();
    alice.git(&["add", ".gitattributes", "first.bin"]);
    alice.git(&["commit", "--quiet", "-m", "First file"]);
    alice.git(&["push", "--quiet", "-u", "origin", "main"]);

    let bob = TempRepo::clone_of("count-bob", &remote);
    bob.git(&["lfs", "install", "--local"]);
    bob.git(&["lfs", "pull"]);
    // Three new files, and one already here (the same content as first.bin).
    for (name, byte) in [("a.bin", 2u8), ("b.bin", 3), ("c.bin", 4)] {
        std::fs::write(alice.path().join(name), vec![byte; 30_000]).unwrap();
    }
    std::fs::write(alice.path().join("again.bin"), vec![1u8; 30_000]).unwrap();
    alice.git(&["add", "a.bin", "b.bin", "c.bin", "again.bin"]);
    alice.git(&["commit", "--quiet", "-m", "More files"]);
    alice.git(&["push", "--quiet", "origin", "main"]);

    let reports = std::cell::RefCell::new(Vec::new());
    actions::run_with_progress(bob.path(), Action::Pull, &|progress| {
        reports.borrow_mut().push(progress)
    })
    .unwrap();
    let reports = reports.into_inner();
    let counted: Vec<_> = reports
        .iter()
        .filter_map(|progress| progress.files)
        .collect();
    let story = what_happened(&bob, &reports);
    assert!(!counted.is_empty(), "no file counts while pulling\n{story}");
    // At the end, exactly: the three new files (again.bin's content was here already).
    let last = counted.last().unwrap();
    assert_eq!((last.done, last.total), (3, 3), "{counted:?}\n{story}");
    assert!(counted.iter().all(|count| count.done <= count.total));
    assert_eq!(
        std::fs::read(bob.path().join("c.bin")).unwrap(),
        vec![4u8; 30_000]
    );
}

/// Checking out a remote branch downloads the Git LFS files it needs first, all together,
/// so the checkout finds them here.
#[test]
fn downloads_a_branchs_git_lfs_files_before_checking_it_out() {
    if !lfs_installed() {
        eprintln!("Git LFS isn't installed: skipped");
        return;
    }
    let _turn = remote_turn();
    let remote = TempRepo::bare("switch-remote.git");
    let alice = TempRepo::new("switch-alice");
    alice.git(&["lfs", "install", "--local"]);
    alice.git(&["lfs", "track", "*.bin"]);
    alice.git(&["remote", "add", "origin", remote.url()]);
    alice.git(&["add", ".gitattributes"]);
    alice.git(&["commit", "--quiet", "-m", "Track bins"]);
    alice.git(&["push", "--quiet", "-u", "origin", "main"]);
    alice.git(&["switch", "--quiet", "-c", "art"]);
    for (name, byte) in [("one.bin", 5u8), ("two.bin", 6)] {
        std::fs::write(alice.path().join(name), vec![byte; 20_000]).unwrap();
    }
    alice.git(&["add", "one.bin", "two.bin"]);
    alice.git(&["commit", "--quiet", "-m", "Art"]);
    alice.git(&["push", "--quiet", "origin", "art"]);

    let bob = TempRepo::clone_of("switch-bob", &remote);
    bob.git(&["lfs", "install", "--local"]);
    let reports = std::cell::RefCell::new(Vec::new());
    actions::run_with_progress(
        bob.path(),
        Action::CheckoutRemoteBranch {
            name: "origin/art".into(),
        },
        &|progress| reports.borrow_mut().push(progress),
    )
    .unwrap();
    let reports = reports.into_inner();
    let counted: Vec<_> = reports
        .iter()
        .filter_map(|progress| progress.files)
        .collect();
    assert_eq!(
        counted.last().map(|count| (count.done, count.total)),
        Some((2, 2)),
        "{counted:?}\n{}",
        what_happened(&bob, &reports)
    );
    assert_eq!(
        std::fs::read(bob.path().join("two.bin")).unwrap(),
        vec![6u8; 20_000]
    );
}

/// For a failed count, what went on: every progress report, and each git command the app ran
/// in `repo` (in order, with whether it worked and what it said). The counts come from
/// commands whose failures are otherwise passed over quietly, so this says which one it was.
fn what_happened(repo: &TempRepo, reports: &[Progress]) -> String {
    let mut story = String::from("Progress reports:\n");
    for report in reports {
        story.push_str(&format!(
            "  {} {:?} {:?} files {:?}\n",
            report.phase, report.percent, report.detail, report.files
        ));
    }
    story.push_str("Git commands here:\n");
    let here = repo.path().to_string_lossy().into_owned();
    for entry in git::activity()
        .into_iter()
        .filter(|entry| entry.folder == here)
    {
        story.push_str(&format!(
            "  git {} ({}, {} ms)\n",
            entry.args.join(" "),
            if entry.success { "worked" } else { "FAILED" },
            entry.duration_ms
        ));
        for line in entry.output.lines().take(12) {
            story.push_str(&format!("    | {line}\n"));
        }
    }
    story
}

/// A Git LFS server that only does locking, as `rosa` sees it from her side: every
/// request comes from `maya`. Without `verify`, it can't tell whose locks are whose.
struct LockServer {
    url: String,
}

type ServerLocks = std::sync::Arc<std::sync::Mutex<Vec<(String, String, String)>>>;

fn lock_server(verify: bool) -> LockServer {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/lfs", listener.local_addr().unwrap());
    let locks: ServerLocks = std::sync::Arc::new(std::sync::Mutex::new(vec![(
        "1".into(),
        "Content/Map.umap".into(),
        "rosa".into(),
    )]));
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let locks = locks.clone();
            std::thread::spawn(move || serve_locks(stream, &locks, verify));
        }
    });
    LockServer { url }
}

fn serve_locks(stream: std::net::TcpStream, locks: &ServerLocks, verify: bool) {
    use std::io::{BufRead, Read, Write};
    let mut writer = stream.try_clone().unwrap();
    let mut reader = std::io::BufReader::new(stream);
    loop {
        let mut request = String::new();
        if reader.read_line(&mut request).unwrap_or(0) == 0 {
            return;
        }
        let mut length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let line = line.trim_end().to_ascii_lowercase();
            if line.is_empty() {
                break;
            }
            if let Some(value) = line.strip_prefix("content-length:") {
                length = value.trim().parse().unwrap();
            }
        }
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
        let mut words = request.split_whitespace();
        let method = words.next().unwrap_or_default().to_owned();
        let target = words.next().unwrap_or_default().to_owned();
        let (path, query) = target.split_once('?').unwrap_or((&target, ""));
        let path = path.to_owned();
        // Listing can be narrowed to one path or id.
        let filter: Vec<(String, String)> = query
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .filter(|(key, value)| (*key == "path" || *key == "id") && !value.is_empty())
            .map(|(key, value)| {
                (
                    key.to_owned(),
                    value.replace("%2F", "/").replace("%2f", "/"),
                )
            })
            .collect();

        let json = |(id, path, owner): &(String, String, String)| serde_json::json!({ "id": id, "path": path, "owner": { "name": owner }, "locked_at": "2026-03-01T10:00:00Z" });
        let mut list = locks.lock().unwrap();
        let (status, reply) = if method == "GET" && path.ends_with("/locks") {
            let all: Vec<_> = list
                .iter()
                .filter(|l| {
                    filter.iter().all(|(key, value)| {
                        if key == "path" {
                            &l.1 == value
                        } else {
                            &l.0 == value
                        }
                    })
                })
                .map(json)
                .collect();
            (
                "200 OK",
                serde_json::json!({ "locks": all, "next_cursor": "" }),
            )
        } else if method == "POST" && path.ends_with("/locks/verify") {
            if verify {
                let ours: Vec<_> = list.iter().filter(|l| l.2 == "maya").map(json).collect();
                let theirs: Vec<_> = list.iter().filter(|l| l.2 != "maya").map(json).collect();
                (
                    "200 OK",
                    serde_json::json!({ "ours": ours, "theirs": theirs, "next_cursor": "" }),
                )
            } else {
                (
                    "404 Not Found",
                    serde_json::json!({ "message": "Not found" }),
                )
            }
        } else if method == "POST" && path.ends_with("/locks") {
            let file = body["path"].as_str().unwrap_or_default().to_owned();
            if let Some(existing) = list.iter().find(|l| l.1 == file) {
                let existing = json(existing);
                (
                    "409 Conflict",
                    serde_json::json!({ "lock": existing, "message": "already created lock" }),
                )
            } else {
                let lock = ((list.len() + 10).to_string(), file, "maya".to_owned());
                let reply = serde_json::json!({ "lock": json(&lock) });
                list.push(lock);
                ("201 Created", reply)
            }
        } else if method == "POST" && path.ends_with("/unlock") {
            let id = path
                .trim_end_matches("/unlock")
                .rsplit('/')
                .next()
                .unwrap()
                .to_owned();
            let force = body["force"].as_bool().unwrap_or(false);
            match list.iter().position(|l| l.0 == id) {
                Some(index) if list[index].2 == "maya" || force => {
                    let lock = list.remove(index);
                    ("200 OK", serde_json::json!({ "lock": json(&lock) }))
                }
                Some(_) => (
                    "403 Forbidden",
                    serde_json::json!({ "message": "You must have admin access to force delete a lock" }),
                ),
                None => (
                    "404 Not Found",
                    serde_json::json!({ "message": "unable to find lock" }),
                ),
            }
        } else {
            (
                "404 Not Found",
                serde_json::json!({ "message": "Not found" }),
            )
        };
        drop(list);
        let reply = reply.to_string();
        write!(
            writer,
            "HTTP/1.1 {status}\r\nContent-Type: application/vnd.git-lfs+json\r\nContent-Length: {}\r\n\r\n{reply}",
            reply.len()
        )
        .unwrap();
    }
}

#[test]
fn locks_and_unlocks_files_with_git_lfs() {
    if !lfs_installed() {
        eprintln!("Git LFS isn't installed: skipped");
        return;
    }
    // Without LFS, no server is asked.
    let mut plain = TempRepo::new("locks-plain");
    plain.commit("a.txt", "First");
    let none = locks::locks(plain.path()).unwrap();
    assert!(!none.supported);

    for verify in [true, false] {
        let server = lock_server(verify);
        let mut repo = TempRepo::new(if verify { "locks" } else { "locks-noverify" });
        with_identity(&repo);
        repo.git(&["config", "lfs.url", &server.url]);
        std::fs::create_dir_all(repo.path().join("Content")).unwrap();
        repo.commit(".gitattributes", "*.uasset lockable\n*.umap lockable\n");
        repo.commit("Content/Hero.uasset", "hero");

        let listed = locks::locks(repo.path()).unwrap();
        assert!(listed.supported, "{listed:?}");
        assert_eq!(listed.error, None);
        assert_eq!(listed.locks.len(), 1);
        assert_eq!(listed.locks[0].path, "Content/Map.umap");
        assert_eq!(listed.locks[0].owner, "rosa");
        assert!(!listed.locks[0].mine);

        assert_eq!(
            run(
                &repo,
                Action::LockFiles {
                    paths: vec!["Content/Hero.uasset".into()]
                }
            )
            .unwrap(),
            "Locked Hero.uasset"
        );
        let listed = locks::locks(repo.path()).unwrap();
        let paths: Vec<_> = listed
            .locks
            .iter()
            .map(|lock| (lock.path.as_str(), lock.mine))
            .collect();
        // Yours first.
        assert_eq!(
            paths,
            vec![("Content/Hero.uasset", true), ("Content/Map.umap", false)],
            "verify: {verify}"
        );

        // Someone else's lock can't be taken, or removed without forcing.
        let error = run(
            &repo,
            Action::LockFiles {
                paths: vec!["Content/Map.umap".into()],
            },
        )
        .unwrap_err();
        assert!(error.starts_with("Couldn't lock Map.umap"), "{error}");
        let lock_of = |path: &str| {
            let lock = locks::locks(repo.path())
                .unwrap()
                .locks
                .into_iter()
                .find(|lock| lock.path == path)
                .unwrap();
            vec![LockRef {
                id: lock.id,
                path: lock.path,
            }]
        };
        assert!(
            run(
                &repo,
                Action::UnlockFiles {
                    locks: lock_of("Content/Map.umap"),
                    force: false
                }
            )
            .is_err()
        );

        assert_eq!(
            run(
                &repo,
                Action::UnlockFiles {
                    locks: lock_of("Content/Hero.uasset"),
                    force: false
                }
            )
            .unwrap(),
            "Unlocked Hero.uasset"
        );
        assert_eq!(locks::locks(repo.path()).unwrap().locks.len(), 1);
        // Map.umap isn't even in this working tree: locks are released by id.
        let forced = run(
            &repo,
            Action::UnlockFiles {
                locks: lock_of("Content/Map.umap"),
                force: true,
            },
        );
        assert_eq!(forced, Ok("Unlocked Map.umap".to_owned()));
        assert!(locks::locks(repo.path()).unwrap().locks.is_empty());
    }
}

#[test]
fn checks_changed_files_for_size_and_locking() {
    let mut repo = TempRepo::new("file-checks");
    repo.commit(
        ".gitattributes",
        "*.uasset lockable\n*.psd filter=lfs diff=lfs merge=lfs -text\n",
    );
    std::fs::write(repo.path().join("big.wav"), vec![1u8; 3000]).unwrap();
    std::fs::write(repo.path().join("art.psd"), vec![1u8; 3000]).unwrap();
    std::fs::write(repo.path().join("hero.uasset"), vec![1u8; 100]).unwrap();
    std::fs::write(repo.path().join("small.txt"), "small").unwrap();
    // A new folder is one entry in the status: the files in it are looked at.
    std::fs::create_dir_all(repo.path().join("Cinematics/Intro")).unwrap();
    std::fs::write(
        repo.path().join("Cinematics/Intro/intro.mp4"),
        vec![1u8; 4000],
    )
    .unwrap();
    let files: Vec<String> = [
        "big.wav",
        "art.psd",
        "hero.uasset",
        "small.txt",
        "gone/",
        "Cinematics/",
    ]
    .iter()
    .map(|f| (*f).to_owned())
    .collect();
    let checks = actions::file_checks(repo.path(), &files, &[], 1000).unwrap();
    // art.psd is big too, but it goes to Git LFS.
    let large: Vec<_> = checks
        .large
        .iter()
        .map(|f| (f.path.as_str(), f.size))
        .collect();
    assert_eq!(
        large,
        vec![("big.wav", 3000), ("Cinematics/Intro/intro.mp4", 4000)]
    );
    assert_eq!(checks.lockable, vec!["hero.uasset"]);
    assert!(checks.uses_lfs);
}

#[test]
fn moves_staged_files_into_git_lfs() {
    if !lfs_installed() {
        eprintln!("Git LFS isn't installed: skipped");
        return;
    }
    let mut repo = TempRepo::new("track-lfs");
    with_identity(&repo);
    repo.commit("a.txt", "First");
    std::fs::write(repo.path().join("level.umap"), vec![7u8; 5000]).unwrap();
    repo.git(&["add", "level.umap"]);
    assert_eq!(
        run(
            &repo,
            Action::TrackWithLfs {
                patterns: vec!["*.umap".into()],
                paths: vec!["level.umap".into()],
            },
        )
        .unwrap(),
        "Now storing *.umap with Git LFS"
    );
    // The index now holds a small pointer to the LFS file, and .gitattributes is staged.
    let staged = repo.git(&["show", ":level.umap"]);
    assert!(staged.starts_with("version https://git-lfs"), "{staged}");
    assert!(
        repo.git(&["show", ":.gitattributes"])
            .contains("*.umap filter=lfs")
    );
    let files = vec!["level.umap".to_owned()];
    assert!(
        actions::file_checks(repo.path(), &files, &[], 1000)
            .unwrap()
            .large
            .is_empty()
    );
}

#[test]
fn measures_and_prunes_local_git_lfs_files() {
    if !lfs_installed() {
        eprintln!("Git LFS isn't installed: skipped");
        return;
    }
    let repo = TempRepo::new("lfs-prune");
    with_identity(&repo);
    repo.git(&["lfs", "install", "--local"]);
    repo.git(&["lfs", "track", "*.bin"]);
    std::fs::write(repo.path().join("video.bin"), vec![3u8; 20_000]).unwrap();
    repo.git(&["add", ".gitattributes", "video.bin"]);
    repo.git(&["commit", "--quiet", "-m", "Add a video"]);
    let storage = actions::lfs_storage_of(repo.path())
        .unwrap()
        .expect("uses LFS");
    assert!(storage.bytes >= 20_000, "{storage:?}");
    assert_eq!(storage.files, 1);
    // The checked-out file's copy is kept.
    let message = run(&repo, Action::PruneLfs).unwrap();
    assert!(message.starts_with("Freed "), "{message}");
    assert_eq!(
        actions::lfs_storage_of(repo.path()).unwrap().unwrap().files,
        1
    );
    // Without LFS, there's nothing to measure.
    let mut plain = TempRepo::new("lfs-prune-plain");
    plain.commit("a.txt", "First");
    assert!(actions::lfs_storage_of(plain.path()).unwrap().is_none());
}

/// A clone without its Git LFS files has pointer files where they should be; downloading
/// them puts the real files there.
#[test]
fn finds_and_downloads_git_lfs_files_left_as_pointers() {
    if !lfs_installed() {
        eprintln!("Git LFS isn't installed: skipped");
        return;
    }
    let _turn = remote_turn();
    let remote = TempRepo::bare("pointers-remote.git");
    let alice = TempRepo::new("pointers-alice");
    alice.git(&["lfs", "install", "--local"]);
    alice.git(&["lfs", "track", "*.bin"]);
    alice.git(&["remote", "add", "origin", remote.url()]);
    std::fs::write(alice.path().join("one.bin"), vec![1u8; 40_000]).unwrap();
    std::fs::write(alice.path().join("two.bin"), vec![2u8; 40_000]).unwrap();
    alice.git(&["add", ".gitattributes", "one.bin", "two.bin"]);
    alice.git(&["commit", "--quiet", "-m", "Add two files"]);
    alice.git(&["push", "--quiet", "origin", "main"]);
    assert_eq!(
        actions::lfs_health(alice.path()).unwrap().unwrap().pointers,
        0
    );

    let parent = TempRepo::empty("pointers-parent");
    let options = CloneOptions {
        skip_lfs: true,
        ..CloneOptions::default()
    };
    let clone =
        actions::clone_repository(remote.url(), parent.path(), "copy", &options, &|_| {}).unwrap();
    let health = actions::lfs_health(&clone).unwrap().unwrap();
    assert_eq!(health.pointers, 2);
    assert_eq!(health.examples, vec!["one.bin", "two.bin"]);
    assert!(std::fs::metadata(clone.join("one.bin")).unwrap().len() < 1000);

    let message = actions::run(&clone, Action::DownloadLfsFiles).unwrap();
    assert_eq!(message, "Downloaded 2 files");
    assert_eq!(
        std::fs::read(clone.join("one.bin")).unwrap(),
        vec![1u8; 40_000]
    );
    assert_eq!(actions::lfs_health(&clone).unwrap().unwrap().pointers, 0);
    let again = actions::run(&clone, Action::DownloadLfsFiles).unwrap();
    assert_eq!(again, "Every file stored with Git LFS is already here");

    // A repository without Git LFS has nothing to report.
    let mut plain = TempRepo::new("pointers-plain");
    plain.commit("a.txt", "First");
    assert!(actions::lfs_health(plain.path()).unwrap().is_none());
}

#[test]
fn suggests_big_file_types_and_tracks_and_untracks_them() {
    if !lfs_installed() {
        return;
    }
    let mut repo = TempRepo::new("lfs-settings");
    repo.commit("notes.txt", "notes");
    std::fs::write(repo.path().join("Hero.psd"), vec![7u8; 2 * 1024 * 1024]).unwrap();
    std::fs::write(repo.path().join("Theme.wav"), vec![1u8; 3 * 1024 * 1024]).unwrap();
    std::fs::write(repo.path().join("small.png"), vec![1u8; 1000]).unwrap();

    let settings = actions::lfs_settings(repo.path()).unwrap();
    assert!(settings.installed);
    assert!(settings.patterns.is_empty());
    let suggested: Vec<(&str, usize)> = settings
        .suggestions
        .iter()
        .map(|s| (s.pattern.as_str(), s.files))
        .collect();
    // The biggest first; small files aren't suggested.
    assert_eq!(suggested, vec![("*.wav", 1), ("*.psd", 1)]);

    let track = Action::TrackWithLfs {
        patterns: vec!["*.psd".into()],
        paths: Vec::new(),
    };
    assert_eq!(run(&repo, track).unwrap(), "Tracking *.psd with Git LFS");
    let settings = actions::lfs_settings(repo.path()).unwrap();
    assert_eq!(settings.patterns, vec!["*.psd"]);
    assert_eq!(settings.suggestions.len(), 1);

    let untrack = Action::UntrackWithLfs {
        patterns: vec!["*.psd".into()],
    };
    assert_eq!(
        run(&repo, untrack).unwrap(),
        "No longer storing *.psd with Git LFS"
    );
    assert!(
        actions::lfs_settings(repo.path())
            .unwrap()
            .patterns
            .is_empty()
    );
}

#[test]
fn downloads_only_the_git_lfs_files_in_chosen_folders() {
    if !lfs_installed() {
        eprintln!("Git LFS isn't installed: skipped");
        return;
    }
    let _turn = remote_turn();
    let remote = TempRepo::bare("folders-remote.git");
    let alice = TempRepo::new("folders-alice");
    alice.git(&["lfs", "install", "--local"]);
    alice.git(&["lfs", "track", "*.bin"]);
    alice.git(&["remote", "add", "origin", remote.url()]);
    for (folder, byte) in [("Art", 1u8), ("Audio", 2u8)] {
        std::fs::create_dir_all(alice.path().join(folder)).unwrap();
        std::fs::write(
            alice.path().join(folder).join("big.bin"),
            vec![byte; 30_000],
        )
        .unwrap();
    }
    alice.git(&["add", "."]);
    alice.git(&["commit", "--quiet", "-m", "Art and audio"]);
    alice.git(&["push", "--quiet", "origin", "main"]);

    let parent = TempRepo::empty("folders-parent");
    let options = CloneOptions {
        skip_lfs: true,
        ..CloneOptions::default()
    };
    let clone =
        actions::clone_repository(remote.url(), parent.path(), "copy", &options, &|_| {}).unwrap();
    let settings = actions::lfs_settings(&clone).unwrap();
    let folders: Vec<(&str, usize, usize)> = settings
        .folders
        .iter()
        .map(|f| (f.path.as_str(), f.files, f.downloaded))
        .collect();
    assert_eq!(folders, vec![("Art", 1, 0), ("Audio", 1, 0)]);
    assert!(settings.fetch_include.is_empty());

    let message = actions::run(
        &clone,
        Action::SetLfsFetchFolders {
            include: vec!["Art".into()],
            exclude: Vec::new(),
        },
    )
    .unwrap();
    assert_eq!(message, "Git LFS files are downloaded only from Art");
    assert_eq!(
        actions::lfs_settings(&clone).unwrap().fetch_include,
        vec!["Art"]
    );
    // Audio isn't wanted, so its pointer file doesn't count as missing.
    assert_eq!(actions::lfs_health(&clone).unwrap().unwrap().pointers, 1);

    assert_eq!(
        actions::run(&clone, Action::DownloadLfsFiles).unwrap(),
        "Downloaded 1 file"
    );
    assert_eq!(
        std::fs::read(clone.join("Art/big.bin")).unwrap(),
        vec![1u8; 30_000]
    );
    assert!(
        std::fs::metadata(clone.join("Audio/big.bin"))
            .unwrap()
            .len()
            < 1000
    );
    assert_eq!(actions::lfs_health(&clone).unwrap().unwrap().pointers, 0);

    // Commas would split a folder in two.
    assert!(
        actions::run(
            &clone,
            Action::SetLfsFetchFolders {
                include: vec!["Art,Audio".into()],
                exclude: Vec::new(),
            },
        )
        .is_err()
    );
    assert_eq!(
        actions::run(
            &clone,
            Action::SetLfsFetchFolders {
                include: Vec::new(),
                exclude: Vec::new(),
            },
        )
        .unwrap(),
        "Git LFS files are downloaded from every folder again"
    );
    assert!(
        actions::lfs_settings(&clone)
            .unwrap()
            .fetch_include
            .is_empty()
    );
}

#[test]
fn finds_what_makes_the_repository_big_and_moves_it_into_lfs() {
    if !common::lfs_installed() {
        return;
    }
    let mut repo = TempRepo::new("repo-size");
    with_identity(&repo);
    repo.commit("a.txt", "base");
    std::fs::write(repo.path().join("old.bin"), vec![7u8; 300_000]).unwrap();
    repo.git(&["add", "old.bin"]);
    repo.git(&["commit", "--quiet", "-m", "A big file"]);
    repo.git(&["rm", "--quiet", "old.bin"]);
    repo.git(&["commit", "--quiet", "-m", "Gone again"]);
    std::fs::write(repo.path().join("art.psd"), vec![1u8; 200_000]).unwrap();
    repo.git(&["add", "art.psd"]);
    repo.git(&["commit", "--quiet", "-m", "Art"]);

    let size = actions::repo_size(repo.path()).unwrap();
    let names: Vec<(&str, bool)> = size
        .biggest
        .iter()
        .take(2)
        .map(|f| (f.path.as_str(), f.current))
        .collect();
    assert_eq!(names, vec![("old.bin", false), ("art.psd", true)]);
    assert!(size.kinds.iter().any(|k| k.name == "*.bin"));
    assert!(size.history_bytes > 0);

    // Not pushed anywhere: the branch's commits are all rewritten.
    let message = run(
        &repo,
        Action::MigrateToLfs {
            patterns: vec!["*.psd".into(), "*.bin".into()],
            everything: false,
        },
    )
    .unwrap();
    assert!(
        message.starts_with("Moved *.psd, *.bin into Git LFS"),
        "{message}"
    );
    let pointer = repo.git(&["cat-file", "-p", "HEAD:art.psd"]);
    assert!(pointer.starts_with("version https://git-lfs"), "{pointer}");
    let size = actions::repo_size(repo.path()).unwrap();
    assert!(size.biggest.iter().any(|f| f.path == "art.psd" && f.in_lfs));
    // Uncommitted changes stop it.
    std::fs::write(repo.path().join("a.txt"), "changed").unwrap();
    assert!(
        run(
            &repo,
            Action::MigrateToLfs {
                patterns: vec!["*.txt".into()],
                everything: false
            }
        )
        .is_err()
    );
}

/// An Unreal project set up badly: the engine's folders committed and not ignored, assets
/// outside Git LFS, line endings left to each computer, two names differing in capitals.
/// The check finds each, and its fixes put them right.
#[test]
fn checks_and_fixes_a_game_projects_setup() {
    if !lfs_installed() {
        eprintln!("Git LFS isn't installed: skipped");
        return;
    }
    let repo = TempRepo::new("setup-check");
    let files = [
        "Game/Game.uproject",
        "Game/Intermediate/Build/Makefile.bin",
        "Game/Content/Props/Chair.uasset",
        "Game/Content/props/Stool.uasset",
        "Game/Source/Game.cpp",
    ];
    for file in files {
        let full = repo.path().join(file);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(full, "x\n").unwrap();
    }
    repo.git(&["add", "."]);
    if common::ignores_case(repo.path()) {
        // Props and props are one folder here, so Stool.uasset went into Props. Commit it
        // the way a teammate on Linux would have: this is what a clone here then looks like.
        repo.git(&[
            "rm",
            "--cached",
            "--quiet",
            "Game/Content/Props/Stool.uasset",
        ]);
        let blob = repo.git(&["hash-object", "-w", "Game/Content/Props/Stool.uasset"]);
        repo.git(&[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("100644,{blob},Game/Content/props/Stool.uasset"),
        ]);
    }
    repo.git(&["commit", "--quiet", "-m", "Start the game"]);

    let setup = actions::project_setup(repo.path()).unwrap();
    assert_eq!(setup.engine, Some(actions::Engine::Unreal));
    assert_eq!(setup.project.as_deref(), Some("Game"));
    let status = |setup: &actions::ProjectSetup, id: &str| {
        setup
            .checks
            .iter()
            .find(|check| check.id == id)
            .map(|check| check.status)
    };
    use actions::CheckStatus::{Good, Problem, Warning};
    assert_eq!(status(&setup, "ignore"), Some(Problem));
    assert_eq!(status(&setup, "committed"), Some(Problem));
    assert_eq!(status(&setup, "lfs"), Some(Problem));
    assert_eq!(status(&setup, "lockable"), Some(Warning));
    assert_eq!(status(&setup, "text"), Some(Warning));
    assert_eq!(status(&setup, "case"), Some(Problem));

    // Each fix it offers, in turn.
    for id in [
        "lfs-installed",
        "ignore",
        "committed",
        "lfs",
        "lockable",
        "text",
    ] {
        let setup = actions::project_setup(repo.path()).unwrap();
        if let Some(fix) = setup
            .checks
            .iter()
            .find(|check| check.id == id)
            .and_then(|check| check.fix.clone())
        {
            actions::run(repo.path(), Action::FixSetup { fix }).unwrap();
        }
    }
    let after = actions::project_setup(repo.path()).unwrap();
    assert_eq!(status(&after, "ignore"), Some(Good));
    assert_eq!(status(&after, "committed"), None);
    assert_eq!(status(&after, "lfs"), Some(Good));
    assert_eq!(status(&after, "lockable"), Some(Good));
    assert_eq!(status(&after, "text"), Some(Good));
    // Renaming is up to you.
    assert_eq!(status(&after, "case"), Some(Problem));
    let attributes = std::fs::read_to_string(repo.path().join(".gitattributes")).unwrap();
    assert!(attributes.starts_with("* text=auto\n"), "{attributes}");
    assert!(
        attributes.contains("*.uasset filter=lfs diff=lfs merge=lfs -text lockable"),
        "{attributes}"
    );
    // The engine's files are still on disk.
    assert!(
        repo.path()
            .join("Game/Intermediate/Build/Makefile.bin")
            .exists()
    );
}
