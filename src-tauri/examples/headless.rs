//! Tributary's commands without a window, for the browser preview (`tools/preview`) and
//! for scripts. It reads one request per line on stdin:
//!
//! ```json
//! {"id": 1, "command": "open_repository", "args": {"path": "/some/repo"}}
//! ```
//!
//! and writes one line of JSON per reply, `{"id": 1, "ok": …}` or
//! `{"id": 1, "err": {"message": "…", "kind": …}}`, and per event,
//! `{"event": "activity", "payload": …}`. The commands and their arguments are the app's
//! own, from its command list (`src/commands/list.rs`): the preview runs the same
//! functions, except for the few in [`own`]. Each request runs on its own thread, so a slow
//! fetch doesn't hold up the rest.
//!
//! ```sh
//! cargo run --example headless
//! ```

use std::io::{BufRead, Write};
use std::path::PathBuf;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tributary_lib::actions::{self, Action};
use tributary_lib::error::{Error, Result};
use tributary_lib::{commands, git};

#[derive(Deserialize)]
struct Request {
    id: Value,
    command: String,
    #[serde(default)]
    args: Value,
}

fn main() {
    git::on_activity(|entry| send(&json!({ "event": "activity", "payload": entry })));
    std::thread::scope(|scope| {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if !line.trim().is_empty() {
                scope.spawn(move || respond(&line));
            }
        }
    });
}

/// Write one line of JSON to stdout. Lines from different threads never mix.
fn send(message: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{message}");
    let _ = out.flush();
}

fn respond(line: &str) {
    let reply = match serde_json::from_str::<Request>(line) {
        Ok(request) => match handle(&request.command, &request.args) {
            Ok(value) => json!({ "id": request.id, "ok": value }),
            // As the app's commands give it: its message, and its kind when that's known.
            Err(error) => json!({ "id": request.id, "err": error }),
        },
        Err(error) => json!({ "id": null, "err": format!("That isn't a request: {error}") }),
    };
    send(&reply);
}

/// An argument the command needs (by its name as the frontend sends it).
fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T> {
    let value = args.get(name).cloned().unwrap_or(Value::Null);
    serde_json::from_value(value).map_err(|e| Error::Message(format!("Bad argument {name}: {e}")))
}

/// An argument the command can do without.
fn optional<T: DeserializeOwned>(args: &Value, name: &str) -> Result<Option<T>> {
    match args.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => arg(args, name).map(Some),
    }
}

fn to_json<T: serde::Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value).map_err(|e| Error::Message(e.to_string()))
}

/// Report fetch, pull, push and clone progress the way the app does: with the repository
/// it's about (none for a clone).
fn progress(progress: git::Progress) {
    send(&json!({ "event": "action-progress", "payload": progress }));
}

fn progress_in(path: &std::path::Path, progress: git::Progress) {
    let mut payload = serde_json::to_value(progress).unwrap_or_default();
    payload["path"] = json!(path.display().to_string());
    send(&json!({ "event": "action-progress", "payload": payload }));
}

/// A request's answer: the preview's own version of the command, if it has one, or the
/// app's own command.
fn handle(command: &str, args: &Value) -> Result<Value> {
    if let Some(answer) = own(command, args) {
        return answer;
    }
    tauri::async_runtime::block_on(commands::dispatch(command, args)).unwrap_or_else(|| {
        Err(Error::Message(format!(
            "The headless app has no command {command}."
        )))
    })
}

/// The preview's own versions of the commands that need the app itself (its window, its
/// events, the files it's installed with), or that it does differently. The rest of the
/// commands that need the app, the preview's page fakes (`tools/preview/shim.js`); a test
/// checks that each is one or the other (`commands::list`).
fn own(command: &str, args: &Value) -> Option<Result<Value>> {
    Some(match command {
        // Progress goes out as the preview's events, about the repository it's in.
        "run_action" => run_action(args),
        "clone_repository" => clone_repository(args),
        // The preview has no window to tell about changes: refreshing on focus does.
        "watch_repository" | "stop_watching" => Ok(Value::Null),
        // The browser preview has no app icon to change.
        "set_app_icon" => Ok(Value::Null),
        // The licences, from the repository rather than the app's resources.
        "third_party_notices" => third_party_notices(),
        // The preview has no problems log: interface errors go to the server's output.
        "report_problem" => arg::<String>(args, "what").map(|what| {
            eprintln!("Interface problem: {what}");
            Value::Null
        }),
        "take_recovery_note" => Ok(Value::Null),
        _ => return None,
    })
}

fn run_action(args: &Value) -> Result<Value> {
    let action: Action = arg(args, "action")?;
    let path: PathBuf = arg(args, "path")?;
    to_json(actions::run_with_progress(&path, action, &|value| {
        progress_in(&path, value)
    })?)
}

fn clone_repository(args: &Value) -> Result<Value> {
    let url: String = arg(args, "url")?;
    let parent: PathBuf = arg(args, "parent")?;
    let name: String = arg(args, "name")?;
    let options = optional(args, "options")?.unwrap_or_default();
    let folder = actions::clone_repository(&url, &parent, &name, &options, &progress)?;
    to_json(folder.display().to_string())
}

fn third_party_notices() -> Result<Value> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let notices = std::fs::read_to_string(root.join("THIRD_PARTY_NOTICES.txt"))
        .map_err(|e| Error::Message(e.to_string()))?;
    let license = std::fs::read_to_string(root.join("LICENSE")).ok();
    Ok(json!({ "notices": notices, "license": license }))
}
