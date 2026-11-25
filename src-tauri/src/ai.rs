//! Commit messages written by an AI, with the person's own key: Claude (Anthropic), OpenAI,
//! Google Gemini, or a model on their own computer (Ollama, LM Studio, or another server
//! that answers like OpenAI's).
//!
//! Nothing is sent until they ask for a message. Then only this goes, straight from their
//! computer to the provider: the staged changes (each file's cut short when it's long, and
//! the whole kept under a limit), the names of staged files that aren't text or are in Git
//! LFS (never what's in them), the branch's name, the last commits' summaries when the
//! message is to read like them, and what they'd typed in the summary already. The key is
//! kept by git's credential helper, like the other sign-ins: Tributary doesn't keep it.
//!
//! The models are the provider's own list, asked for each time: none are written in here.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use crate::error::{Error, ErrorKind, Result};
use crate::git::{Credential, Git};

/// Who writes the messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AiProvider {
    Anthropic,
    Openai,
    Gemini,
    /// A server on this computer (or the local network) that answers like OpenAI's.
    Local,
}

/// Which AI writes the messages, as chosen in Settings.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiSetup {
    pub provider: AiProvider,
    /// The model's id as the provider lists it; empty for the one Tributary picks
    /// ([`AiModels::picked`]).
    #[serde(default)]
    pub model: String,
    /// For a model on this computer: its server's address, like `http://localhost:11434/v1`
    /// (empty for that one, Ollama's).
    #[serde(default)]
    pub address: String,
}

/// One of the provider's models.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    pub id: String,
    /// Its name, like "Claude Haiku 4.5"; the id when the provider gives none.
    pub name: String,
}

/// The provider's models, and the one used when none is chosen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiModels {
    pub models: Vec<AiModel>,
    /// The newest of the provider's quick, cheap ones (enough for a commit message), or its
    /// newest.
    pub picked: Option<String>,
}

/// Whether a key is kept for the provider.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiKey {
    pub kept: bool,
    /// Its last four characters, to tell which key it is.
    pub ends: Option<String>,
}

/// How a message is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum MessageStyle {
    /// Like the repository's last commits.
    Repository,
    /// Conventional Commits: "feat: …", "fix(scope): …".
    Conventional,
    /// One line, with no description.
    Summary,
}

/// A message the AI wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WrittenMessage {
    pub summary: String,
    pub description: String,
    /// The provider, for "Written by Claude": "Claude", "OpenAI", "Gemini", or the model's
    /// name for one on this computer.
    pub by: String,
    /// How many staged files' changes were sent.
    pub files: u32,
    /// Staged files whose contents weren't sent (only their names): in Git LFS, or not text.
    pub left_out: Vec<String>,
    /// Some changes were cut short, to keep what's sent small.
    pub shortened: bool,
}

const ANTHROPIC: &str = "https://api.anthropic.com/v1";
const OPENAI: &str = "https://api.openai.com/v1";
const GEMINI: &str = "https://generativelanguage.googleapis.com/v1beta";
/// Ollama's, the likeliest server on this computer.
pub const LOCAL: &str = "http://localhost:11434/v1";
const ANTHROPIC_VERSION: &str = "2026-10-21";
/// Enough for a message, with room for a model that thinks first.
const MOST_TOKENS: u32 = 8192;
/// Each file's changes are cut short after this many bytes…
const MOST_PER_FILE: usize = 6_000;
/// …and only the names of the files after this many are sent.
const MOST_IN_ALL: usize = 40_000;
/// How many of the last commits' summaries show the repository's style.
const RECENT: &str = "12";
/// Looking up a kept key.
const LOOKUP: Duration = Duration::from_secs(10);
/// Writing can take a while: a big change, a model that thinks, or one on a slow computer.
const WRITING: Duration = Duration::from_secs(120);

/// Where a provider's API is, and how it's named in messages.
struct Endpoint {
    provider: AiProvider,
    base: String,
}

impl Endpoint {
    fn of(setup: &AiSetup) -> Result<Self> {
        let base = match setup.provider {
            AiProvider::Anthropic => ANTHROPIC.to_owned(),
            AiProvider::Openai => OPENAI.to_owned(),
            AiProvider::Gemini => GEMINI.to_owned(),
            AiProvider::Local => local_base(&setup.address)?,
        };
        Ok(Endpoint {
            provider: setup.provider,
            base,
        })
    }

    fn name(&self) -> &'static str {
        name(self.provider)
    }

    /// The host git keeps the key for: the API's.
    fn host(&self) -> Result<String> {
        let url = reqwest::Url::parse(&self.base).map_err(|e| Error::Message(e.to_string()))?;
        let host = url.host_str().ok_or("That address has no host.")?;
        Ok(match url.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_owned(),
        })
    }

    /// On this computer: no proxy, and no need for one.
    fn on_this_computer(&self) -> bool {
        reqwest::Url::parse(&self.base).is_ok_and(|url| {
            let host = url.host_str().unwrap_or_default();
            host == "localhost"
                || host
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        })
    }

    fn client(&self, timeout: Duration) -> Result<reqwest::Client> {
        crate::github::client_waiting(timeout, !self.on_this_computer())
    }
}

