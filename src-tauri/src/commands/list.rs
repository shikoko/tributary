//! Every command the frontend can call, once. The app's handler list, the preview's
//! dispatch (`examples/headless.rs`) and the TypeScript types of each command's arguments
//! and result (`Commands` in `src/api/generated.ts`) are all made from this list, so they
//! can't drift apart: a command added here is in all three, and one that isn't here is in
//! none.
//!
//! Each entry repeats its command's signature, without what Tauri passes in itself (the
//! app, its state). The compiler checks the types against the function, which the preview's
//! dispatch calls with them; a test checks the names (`the_names_are_the_commands_own`).

#[cfg(test)]
use std::any::TypeId;

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
#[cfg(test)]
use ts_rs::{Config, TS, TypeVisitor};

use super::*;

/// A command's arguments and result, in TypeScript, for `Commands` in `src/api/generated.ts`.
#[cfg(test)]
pub(crate) struct Signature {
    pub name: &'static str,
    /// Each argument: its name in Rust and its TypeScript type.
    pub args: Vec<(&'static str, String)>,
    pub returns: String,
}

/// The TypeScript type of `T`: what a command returning nothing gives back is `void`.
#[cfg(test)]
fn ts<T: TS + 'static + ?Sized>(config: &Config) -> String {
    if TypeId::of::<T>() == TypeId::of::<()>() {
        "void".into()
    } else {
        T::name(config)
    }
}

/// An argument's name as the frontend sends it: Tauri's camelCase ("include_status" →
/// "includeStatus").
pub fn camel(name: &str) -> String {
    let mut words = name.split('_');
    let mut out = words.next().unwrap_or_default().to_owned();
    for word in words {
        let mut chars = word.chars();
        if let Some(first) = chars.next() {
            out.extend(first.to_uppercase());
            out.push_str(chars.as_str());
        }
    }
    out
}

/// Argument `name` of a request, as Tauri reads it: missing is null, which an `Option` takes
/// as None.
fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T> {
    let key = camel(name);
    let value = args.get(&key).cloned().unwrap_or(Value::Null);
    serde_json::from_value(value).map_err(|e| Error::Message(format!("Bad argument {key}: {e}")))
}

fn reply<T: Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value).map_err(|e| Error::Message(e.to_string()))
}

macro_rules! commands {
    (
        async { $( $async_name:ident ( $( $async_arg:ident : $async_ty:ty ),* ) -> $async_ok:ty ; )* }
        sync { $( $sync_name:ident ( $( $sync_arg:ident : $sync_ty:ty ),* ) -> $sync_ok:ty ; )* }
        app { $( $app_name:ident ( $( $app_arg:ident : $app_ty:ty ),* ) -> $app_ok:ty ; )* }
    ) => {
        /// The app's handler: every command.
        pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
            tauri::generate_handler![
                $( super::$async_name, )*
                $( super::$sync_name, )*
                $( super::$app_name, )*
            ]
        }

        /// Run `command` with `args` (as the frontend sends them: an object, its keys in
        /// camelCase), for the preview: None for one that needs the app itself
        /// ([`APP_ONLY`]), or isn't a command.
        pub async fn dispatch(command: &str, args: &Value) -> Option<Result<Value>> {
            Some(match command {
                $( stringify!($async_name) => async {
                    $( let $async_arg: $async_ty = arg(args, stringify!($async_arg))?; )*
                    reply(super::$async_name($( $async_arg ),*).await?)
                }.await, )*
                $( stringify!($sync_name) => async {
                    $( let $sync_arg: $sync_ty = arg(args, stringify!($sync_arg))?; )*
                    reply(super::$sync_name($( $sync_arg ),*))
                }.await, )*
                _ => return None,
            })
        }

        /// The commands that need the app itself (its window, its events, the files it's
        /// installed with): the preview has its own versions of them, or fakes them.
        pub const APP_ONLY: &[&str] = &[ $( stringify!($app_name) ),* ];

        /// Every command's arguments and result, in TypeScript.
        #[cfg(test)]
        pub(crate) fn signatures(config: &Config) -> Vec<Signature> {
            vec![
                $( Signature {
                    name: stringify!($async_name),
                    args: vec![ $( (stringify!($async_arg), ts::<$async_ty>(config)) ),* ],
                    returns: ts::<$async_ok>(config),
                }, )*
                $( Signature {
                    name: stringify!($sync_name),
                    args: vec![ $( (stringify!($sync_arg), ts::<$sync_ty>(config)) ),* ],
                    returns: ts::<$sync_ok>(config),
                }, )*
                $( Signature {
                    name: stringify!($app_name),
                    args: vec![ $( (stringify!($app_arg), ts::<$app_ty>(config)) ),* ],
                    returns: ts::<$app_ok>(config),
                }, )*
            ]
        }

        /// Every type the commands take or give back, for its TypeScript declaration.
        #[cfg(test)]
        pub(crate) fn visit_types(visitor: &mut impl TypeVisitor) {
            $( $( visitor.visit::<$async_ty>(); )* visitor.visit::<$async_ok>(); )*
            $( $( visitor.visit::<$sync_ty>(); )* visitor.visit::<$sync_ok>(); )*
            $( $( visitor.visit::<$app_ty>(); )* visitor.visit::<$app_ok>(); )*
        }
    };
}

