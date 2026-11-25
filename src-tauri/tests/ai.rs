//! Commit messages written with AI: what's sent to the model (only the staged changes, with
//! files that aren't text named but not sent), and the message read back, against a stand-in
//! for a model on this computer that answers like OpenAI's API.

// Test helpers may panic: a failed setup fails the test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::thread::JoinHandle;

use common::TempRepo;
use serde_json::Value;
use tributary_lib::ai::{AiProvider, AiSetup, MessageStyle, write_commit_message};
use tributary_lib::error::{Error, ErrorKind};

/// One request the stand-in server was sent.
struct Asked {
    line: String,
    body: Value,
}

/// A server that answers each request with the next of `replies` (status and body), and
/// gives back what it was sent.
fn server(replies: Vec<(u16, &'static str)>) -> (String, JoinHandle<Vec<Asked>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}/v1", listener.local_addr().unwrap());
    let handle = std::thread::spawn(move || {
        let mut asked = Vec::new();
        for (status, reply) in replies {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let mut length = 0;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header.trim().is_empty() {
                    break;
                }
                if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let response = format!(
                "HTTP/1.1 {status} Whatever\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                reply.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
            asked.push(Asked {
                line: line.trim().to_owned(),
                body: serde_json::from_slice(&body).unwrap_or(Value::Null),
            });
        }
        asked
    });
    (address, handle)
}

fn local(address: &str) -> AiSetup {
    AiSetup {
        provider: AiProvider::Local,
        model: String::new(),
        address: address.to_owned(),
    }
}

/// A repository with two commits, a staged change to a text file, a staged picture, and an
/// unstaged change that mustn't be sent.
fn repository(name: &str) -> TempRepo {
    let mut repo = TempRepo::new(name);
    repo.commit("greeting.txt", "Add the greeting");
    repo.commit("notes.txt", "Write some notes");
    std::fs::write(repo.path().join("greeting.txt"), "Hello there\n").unwrap();
    std::fs::write(
        repo.path().join("logo.png"),
        [0x89, b'P', b'N', b'G', 0, 1, 2, 0, 3],
    )
    .unwrap();
    repo.git(&["add", "greeting.txt", "logo.png"]);
    std::fs::write(repo.path().join("notes.txt"), "SECRET unstaged work\n").unwrap();
    repo
}

const MODELS: &str =
    r#"{"object":"list","data":[{"id":"tiny-model","object":"model","created":1}]}"#;

#[test]
fn sends_the_staged_changes_and_reads_the_message_back() {
    let repo = repository("ai-sends");
    let (address, asked) = server(vec![
        (200, MODELS),
        (
            200,
            r#"{"choices":[{"message":{"role":"assistant","content":"```\nGreet people warmly\n\nSays hello there instead.\n```"}}]}"#,
        ),
    ]);
    let written = tauri::async_runtime::block_on(write_commit_message(
        repo.path(),
        &local(&address),
        MessageStyle::Repository,
        "greet",
    ))
    .unwrap();
    assert_eq!(written.summary, "Greet people warmly");
    assert_eq!(written.description, "Says hello there instead.");
    // A model on this computer is named by its own name; none was chosen, so the first.
    assert_eq!(written.by, "tiny-model");
    assert_eq!(written.files, 1);
    assert_eq!(written.left_out, ["logo.png"]);
    assert!(!written.shortened);

    let asked = asked.join().unwrap();
    assert_eq!(asked[0].line, "GET /v1/models HTTP/1.1");
    assert_eq!(asked[1].line, "POST /v1/chat/completions HTTP/1.1");
    let body = &asked[1].body;
    assert_eq!(body["model"], "tiny-model");
    assert_eq!(body["messages"][0]["role"], "system");
    let sent = body["messages"][1]["content"].as_str().unwrap();
    assert!(sent.contains("Branch: main"), "{sent}");
    assert!(
        sent.contains("- Write some notes\n- Add the greeting"),
        "{sent}"
    );
    assert!(sent.contains("started writing:\ngreet"), "{sent}");
    assert!(sent.contains("+Hello there"), "{sent}");
    assert!(sent.contains("- logo.png"), "{sent}");
    // Only what's staged goes.
    assert!(!sent.contains("SECRET"), "{sent}");
}

#[test]
fn a_chosen_model_is_used_without_asking_for_the_list() {
    let repo = repository("ai-chosen");
    let (address, asked) = server(vec![(
        200,
        r#"{"choices":[{"message":{"content":"feat: greet people warmly\n\nMore words."}}]}"#,
    )]);
    let setup = AiSetup {
        model: "chosen-model".into(),
        ..local(&address)
    };
    let written = tauri::async_runtime::block_on(write_commit_message(
        repo.path(),
        &setup,
        MessageStyle::Summary,
        "",
    ))
    .unwrap();
    // One line, as asked.
    assert_eq!(written.summary, "feat: greet people warmly");
    assert_eq!(written.description, "");
    let asked = asked.join().unwrap();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].body["model"], "chosen-model");
    // Summary only: no need for the repository's style.
    let sent = asked[0].body["messages"][1]["content"].as_str().unwrap();
    assert!(!sent.contains("recent commit summaries"), "{sent}");
}

#[test]
fn says_what_to_fix_when_the_model_refuses() {
    let repo = repository("ai-refused");
    let (address, asked) = server(vec![(
        401,
        r#"{"error":{"message":"Invalid API key","type":"invalid_request_error"}}"#,
    )]);
    let setup = AiSetup {
        model: "chosen-model".into(),
        ..local(&address)
    };
    let error = tauri::async_runtime::block_on(write_commit_message(
        repo.path(),
        &setup,
        MessageStyle::Repository,
        "",
    ))
    .unwrap_err();
    asked.join().unwrap();
    assert!(matches!(error.kind(), Some(ErrorKind::AiSetup)), "{error}");
    assert!(
        error.to_string().contains("didn't accept the key"),
        "{error}"
    );
    assert!(error.to_string().contains("Invalid API key"), "{error}");
}

#[test]
fn says_when_nothing_answers() {
    let repo = repository("ai-unanswered");
    // A port nothing listens on: bound, then let go.
    let address = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}/v1", listener.local_addr().unwrap())
    };
    let error = tauri::async_runtime::block_on(write_commit_message(
        repo.path(),
        &local(&address),
        MessageStyle::Repository,
        "",
    ))
    .unwrap_err();
    assert!(matches!(error.kind(), Some(ErrorKind::AiSetup)), "{error}");
    assert!(
        error.to_string().starts_with("Nothing answered at"),
        "{error}"
    );
}

#[test]
fn needs_something_staged() {
    let mut repo = TempRepo::new("ai-nothing");
    repo.commit("a.txt", "First");
    let error = tauri::async_runtime::block_on(write_commit_message(
        repo.path(),
        &local("http://127.0.0.1:9/v1"),
        MessageStyle::Repository,
        "",
    ))
    .unwrap_err();
    assert!(matches!(error, Error::Message(_)), "{error}");
    assert!(
        error.to_string().starts_with("Stage the changes"),
        "{error}"
    );
}