/// The provider's name, as messages say it.
fn name(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Anthropic => "Claude",
        AiProvider::Openai => "OpenAI",
        AiProvider::Gemini => "Gemini",
        AiProvider::Local => "The model on this computer",
    }
}

/// A local server's address, with its scheme and without a slash at the end.
fn local_base(address: &str) -> Result<String> {
    let address = address.trim().trim_end_matches('/');
    if address.is_empty() {
        return Ok(LOCAL.to_owned());
    }
    let base = if address.contains("://") {
        address.to_owned()
    } else {
        format!("http://{address}")
    };
    match reqwest::Url::parse(&base) {
        Ok(url) if matches!(url.scheme(), "http" | "https") && url.host_str().is_some() => Ok(base),
        _ => Err(Error::known(
            ErrorKind::AiSetup,
            format!("{address} isn't a server's address: it's like http://localhost:11434/v1."),
        )),
    }
}

fn git() -> Result<Git> {
    Ok(Git::find(std::env::temp_dir())?.in_background())
}

/// The key git keeps for the provider, if it keeps one.
fn kept_key(endpoint: &Endpoint) -> Result<Option<String>> {
    Ok(git()?
        .fill_credential(&endpoint.host()?, false, LOOKUP)
        .map(|credential| credential.password))
}

/// Whether a key is kept for the provider.
pub fn key(setup: &AiSetup) -> Result<AiKey> {
    let endpoint = Endpoint::of(setup)?;
    Ok(match kept_key(&endpoint)? {
        Some(key) => AiKey {
            kept: true,
            ends: Some(ends(&key)),
        },
        None => AiKey::default(),
    })
}

/// A key's last four characters.
fn ends(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

/// Check a key with the provider (by asking for its models), then hand it to git's
/// credential helper.
pub async fn save_key(setup: &AiSetup, key: &str) -> Result<AiKey> {
    let endpoint = Endpoint::of(setup)?;
    let key = key.trim().to_owned();
    if key.is_empty() || key.contains(char::is_whitespace) {
        return Err(Error::known(
            ErrorKind::AiSetup,
            format!("Paste the API key {} gave you.", endpoint.name()),
        ));
    }
    list_models(&endpoint, Some(&key)).await?;
    let host = endpoint.host()?;
    let saved = key.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let git = git()?;
        let credential = Credential {
            username: "api-key".to_owned(),
            password: saved.clone(),
        };
        // A key kept from before would be found first: forget it.
        git.reject_credential(&host)?;
        git.approve_credential(&host, &credential)?;
        // Without a credential helper, git keeps nothing, and says nothing about it.
        let kept = git.fill_credential(&host, false, LOOKUP);
        if kept.is_none_or(|kept| kept.password != saved) {
            return Err(Error::Message(
                "Git has nowhere safe to keep the key: set up a credential helper, like Git Credential Manager (https://gh.io/gcm), and try again.".into(),
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| Error::Message(e.to_string()))??;
    Ok(AiKey {
        kept: true,
        ends: Some(ends(&key)),
    })
}

/// Forget the provider's key (in git's credential helper).
pub fn forget_key(setup: &AiSetup) -> Result<()> {
    git()?.reject_credential(&Endpoint::of(setup)?.host()?)
}

/// The key to send, from git: a model on this computer may not need one.
async fn key_for(endpoint: &Endpoint) -> Result<Option<String>> {
    let found = {
        let host = endpoint.host()?;
        tauri::async_runtime::spawn_blocking(move || {
            Ok::<_, Error>(git()?.fill_credential(&host, false, LOOKUP))
        })
        .await
        .map_err(|e| Error::Message(e.to_string()))??
    };
    match found {
        Some(credential) => Ok(Some(credential.password)),
        None if endpoint.provider == AiProvider::Local => Ok(None),
        None => Err(Error::known(
            ErrorKind::AiSetup,
            format!(
                "Add your {} API key in Settings → AI first.",
                provider_company(endpoint.provider)
            ),
        )),
    }
}

/// Whose key it is: "Anthropic", "OpenAI", "Google AI Studio".
fn provider_company(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Anthropic => "Anthropic",
        AiProvider::Openai => "OpenAI",
        AiProvider::Gemini => "Google AI Studio",
        AiProvider::Local => "server's",
    }
}

/// The provider's models, newest first, with the one Tributary would pick.
pub async fn models(setup: &AiSetup) -> Result<AiModels> {
    let endpoint = Endpoint::of(setup)?;
    let key = key_for(&endpoint).await?;
    list_models(&endpoint, key.as_deref()).await
}

/// A request with the provider's key in the header it reads.
fn authorise(
    endpoint: &Endpoint,
    request: reqwest::RequestBuilder,
    key: Option<&str>,
) -> reqwest::RequestBuilder {
    let Some(key) = key else { return request };
    match endpoint.provider {
        AiProvider::Anthropic => request
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION),
        AiProvider::Gemini => request.header("x-goog-api-key", key),
        AiProvider::Openai | AiProvider::Local => request.bearer_auth(key),
    }
}

/// Send a request and read its JSON, or say in plain words why it failed.
async fn send(endpoint: &Endpoint, request: reqwest::RequestBuilder) -> Result<Value> {
    let response = request
        .send()
        .await
        .map_err(|e| unreachable(endpoint, &e))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| unreachable(endpoint, &e))?;
    if status.is_success() {
        return serde_json::from_str(&text).map_err(|_| {
            Error::Message(format!(
                "{} answered with something that isn't JSON.",
                endpoint.name()
            ))
        });
    }
    // Every provider says what's wrong in the same place: {"error": {"message": …}}.
    let said = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|body| match &body["error"] {
            Value::String(message) => Some(message.clone()),
            error => error["message"].as_str().map(str::to_owned),
        })
        .filter(|message| !message.trim().is_empty());
    Err(refused(endpoint, status.as_u16(), said))
}