commands! {
    // Run on a blocking thread, and can fail.
    async {
        open_repository(path: String, limit: Option<usize>, include_status: Option<bool>, first_parent: Option<bool>, hidden: Option<Vec<String>>, solo: Option<Vec<String>>) -> repo::RepoSnapshot;
        commit_details(path: String, id: String) -> repo::CommitDetails;
        compare_commits(path: String, from: String, to: String, split: bool) -> repo::Comparison;
        actor_names(path: String, at: Option<String>, fallback: Option<String>, files: Vec<String>) -> std::collections::HashMap<String, crate::unreal::ActorName>;
        init_repository(path: String) -> String;
        prune_candidates(path: String, idle_days: Option<u32>) -> actions::PruneInfo;
        branch_backups(path: String) -> Vec<actions::Backup>;
        lost_commits(path: String, reference: String) -> actions::LostCommits;
        upstream_choices(path: String, branch: String) -> actions::UpstreamChoices;
        unseen_commits(path: String, reference: String, since: Option<String>) -> actions::UnseenCommits;
        lfs_locks(path: String) -> locks::Locks;
        file_history(path: String, file: String) -> actions::FileHistory;
        file_checks(path: String, files: Vec<String>, deleted: Option<Vec<String>>, threshold: u64) -> actions::FileChecks;
        lfs_health(path: String) -> Option<actions::LfsHealth>;
        changed_elsewhere(path: String, changed: Vec<String>) -> Vec<actions::Overlap>;
        diff_tool_settings(path: Option<String>, list: bool) -> actions::DiffToolSettings;
        set_diff_tool(path: Option<String>, merge: bool, tool: Option<String>, command: Option<String>) -> String;
        lfs_settings(path: String) -> actions::LfsSettings;
        repo_identity(path: String) -> actions::RepoIdentity;
        take_snapshot(path: String, max_bytes: u64, keep_days: u32) -> Option<actions::Snapshot>;
        local_history(path: String) -> Vec<actions::Snapshot>;
        shelves(path: String, fetch: bool) -> Vec<actions::Shelf>;
        project_setup(path: String) -> actions::ProjectSetup;
        commit_template(path: String) -> actions::CommitTemplate;
        repo_summary(path: String) -> repo::RepoSummary;
        remotes(path: String) -> Vec<actions::RemoteInfo>;
        patch_info(path: String, file: String) -> actions::PatchInfo;
        merge_check(path: String, from: String, into: Option<String>) -> actions::MergeCheck;
        save_settings_file(file: String, text: String) -> ();
        read_settings_file(file: String) -> String;
        export_settings_to_repository(url: String, contents: String) -> String;
        import_settings_from_repository(url: String) -> String;
        change_request(path: String, number: u64, change: crate::requests::RequestChange) -> String;
        commit_states(path: String, ids: Vec<String>) -> std::collections::HashMap<String, crate::github::CheckState>;
        commit_checks(path: String, id: String) -> crate::ci::CommitChecks;
        commit_runs(path: String, id: String) -> crate::ci::CommitRuns;
        rerun_failed_checks(path: String, id: String) -> String;
        check_log(path: String, url: String) -> crate::ci_log::CheckLog;
        rerun_job(path: String, url: String) -> String;
        installed_apps() -> Vec<crate::apps::App>;
        open_in_app(app: String, path: String, file: Option<String>) -> ();
        ignore_reason(path: String, file: String) -> actions::IgnoreReason;
        repo_size(path: String) -> actions::RepoSize;
        release_notes(path: String, to: String, from: Option<String>) -> actions::ReleaseNotes;
        publish_release(path: String, tag: String, title: String, notes: String) -> String;
        since_then(path: String, seen: Vec<crate::since::SeenTip>, paths: Vec<String>) -> Vec<crate::since::SinceThen>;
        branch_stacks(path: String) -> Vec<actions::Stacked>;
        branch_versions(path: String, name: String) -> Vec<actions::BranchVersion>;
        range_diff(path: String, old: String, new: String, base: Option<String>, branch: Option<String>) -> actions::RangeDiff;
        code_owners(path: String, files: Vec<String>) -> Vec<crate::codeowners::FileOwners>;
        patch_text(path: String, ids: Vec<String>) -> String;
        speed_settings(path: String) -> actions::SpeedSettings;
        sparse_settings(path: String) -> actions::SparseSettings;
        unity_setup(path: String) -> actions::UnitySetup;
        signing_settings(path: String) -> actions::SigningSettings;
        ssh_keys() -> Vec<actions::SshKey>;
        generate_ssh_key(name: String, comment: String, passphrase: String) -> actions::SshKey;
        check_ssh_key(host: String, public_key: String) -> actions::SshCheck;
        submodules(path: String) -> Vec<actions::Submodule>;
        file_diff(path: String, source: actions::DiffSource, file: String, old_path: Option<String>, ignore_whitespace: Option<bool>) -> actions::FileDiff;
        search_commits(path: String, mode: actions::SearchMode, query: String) -> actions::SearchResult;
        search_overview(path: String, query: String) -> actions::SearchOverview;
        find_commit(path: String, query: String) -> Option<String>;
        team_work(path: String, days: u32) -> actions::TeamWork;
        team_pulse(path: String, days: u32) -> actions::TeamPulse;
        recent_requests(path: String) -> Vec<crate::requests::RecentRequest>;
        team_activity(path: String, days: u32) -> actions::TeamActivity;
        blame_file(path: String, file: String, at: Option<String>) -> actions::Blame;
        conflict_text(path: String, file: String) -> actions::ConflictText;
        lfs_storage(path: String) -> Option<actions::LfsStorage>;
        avatars(path: String, emails: Vec<String>) -> std::collections::HashMap<String, Option<String>>;
        pull_requests(path: String) -> Vec<github::PullRequest>;
        new_request_info(path: String, branch: String, local: Option<String>) -> crate::requests::NewRequestInfo;
        create_pull_request(path: String, request: crate::requests::NewRequest) -> github::PullRequest;
        pull_request_details(path: String, number: u64) -> crate::requests::RequestDetails;
        request_conversation(path: String, number: u64) -> crate::reviews::Conversation;
        comment_on_request(path: String, number: u64, body: String, thread: Option<String>) -> String;
        review_request(path: String, number: u64, verdict: crate::reviews::ReviewVerdict, body: String) -> String;
        issues(path: String, tracker: crate::issues::Tracker, keys: Vec<String>) -> Vec<crate::issues::Issue>;
        my_issues(path: String, tracker: crate::issues::Tracker) -> Vec<crate::issues::Issue>;
        tracker_status(path: String, tracker: crate::issues::Tracker) -> crate::issues::TrackerStatus;
        tracker_sign_in(tracker: crate::issues::Tracker, user: String, token: String) -> crate::issues::TrackerStatus;
        tracker_sign_out(tracker: crate::issues::Tracker) -> ();
        merge_request(path: String, number: u64, options: crate::reviews::MergeRequestOptions) -> String;
        git_install() -> git::install::GitInstall;
        look_for_git() -> git::install::GitInstall;
        install_command_line_tools() -> ();
        github_status() -> github::account::GitHubStatus;
        github_sign_in(token: String) -> github::account::Account;
        github_sign_in_with_browser() -> github::account::Account;
        github_sign_out() -> ();
        github_repositories() -> Vec<accounts::AccountRepo>;
        github_forks() -> github::forks::Forks;
        github_fork_status(fork: github::forks::Fork) -> github::forks::ForkStatus;
        github_sync_fork(fork: github::forks::Fork) -> github::forks::ForkSync;
        gitlab_status(host: String) -> accounts::GitLabStatus;
        gitlab_sign_in(host: String, token: String) -> accounts::GitLabAccount;
        gitlab_sign_in_with_browser(host: String) -> accounts::GitLabAccount;
        gitlab_sign_out(host: String) -> ();
        gitlab_repositories(host: String) -> Vec<accounts::AccountRepo>;
        worktrees(path: String) -> Vec<repo::Worktree>;
        reflog(path: String, limit: Option<usize>) -> Vec<repo::ReflogEntry>;
        remote_state(path: String) -> repo::RemoteState;
        commits_between(path: String, from: String, to: String) -> repo::NewCommits;
        diagnostics(path: Option<String>) -> diagnostics::Diagnostics;
    }
    // Quick, and can't fail.
    sync {
        forget_avatars() -> ();
        forget_missing_avatars() -> ();
        stop_update_restart() -> ();
        report_problem(what: String) -> Option<String>;
        take_recovery_note() -> Option<String>;
        action_info(action: Action) -> actions::ActionInfo;
        cancel_action(path: Option<String>) -> bool;
        activity_log() -> Vec<git::LogEntry>;
    }
    // Need the app itself: its window, its events, or the files it's installed with.
    app {
        watch_repository(path: String) -> ();
        stop_watching() -> ();
        run_action(path: String, action: Action) -> Outcome;
        clone_repository(url: String, parent: String, name: String, options: Option<actions::CloneOptions>) -> String;
        set_app_icon(dark: bool) -> ();
        check_for_update(beta: Option<bool>) -> Option<updates::UpdateInfo>;
        download_update() -> ();
        restart_to_update() -> bool;
        third_party_notices() -> Notices;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each entry's argument names are its function's, in the same order (the compiler
    /// checks their types, not their names).
    #[test]
    fn the_names_are_the_commands_own() {
        let source = include_str!("mod.rs");
        let config = Config::new();
        for signature in signatures(&config) {
            let start = ["(", "<"]
                .iter()
                .find_map(|next| source.find(&format!("fn {}{next}", signature.name)))
                .unwrap_or_else(|| panic!("there's no command {}", signature.name));
            let params = &source[start..];
            let params = &params[params.find('(').unwrap() + 1..params.find(')').unwrap()];
            let names: Vec<&str> = parameters(params)
                .into_iter()
                .filter_map(|param| param.split_once(':'))
                .filter(|(_, ty)| !ty.contains("AppHandle") && !ty.contains("State<"))
                .map(|(name, _)| name.trim())
                .collect();
            let listed: Vec<&str> = signature.args.iter().map(|(name, _)| *name).collect();
            assert_eq!(listed, names, "{}'s arguments", signature.name);
        }
    }

    /// A function's parameters, split at the commas outside `<…>`.
    fn parameters(list: &str) -> Vec<&str> {
        let (mut depth, mut start, mut found) = (0, 0, Vec::new());
        for (at, c) in list.char_indices() {
            match c {
                '<' => depth += 1,
                '>' => depth -= 1,
                ',' if depth == 0 => {
                    found.push(&list[start..at]);
                    start = at + 1;
                }
                _ => {}
            }
        }
        found.push(&list[start..]);
        found
            .into_iter()
            .filter(|param| !param.trim().is_empty())
            .collect()
    }

    #[test]
    fn lists_every_command_once() {
        let source = include_str!("mod.rs");
        let commands = source.matches("#[tauri::command]").count();
        let mut names: Vec<&str> = signatures(&Config::new()).iter().map(|s| s.name).collect();
        assert_eq!(names.len(), commands, "a command is missing from the list");
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), commands, "a command is listed twice");
    }

    /// The commands the preview's backend has its own versions of: its `own` match arms.
    fn preview_own() -> Vec<&'static str> {
        let source = include_str!("../../examples/headless.rs");
        let start = source
            .find("fn own(")
            .expect("headless.rs has its own commands");
        source[start..]
            .lines()
            .take_while(|line| *line != "}")
            .map(str::trim)
            .filter(|line| line.starts_with('"') && line.contains("=>"))
            .flat_map(|line| line[..line.find("=>").unwrap()].split('|'))
            .map(|name| name.trim().trim_matches('"'))
            .collect()
    }

    /// The commands the preview's page fakes: the keys of `local` in shim.js (not the
    /// plugins').
    fn preview_fakes() -> Vec<&'static str> {
        let source = include_str!("../../../tools/preview/shim.js");
        let start = source
            .find("const local = {")
            .expect("shim.js fakes commands");
        source[start..]
            .lines()
            .skip(1)
            .take_while(|line| *line != "  };")
            .filter_map(|line| line.strip_prefix("    "))
            .filter_map(|line| line.split_once(':').map(|(key, _)| key))
            .filter(|key| key.chars().all(|c| c.is_ascii_lowercase() || c == '_'))
            .collect()
    }

    #[test]
    fn the_preview_has_every_command() {
        let names: Vec<&str> = signatures(&Config::new()).iter().map(|s| s.name).collect();
        let own = preview_own();
        let fakes = preview_fakes();
        for name in own.iter().chain(&fakes) {
            assert!(
                names.contains(name),
                "the preview has {name}, which isn't a command"
            );
        }
        // The rest are the app's own commands, which the preview runs as they are.
        for name in APP_ONLY {
            assert!(
                own.contains(name) || fakes.contains(name),
                "{name} needs the app: the preview needs its own version of it \
                 (examples/headless.rs), or a fake (tools/preview/shim.js)"
            );
        }
    }

    #[test]
    fn names_arguments_as_the_frontend_does() {
        assert_eq!(camel("include_status"), "includeStatus");
        assert_eq!(camel("path"), "path");
        assert_eq!(camel("old_path"), "oldPath");
    }
}
