//! Tributary's commands without a window, for the browser preview (`tools/preview`) and
//! for scripts. It reads one request per line on stdin:
//!
//! ```json
//! {"id": 1, "command": "open_repository", "args": {"path": "/some/repo"}}
//! ```
//!
//! and writes one line of JSON per reply, `{"id": 1, "ok": …}` or `{"id": 1, "err": "…"}`,
//! and per event, `{"event": "activity", "payload": …}`. The commands and their arguments
//! are the ones the frontend sends to the app (see `src/commands.rs`). Each request runs
//! on its own thread, so a slow fetch doesn't hold up the rest.
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
use tributary_lib::{diagnostics, git, github, locks, repo};

/// How many commits to load when a request doesn't say.
const DEFAULT_LIMIT: usize = 10_000;

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
            Err(error) => json!({ "id": request.id, "err": error.to_string() }),
        },
        Err(error) => json!({ "id": null, "err": format!("That isn't a request: {error}") }),
    };
    send(&reply);
}

/// An argument the command needs.
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

/// Report fetch, pull, push and clone progress the way the app does.
fn progress(progress: git::Progress) {
    send(&json!({ "event": "action-progress", "payload": progress }));
}

fn handle(command: &str, args: &Value) -> Result<Value> {
    let path = || arg::<PathBuf>(args, "path");
    match command {
        "open_repository" => {
            let options = repo::LoadOptions {
                limit: optional(args, "limit")?.unwrap_or(DEFAULT_LIMIT),
                include_status: optional(args, "includeStatus")?.unwrap_or(true),
                first_parent: optional(args, "firstParent")?.unwrap_or(false),
                hidden: optional(args, "hidden")?.unwrap_or_default(),
                solo: optional(args, "solo")?.unwrap_or_default(),
            };
            to_json(repo::load_with(&path()?, options)?)
        }
        "commit_details" => to_json(repo::details(&path()?, &arg::<String>(args, "id")?)?),
        "compare_commits" => to_json(repo::compare(
            &path()?,
            &arg::<String>(args, "from")?,
            &arg::<String>(args, "to")?,
            arg(args, "split")?,
        )?),
        "actor_names" => {
            let at: Option<String> = optional(args, "at")?;
            let fallback: Option<String> = optional(args, "fallback")?;
            let files: Vec<String> = arg(args, "files")?;
            to_json(tributary_lib::unreal::actor_names(
                &path()?,
                at.as_deref(),
                fallback.as_deref(),
                &files,
            )?)
        }
        "run_action" => {
            let action: Action = arg(args, "action")?;
            to_json(actions::run_with_progress(&path()?, action, &progress)?)
        }
        "clone_repository" => {
            let url: String = arg(args, "url")?;
            let parent: PathBuf = arg(args, "parent")?;
            let name: String = arg(args, "name")?;
            let options = optional(args, "options")?.unwrap_or_default();
            let folder = actions::clone_repository(&url, &parent, &name, &options, &progress)?;
            to_json(folder.display().to_string())
        }
        "init_repository" => to_json(actions::init_repository(&path()?)?),
        "prune_candidates" => to_json(actions::prune_candidates(&path()?)?),
        "branch_backups" => to_json(actions::backups(&path()?)?),
        "lost_commits" => {
            let reference: String = arg(args, "reference")?;
            to_json(actions::lost_commits(&path()?, &reference)?)
        }
        "lfs_locks" => to_json(locks::locks(&path()?)?),
        "file_history" => {
            let file: String = arg(args, "file")?;
            to_json(actions::file_history(&path()?, &file)?)
        }
        "file_checks" => {
            let files: Vec<String> = arg(args, "files")?;
            let threshold: u64 = arg(args, "threshold")?;
            to_json(actions::file_checks(&path()?, &files, threshold)?)
        }
        "lfs_storage" => to_json(actions::lfs_storage_of(&path()?)?),
        "file_diff" => {
            let source: actions::DiffSource = arg(args, "source")?;
            let file: String = arg(args, "file")?;
            let old_path: Option<String> = optional(args, "oldPath")?;
            let ignore_whitespace = optional(args, "ignoreWhitespace")?.unwrap_or(false);
            to_json(actions::file_diff(
                &path()?,
                source,
                &file,
                old_path.as_deref(),
                ignore_whitespace,
            )?)
        }
        // The preview has no window to tell about changes: refreshing on focus does.
        "watch_repository" | "stop_watching" => to_json(()),
        "team_activity" => to_json(actions::team_activity(&path()?, arg(args, "days")?)?),
        "search_commits" => {
            let mode: actions::SearchMode = arg(args, "mode")?;
            let query: String = arg(args, "query")?;
            to_json(actions::search_commits(&path()?, mode, &query)?)
        }
        "blame_file" => {
            let file: String = arg(args, "file")?;
            let at: Option<String> = optional(args, "at")?;
            to_json(actions::blame(&path()?, &file, at.as_deref())?)
        }
        "conflict_text" => {
            let file: String = arg(args, "file")?;
            to_json(actions::conflict_text(&path()?, &file)?)
        }
        "changed_elsewhere" => {
            let changed: Vec<String> = arg(args, "changed")?;
            to_json(actions::changed_elsewhere(&path()?, &changed)?)
        }
        "lfs_health" => to_json(actions::lfs_health(&path()?)?),
        "submodules" => to_json(actions::submodules(&path()?)?),
        "repo_identity" => to_json(actions::repo_identity(&path()?)?),
        "signing_settings" => to_json(actions::signing_settings(&path()?)?),
        "unity_setup" => to_json(actions::unity_setup(&path()?)?),
        "sparse_settings" => to_json(actions::sparse_settings(&path()?)?),
        "speed_settings" => to_json(actions::speed_settings(&path()?)?),
        "patch_info" => to_json(actions::patch_info(
            &path()?,
            &arg::<PathBuf>(args, "file")?,
        )?),
        "patch_text" => to_json(actions::patch_text(
            &path()?,
            &arg::<Vec<String>>(args, "ids")?,
        )?),
        "remotes" => to_json(actions::remotes(&path()?)?),
        // The browser preview has no app icon to change.
        "set_app_icon" => Ok(Value::Null),
        "repo_summary" => to_json(repo::summary(&path()?)),
        "lfs_settings" => to_json(actions::lfs_settings(&path()?)?),
        "diff_tool_settings" => {
            let folder: Option<String> = optional(args, "path")?;
            let list: bool = arg(args, "list")?;
            to_json(actions::diff_tool_settings(
                folder.as_deref().map(std::path::Path::new),
                list,
            )?)
        }
        "set_diff_tool" => {
            let folder: Option<String> = optional(args, "path")?;
            to_json(actions::set_diff_tool(
                folder.as_deref().map(std::path::Path::new),
                arg(args, "merge")?,
                optional(args, "tool")?,
                optional(args, "command")?,
                actions::Scope::Global,
            )?)
        }
        "pull_requests" => {
            let path = path()?;
            to_json(tauri::async_runtime::block_on(github::open_requests(
                &path,
            ))?)
        }
        "new_request_info" => to_json(tauri::async_runtime::block_on(
            tributary_lib::requests::new_request_info(
                &path()?,
                arg(args, "branch")?,
                optional(args, "local")?,
            ),
        )?),
        "create_pull_request" => to_json(tauri::async_runtime::block_on(
            tributary_lib::requests::create_request(&path()?, arg(args, "request")?),
        )?),
        "pull_request_details" => to_json(tauri::async_runtime::block_on(
            tributary_lib::requests::request_details(&path()?, arg(args, "number")?),
        )?),
        "request_conversation" => to_json(tauri::async_runtime::block_on(
            tributary_lib::reviews::conversation(&path()?, arg(args, "number")?),
        )?),
        "comment_on_request" => to_json(tauri::async_runtime::block_on(
            tributary_lib::reviews::comment(
                &path()?,
                arg(args, "number")?,
                arg(args, "body")?,
                optional(args, "thread")?,
            ),
        )?),
        "review_request" => to_json(tauri::async_runtime::block_on(
            tributary_lib::reviews::review(
                &path()?,
                arg(args, "number")?,
                arg(args, "verdict")?,
                arg(args, "body")?,
            ),
        )?),
        "issues" => to_json(tauri::async_runtime::block_on(
            tributary_lib::issues::issues(
                &path()?,
                &arg(args, "tracker")?,
                &arg::<Vec<String>>(args, "keys")?,
            ),
        )?),
        "my_issues" => to_json(tauri::async_runtime::block_on(
            tributary_lib::issues::my_issues(&path()?, &arg(args, "tracker")?),
        )?),
        "tracker_status" => to_json(tauri::async_runtime::block_on(
            tributary_lib::issues::tracker_status(&path()?, &arg(args, "tracker")?),
        )?),
        "tracker_sign_in" => to_json(tauri::async_runtime::block_on(
            tributary_lib::issues::tracker_sign_in(
                &arg(args, "tracker")?,
                &arg::<String>(args, "user")?,
                &arg::<String>(args, "token")?,
            ),
        )?),
        "tracker_sign_out" => to_json(tributary_lib::issues::tracker_sign_out(&arg(
            args, "tracker",
        )?)?),
        "merge_request" => to_json(tauri::async_runtime::block_on(
            tributary_lib::reviews::merge(&path()?, arg(args, "number")?, arg(args, "options")?),
        )?),
        "avatars" => {
            let emails: Vec<String> = arg(args, "emails")?;
            to_json(tauri::async_runtime::block_on(
                tributary_lib::avatars::avatars(&path()?, emails),
            )?)
        }
        "github_status" => to_json(tauri::async_runtime::block_on(github::account::status())?),
        "github_sign_in" => {
            let token: String = arg(args, "token")?;
            to_json(tauri::async_runtime::block_on(
                github::account::sign_in_with_token(&token),
            )?)
        }
        "github_sign_out" => to_json(github::account::sign_out()?),
        "reflog" => {
            let limit = optional(args, "limit")?.unwrap_or(300);
            to_json(repo::reflog(&path()?, limit)?)
        }
        "remote_state" => to_json(repo::remote_state(&path()?)?),
        "worktrees" => to_json(repo::worktrees(&path()?)?),
        "commits_between" => {
            let from: String = arg(args, "from")?;
            let to: String = arg(args, "to")?;
            to_json(repo::commits_between(&path()?, &from, &to)?)
        }
        "diagnostics" => {
            let path: Option<PathBuf> = optional(args, "path")?;
            to_json(diagnostics::diagnostics(path.as_deref()))
        }
        "cancel_action" => to_json(git::cancel()),
        "activity_log" => to_json(git::activity()),
        other => Err(Error::Message(format!(
            "The headless app has no command {other}."
        ))),
    }
}