/// Why the provider refused, in plain words.
fn refused(endpoint: &Endpoint, status: u16, said: Option<String>) -> Error {
    let name = endpoint.name();
    let and_said = said
        .as_deref()
        .map(|said| format!(" It said: {said}"))
        .unwrap_or_default();
    // Gemini says a key is wrong with a 400.
    let key_refused = status == 400
        && said
            .as_deref()
            .is_some_and(|said| said.to_lowercase().contains("api key"));
    match status {
        _ if key_refused => Error::known(
            ErrorKind::AiSetup,
            format!(
                "{name} didn't accept the key. Check that it was copied whole, and hasn't been revoked.{and_said}"
            ),
        ),
        401 | 403 => Error::known(
            ErrorKind::AiSetup,
            format!(
                "{name} didn't accept the key. Check that it was copied whole, and hasn't been revoked.{and_said}"
            ),
        ),
        404 => Error::known(
            ErrorKind::AiSetup,
            format!(
                "{name} doesn't have that model, or isn't at that address: check Settings → AI.{and_said}"
            ),
        ),
        429 => Error::Message(format!(
            "{name} has had too many requests from this key, or its account is out of credit. Try again in a minute.{and_said}"
        )),
        500..=599 => Error::Message(format!(
            "{name} is having trouble right now. Try again in a minute.{and_said}"
        )),
        _ => Error::Message(format!("{name} refused the request ({status}).{and_said}")),
    }
}

/// The provider couldn't be reached.
fn unreachable(endpoint: &Endpoint, error: &reqwest::Error) -> Error {
    if endpoint.provider == AiProvider::Local {
        return Error::known(
            ErrorKind::AiSetup,
            format!(
                "Nothing answered at {}. Check that Ollama, LM Studio or the other server is running, with its server on.",
                endpoint.base
            ),
        );
    }
    if error.is_timeout() {
        return Error::Message(format!(
            "{} took too long to answer. Try again.",
            endpoint.name()
        ));
    }
    Error::Message(format!(
        "Couldn't reach {}: check the internet connection. ({error})",
        endpoint.name()
    ))
}

/// The provider's models, newest first, with the one Tributary would pick.
async fn list_models(endpoint: &Endpoint, key: Option<&str>) -> Result<AiModels> {
    let client = endpoint.client(Duration::from_secs(20))?;
    let mut models = Vec::new();
    match endpoint.provider {
        AiProvider::Anthropic => {
            // Newest first, a page at a time.
            let mut after: Option<String> = None;
            for _ in 0..10 {
                let mut url = format!("{}/models?limit=1000", endpoint.base);
                if let Some(after) = &after {
                    url.push_str(&format!("&after_id={after}"));
                }
                let page = send(endpoint, authorise(endpoint, client.get(url), key)).await?;
                for model in page["data"].as_array().into_iter().flatten() {
                    if let Some(id) = model["id"].as_str() {
                        models.push(AiModel {
                            id: id.to_owned(),
                            name: model["display_name"].as_str().unwrap_or(id).to_owned(),
                        });
                    }
                }
                after = page["last_id"].as_str().map(str::to_owned);
                if page["has_more"].as_bool() != Some(true) || after.is_none() {
                    break;
                }
            }
        }
        AiProvider::Openai | AiProvider::Local => {
            let url = format!("{}/models", endpoint.base);
            let page = send(endpoint, authorise(endpoint, client.get(url), key)).await?;
            let mut listed: Vec<(i64, AiModel)> = page["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|model| {
                    let id = model["id"].as_str()?;
                    let model_name = model["name"].as_str().unwrap_or(id);
                    Some((
                        model["created"].as_i64().unwrap_or(0),
                        AiModel {
                            id: id.to_owned(),
                            name: model_name.to_owned(),
                        },
                    ))
                })
                .filter(|(_, model)| {
                    endpoint.provider == AiProvider::Local || writes_chat(&model.id)
                })
                .collect();
            // OpenAI's list isn't in order; a local server's is its own, kept as it is.
            if endpoint.provider == AiProvider::Openai {
                listed.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
            }
            models.extend(listed.into_iter().map(|(_, model)| model));
        }
        AiProvider::Gemini => {
            let mut token: Option<String> = None;
            for _ in 0..10 {
                let mut url = format!("{}/models?pageSize=1000", endpoint.base);
                if let Some(token) = &token {
                    url.push_str(&format!("&pageToken={token}"));
                }
                let page = send(endpoint, authorise(endpoint, client.get(url), key)).await?;
                for model in page["models"].as_array().into_iter().flatten() {
                    let writes =
                        model["supportedGenerationMethods"]
                            .as_array()
                            .is_some_and(|methods| {
                                methods.iter().any(|method| method == "generateContent")
                            });
                    let Some(id) = model["name"]
                        .as_str()
                        .map(|name| name.trim_start_matches("models/"))
                    else {
                        continue;
                    };
                    if writes && writes_gemini(id) {
                        models.push(AiModel {
                            id: id.to_owned(),
                            name: model["displayName"].as_str().unwrap_or(id).to_owned(),
                        });
                    }
                }
                token = page["nextPageToken"]
                    .as_str()
                    .filter(|token| !token.is_empty())
                    .map(str::to_owned);
                if token.is_none() {
                    break;
                }
            }
            // Newest version first; at the same version, the finished ones before previews.
            models.sort_by(|a, b| {
                gemini_version(&b.id)
                    .total_cmp(&gemini_version(&a.id))
                    .then_with(|| unfinished(&a.id).cmp(&unfinished(&b.id)))
            });
        }
    }
    let picked = pick(endpoint.provider, &models);
    Ok(AiModels { models, picked })
}

/// OpenAI models that write chat messages, not pictures, speech, embeddings or searches.
fn writes_chat(id: &str) -> bool {
    let chat = id.starts_with("gpt-")
        || id.starts_with("chatgpt-")
        || (id.starts_with('o') && id[1..].starts_with(|c: char| c.is_ascii_digit()));
    const NOT: [&str; 14] = [
        "audio",
        "realtime",
        "tts",
        "transcribe",
        "search",
        "image",
        "embedding",
        "moderation",
        "instruct",
        "whisper",
        "dall-e",
        "codex",
        "-pro",
        "deep-research",
    ];
    chat && !NOT.iter().any(|not| id.contains(not))
}

/// Gemini models that write text.
fn writes_gemini(id: &str) -> bool {
    const NOT: [&str; 8] = [
        "embedding",
        "image",
        "tts",
        "audio",
        "live",
        "robotics",
        "aqa",
        "computer-use",
    ];
    id.starts_with("gemini") && !NOT.iter().any(|not| id.contains(not))
}

/// "gemini-2.5-flash" → 2.5.
fn gemini_version(id: &str) -> f64 {
    id.split('-')
        .nth(1)
        .and_then(|version| version.parse().ok())
        .unwrap_or(0.0)
}

/// A preview or experiment, not a finished model.
fn unfinished(id: &str) -> bool {
    id.contains("preview") || id.contains("exp")
}

/// The model used when none is chosen: the newest of the quick, cheap ones, which are
/// plenty for a commit message (Claude's Haiku, OpenAI's mini, Gemini's Flash), else the
/// newest.
fn pick(provider: AiProvider, models: &[AiModel]) -> Option<String> {
    let quick = |id: &str| match provider {
        AiProvider::Anthropic => id.contains("haiku"),
        AiProvider::Openai => id.contains("mini") && !id.contains("nano"),
        AiProvider::Gemini => id.contains("flash") && !id.contains("lite") && !unfinished(id),
        AiProvider::Local => false,
    };
    models
        .iter()
        .find(|model| quick(&model.id))
        .or(models.first())
        .map(|model| model.id.clone())
}

/// What's sent about the staged changes.
#[derive(Debug, Default, PartialEq, Eq)]
struct Staged {
    /// The changes, as a diff, cut short where it's long.
    diff: String,
    /// How many files' changes are in it.
    files: u32,
    /// Files whose contents aren't sent: in Git LFS, or not text.
    left_out: Vec<String>,
    /// Files only named, after the limit was reached.
    only_named: Vec<String>,
    shortened: bool,
}

/// A file's part of a diff: from its "diff --git" line to the next one.
fn file_parts(diff: &str) -> Vec<&str> {
    let mut starts: Vec<usize> = diff
        .match_indices("diff --git ")
        .filter(|(at, _)| *at == 0 || diff.as_bytes()[at - 1] == b'\n')
        .map(|(at, _)| at)
        .collect();
    starts.push(diff.len());
    starts
        .windows(2)
        .map(|pair| &diff[pair[0]..pair[1]])
        .collect()
}

/// The file a part of a diff is about.
fn file_of(part: &str) -> String {
    let line = |prefix: &str| {
        part.lines()
            .find_map(|line| line.strip_prefix(prefix))
            .filter(|path| *path != "/dev/null")
            .map(|path| path.trim_end_matches('\t').to_owned())
    };
    line("+++ b/")
        .or_else(|| line("--- a/"))
        .or_else(|| line("rename to "))
        .or_else(|| {
            // "diff --git a/<path> b/<path>": the same path twice, when it wasn't renamed.
            let rest = part.lines().next()?.strip_prefix("diff --git a/")?;
            let half = rest.len().checked_sub(3)? / 2;
            (rest.get(half..half + 3) == Some(" b/")).then(|| rest[..half].to_owned())
        })
        .unwrap_or_else(|| "a file".to_owned())
}

/// Text cut at a line's end at most `most` bytes in, and how many lines were left off.
fn cut(text: &str, most: usize) -> (&str, usize) {
    if text.len() <= most {
        return (text, 0);
    }
    let mut end = most;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let end = text[..end].rfind('\n').map_or(end, |at| at + 1);
    (&text[..end], text[end..].lines().count())
}

/// The staged changes, as sent: Git LFS and binary files only named, each file's changes
/// cut short at [`MOST_PER_FILE`], and only names after [`MOST_IN_ALL`].
fn read_staged(diff: &str) -> Staged {
    let mut staged = Staged::default();
    for part in file_parts(diff) {
        let file = file_of(part);
        // A pointer's first line, added, removed or unchanged around a new oid.
        let in_lfs = part.lines().any(|line| {
            line.starts_with(['+', '-', ' '])
                && line[1..].starts_with("version https://git-lfs.github.com/spec/")
        });
        let binary = part
            .lines()
            .any(|line| line.starts_with("Binary files ") || line == "GIT binary patch");
        if in_lfs || binary {
            staged.left_out.push(file);
            continue;
        }
        if staged.diff.len() >= MOST_IN_ALL {
            staged.only_named.push(file);
            staged.shortened = true;
            continue;
        }
        let (kept, left) = cut(part, MOST_PER_FILE);
        staged.diff.push_str(kept);
        if left > 0 {
            staged
                .diff
                .push_str(&format!("… ({left} more lines of this file not shown)\n"));
            staged.shortened = true;
        }
        staged.files += 1;
    }
    staged
}

/// What the AI is told to do.
fn instructions(style: MessageStyle) -> String {
    let form = match style {
        MessageStyle::Repository => {
            "Write it the way the repository's recent commit summaries are written: the same tense, capitals, prefixes and length. Then, when the summary alone doesn't say enough, a blank line and a short description of what changed and why, in plain sentences, with no line breaks inside a paragraph."
        }
        MessageStyle::Conventional => {
            "Use the Conventional Commits form: type(scope): summary, where type is one of feat, fix, docs, style, refactor, perf, test, build, ci, chore or revert, and the scope is optional. Then, when the summary alone doesn't say enough, a blank line and a short description of what changed and why, in plain sentences, with no line breaks inside a paragraph."
        }
        MessageStyle::Summary => "Write only the summary line, with no description.",
    };
    format!(
        "You write git commit messages. You're given a repository's staged changes as a diff (shortened where it's long), the branch's name, and sometimes the repository's recent commit summaries and what the person has started writing.\n\n\
         The message starts with a summary line of at most 72 characters, in the imperative mood (\"Add\", \"Fix\"), saying what the commit does. {form}\n\n\
         Describe only what the changes show: don't invent reasons, issue numbers or names. If the person has started writing, keep their meaning. \
         Reply with the commit message alone: no quotes, no Markdown, no code fences, nothing before or after it."
    )
}

/// What the AI is given about the changes.
fn prompt(staged: &Staged, branch: Option<&str>, recent: &[String], draft: &str) -> String {
    let mut text = String::new();
    if let Some(branch) = branch {
        text.push_str(&format!("Branch: {branch}\n\n"));
    }
    if !recent.is_empty() {
        text.push_str("The repository's recent commit summaries, newest first:\n");
        for summary in recent {
            text.push_str(&format!("- {summary}\n"));
        }
        text.push('\n');
    }
    if !draft.trim().is_empty() {
        text.push_str(&format!(
            "What the person has started writing:\n{}\n\n",
            draft.trim()
        ));
    }
    if !staged.left_out.is_empty() {
        text.push_str("Also staged, not text or in Git LFS (contents not shown):\n");
        for file in &staged.left_out {
            text.push_str(&format!("- {file}\n"));
        }
        text.push('\n');
    }
    if !staged.only_named.is_empty() {
        text.push_str("Also changed (not shown, to keep this short):\n");
        for file in &staged.only_named {
            text.push_str(&format!("- {file}\n"));
        }
        text.push('\n');
    }
    if staged.diff.is_empty() {
        text.push_str("No text changes are shown: write the message from the files' names.\n");
    } else {
        text.push_str("The staged changes:\n");
        text.push_str(&staged.diff);
    }
    text
}

/// The message in what the AI wrote: its summary and description, without fences, quotes
/// or a "Commit message:" before it.
fn read_message(text: &str, style: MessageStyle) -> Option<(String, String)> {
    let mut text = text.trim();
    if let Some(fenced) = text.strip_prefix("```") {
        // The fence's first line may name a language.
        let inside = fenced.split_once('\n').map_or("", |(_, rest)| rest);
        text = inside.trim_end().trim_end_matches("```").trim();
    }
    let mut lines = text.lines().skip_while(|line| line.trim().is_empty());
    let mut summary = lines.next()?.trim();
    for lead in ["Commit message:", "Summary:", "Subject:"] {
        if let Some(rest) = summary.strip_prefix(lead) {
            summary = rest.trim();
        }
    }
    let summary = summary.trim_matches(['"', '`', '\'']).trim().to_owned();
    if summary.is_empty() {
        return None;
    }
    let description = match style {
        MessageStyle::Summary => String::new(),
        _ => {
            let rest: Vec<&str> = lines.collect();
            let rest = rest.join("\n");
            let rest = rest.trim();
            rest.strip_prefix("Description:")
                .unwrap_or(rest)
                .trim()
                .trim_end_matches(['"', '`'])
                .trim()
                .to_owned()
        }
    };
    Some((summary, description))
}

/// Ask the provider for a message, and read what it wrote.
async fn ask(
    endpoint: &Endpoint,
    key: Option<&str>,
    model: &str,
    system: &str,
    prompt: &str,
) -> Result<String> {
    let client = endpoint.client(WRITING)?;
    match endpoint.provider {
        AiProvider::Anthropic => {
            let body = json!({
                "model": model,
                "max_tokens": MOST_TOKENS,
                "system": system,
                "messages": [{ "role": "user", "content": prompt }],
            });
            let url = format!("{}/messages", endpoint.base);
            let reply = send(
                endpoint,
                authorise(endpoint, client.post(url).json(&body), key),
            )
            .await?;
            if reply["stop_reason"] == "refusal" {
                return Err("Claude wouldn't write a message for these changes.".into());
            }
            // Only the text: a model that thinks first gives its thinking too.
            Ok(reply["content"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|block| block["type"] == "text")
                .filter_map(|block| block["text"].as_str())
                .collect::<Vec<_>>()
                .join(""))
        }
        AiProvider::Openai | AiProvider::Local => {
            let body = json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": system },
                    { "role": "user", "content": prompt },
                ],
            });
            let url = format!("{}/chat/completions", endpoint.base);
            let reply = send(
                endpoint,
                authorise(endpoint, client.post(url).json(&body), key),
            )
            .await?;
            let text = reply["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or_default();
            // Some local models put their thinking first, between <think> tags.
            Ok(match text.rfind("</think>") {
                Some(at) => text[at + "</think>".len()..].to_owned(),
                None => text.to_owned(),
            })
        }
        AiProvider::Gemini => {
            let body = json!({
                "systemInstruction": { "parts": [{ "text": system }] },
                "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
            });
            let url = format!("{}/models/{model}:generateContent", endpoint.base);
            let reply = send(
                endpoint,
                authorise(endpoint, client.post(url).json(&body), key),
            )
            .await?;
            Ok(reply["candidates"][0]["content"]["parts"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|part| part["thought"] != true)
                .filter_map(|part| part["text"].as_str())
                .collect::<Vec<_>>()
                .join(""))
        }
    }
}

/// What's needed from the repository: the staged changes, the branch, and the last commits'
/// summaries when the message is to read like them.
fn gather(path: &Path, style: MessageStyle) -> Result<(Staged, Option<String>, Vec<String>)> {
    let git = Git::find(path.to_owned())?;
    let diff = git.run_bytes(
        &[
            "-c",
            "core.quotepath=false",
            "diff",
            "--cached",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            "--src-prefix=a/",
            "--dst-prefix=b/",
        ],
        None,
    )?;
    let diff = String::from_utf8_lossy(&diff);
    if diff.trim().is_empty() {
        return Err("Stage the changes the message is for first.".into());
    }
    let staged = read_staged(&diff);
    let branch = git
        .run(&["symbolic-ref", "--short", "-q", "HEAD"])
        .ok()
        .map(|branch| branch.trim().to_owned())
        .filter(|branch| !branch.is_empty());
    let recent = match style {
        // A repository with no commits yet has no style to follow.
        MessageStyle::Repository => git
            .run(&["log", "-n", RECENT, "--no-merges", "--format=%s"])
            .map(|log| {
                log.lines()
                    .map(str::to_owned)
                    .filter(|line| !line.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    Ok((staged, branch, recent))
}

/// Write a commit message for the staged changes in `path`, with the AI in `setup`. `draft`
/// is what the person had typed in the summary, to build on.
pub async fn write_commit_message(
    path: &Path,
    setup: &AiSetup,
    style: MessageStyle,
    draft: &str,
) -> Result<WrittenMessage> {
    let endpoint = Endpoint::of(setup)?;
    let (staged, branch, recent) = {
        let path = path.to_owned();
        tauri::async_runtime::spawn_blocking(move || gather(&path, style))
            .await
            .map_err(|e| Error::Message(e.to_string()))??
    };
    let key = key_for(&endpoint).await?;
    let model = match setup.model.trim() {
        "" => list_models(&endpoint, key.as_deref())
            .await?
            .picked
            .ok_or_else(|| {
                Error::known(
                    ErrorKind::AiSetup,
                    format!("{} has no models to write with.", endpoint.name()),
                )
            })?,
        chosen => chosen.to_owned(),
    };
    let text = ask(
        &endpoint,
        key.as_deref(),
        &model,
        &instructions(style),
        &prompt(&staged, branch.as_deref(), &recent, draft),
    )
    .await?;
    let (summary, description) = read_message(&text, style).ok_or_else(|| {
        Error::Message(format!(
            "{} didn't write a message. Try again.",
            endpoint.name()
        ))
    })?;
    Ok(WrittenMessage {
        summary,
        description,
        by: match endpoint.provider {
            AiProvider::Local => model,
            provider => name(provider).to_owned(),
        },
        files: staged.files + staged.only_named.len() as u32,
        left_out: staged.left_out,
        shortened: staged.shortened,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const LFS_DIFF: &str = "diff --git a/Art/hero.psd b/Art/hero.psd\nindex 1..2 100644\n--- a/Art/hero.psd\n+++ b/Art/hero.psd\n@@ -1,3 +1,3 @@\n version https://git-lfs.github.com/spec/v1\n-oid sha256:aaa\n+oid sha256:bbb\n";

    #[test]
    fn leaves_out_lfs_and_binary_files() {
        let diff = format!(
            "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n{LFS_DIFF}diff --git a/logo.png b/logo.png\nnew file mode 100644\nBinary files /dev/null and b/logo.png differ\n"
        );
        // A new pointer shows its first line added.
        let new_pointer = "diff --git a/a.fbx b/a.fbx\nnew file mode 100644\n--- /dev/null\n+++ b/a.fbx\n@@ -0,0 +1,3 @@\n+version https://git-lfs.github.com/spec/v1\n+oid sha256:ccc\n+size 12\n";
        let staged = read_staged(&format!("{diff}{new_pointer}"));
        assert_eq!(staged.files, 1);
        assert!(staged.diff.contains("+new"));
        assert!(!staged.diff.contains("hero.psd"));
        assert_eq!(staged.left_out, ["Art/hero.psd", "logo.png", "a.fbx"]);
        assert!(!staged.shortened);
    }

    #[test]
    fn a_changed_pointer_is_left_out_too() {
        // Only the oid changed: the pointer's first line is there, unchanged.
        let staged = read_staged(LFS_DIFF);
        assert_eq!(staged.left_out, ["Art/hero.psd"]);
        assert_eq!(staged.files, 0);
    }

    #[test]
    fn cuts_long_changes_short() {
        let long: String = (0..2000).map(|n| format!("+line {n}\n")).collect();
        let part = format!(
            "diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -0,0 +1,2000 @@\n{long}"
        );
        let staged = read_staged(&part);
        assert!(staged.shortened);
        assert!(staged.diff.len() < MOST_PER_FILE + 100);
        assert!(
            staged
                .diff
                .ends_with("more lines of this file not shown)\n")
        );
        // Past the limit in all, files are only named.
        let many: String = (0..20)
            .map(|n| part.replace("big.txt", &format!("big{n}.txt")))
            .collect();
        let staged = read_staged(&many);
        assert!(staged.diff.len() < MOST_IN_ALL + MOST_PER_FILE + 100);
        assert!(!staged.only_named.is_empty());
        assert_eq!(staged.files as usize + staged.only_named.len(), 20);
    }

    #[test]
    fn cuts_at_a_character_boundary() {
        let (kept, left) = cut("ééé\nééé\n", 9);
        assert_eq!(kept, "ééé\n");
        assert_eq!(left, 1);
    }

    #[test]
    fn names_files_from_their_part() {
        assert_eq!(
            file_of("diff --git a/x y.txt b/x y.txt\n--- a/x y.txt\n+++ b/x y.txt\n"),
            "x y.txt"
        );
        assert_eq!(
            file_of("diff --git a/gone.txt b/gone.txt\n--- a/gone.txt\n+++ /dev/null\n"),
            "gone.txt"
        );
        assert_eq!(
            file_of("diff --git a/old b/new\nrename from old\nrename to new\n"),
            "new"
        );
        assert_eq!(
            file_of("diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n"),
            "run.sh"
        );
    }

    #[test]
    fn reads_the_message_out_of_what_was_written() {
        let style = MessageStyle::Repository;
        assert_eq!(
            read_message("Add a welcome screen\n\nShows a short tour.\n", style),
            Some(("Add a welcome screen".into(), "Shows a short tour.".into()))
        );
        assert_eq!(
            read_message(
                "```text\nFix the login timeout\n\nWaits longer.\n```",
                style
            ),
            Some(("Fix the login timeout".into(), "Waits longer.".into()))
        );
        assert_eq!(
            read_message("Commit message: \"Fix typo\"", style),
            Some(("Fix typo".into(), String::new()))
        );
        assert_eq!(
            read_message("Fix typo\n\nIn the README.", MessageStyle::Summary),
            Some(("Fix typo".into(), String::new()))
        );
        assert_eq!(read_message("  \n ", style), None);
    }

    #[test]
    fn picks_a_quick_model() {
        let models = |ids: &[&str]| -> Vec<AiModel> {
            ids.iter()
                .map(|id| AiModel {
                    id: (*id).into(),
                    name: (*id).into(),
                })
                .collect()
        };
        assert_eq!(
            pick(
                AiProvider::Anthropic,
                &models(&["big-opus", "mid-sonnet", "small-haiku"])
            )
            .as_deref(),
            Some("small-haiku")
        );
        assert_eq!(
            pick(AiProvider::Anthropic, &models(&["only-one"])).as_deref(),
            Some("only-one")
        );
        assert_eq!(
            pick(
                AiProvider::Openai,
                &models(&["gpt-9", "gpt-9-nano", "gpt-9-mini"])
            )
            .as_deref(),
            Some("gpt-9-mini")
        );
        assert_eq!(
            pick(
                AiProvider::Gemini,
                &models(&[
                    "gemini-9-pro",
                    "gemini-9-flash-preview",
                    "gemini-9-flash-lite",
                    "gemini-9-flash"
                ])
            )
            .as_deref(),
            Some("gemini-9-flash")
        );
        assert_eq!(pick(AiProvider::Local, &models(&[])), None);
    }

    #[test]
    fn keeps_models_that_write() {
        assert!(writes_chat("gpt-9-mini"));
        assert!(writes_chat("o7"));
        assert!(!writes_chat("gpt-9-realtime"));
        assert!(!writes_chat("text-embedding-9"));
        assert!(!writes_chat("omni-moderation-latest"));
        assert!(writes_gemini("gemini-9-flash"));
        assert!(!writes_gemini("gemini-embedding-9"));
        assert_eq!(gemini_version("gemini-2.5-flash"), 2.5);
    }

    #[test]
    fn reads_local_addresses() {
        assert_eq!(local_base("").ok().as_deref(), Some(LOCAL));
        assert_eq!(
            local_base("localhost:1234/v1/").ok().as_deref(),
            Some("http://localhost:1234/v1")
        );
        assert!(local_base("ftp://example.com").is_err());
        let endpoint = Endpoint::of(&AiSetup {
            provider: AiProvider::Local,
            model: String::new(),
            address: "http://127.0.0.1:1234/v1".into(),
        })
        .unwrap();
        assert_eq!(endpoint.host().unwrap(), "127.0.0.1:1234");
        assert!(endpoint.on_this_computer());
        let endpoint = Endpoint::of(&AiSetup {
            provider: AiProvider::Anthropic,
            model: String::new(),
            address: String::new(),
        })
        .unwrap();
        assert_eq!(endpoint.host().unwrap(), "api.anthropic.com");
        assert!(!endpoint.on_this_computer());
    }

    #[test]
    fn shows_only_the_last_four_of_a_key() {
        assert_eq!(ends("sk-ant-0123456789abcd"), "abcd");
        assert_eq!(ends("ab"), "ab");
    }

    #[test]
    fn the_prompt_names_what_isnt_shown() {
        let staged = Staged {
            diff: "diff --git a/a b/a\n+x\n".into(),
            files: 1,
            left_out: vec!["hero.psd".into()],
            only_named: vec!["big.json".into()],
            shortened: true,
        };
        let text = prompt(
            &staged,
            Some("feature/login"),
            &["Fix the build".into()],
            "login",
        );
        assert!(text.contains("Branch: feature/login"));
        assert!(text.contains("- Fix the build"));
        assert!(text.contains("started writing:\nlogin"));
        assert!(text.contains("- hero.psd"));
        assert!(text.contains("- big.json"));
        assert!(text.ends_with("+x\n"));
    }
}
