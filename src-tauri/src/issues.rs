//! Issue trackers: the titles and states of issues that commit messages and branch names
//! mention (like FEAST-12, or #12), and the open issues assigned to you, to start a branch
//! from. GitHub and GitLab issues use the token git keeps for the site; Jira and Linear use
//! a key you sign in with, kept by git's credential helper too (Tributary doesn't keep it).

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{Error, Result};
use crate::git::{Credential, Git};
use crate::github::client;
use crate::requests::{Site, site};

/// Which tracker a repository's issues are in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackerKind {
    Github,
    Gitlab,
    Jira,
    Linear,
}

/// A repository's issue tracker, as set in its settings.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tracker {
    pub kind: TrackerKind,
    /// Jira's address (like `https://studio.atlassian.net`), or Linear's workspace (`studio`).
    #[serde(default)]
    pub site: String,
    /// Project (or team) keys, like FEAST; empty for any.
    #[serde(default)]
    pub keys: Vec<String>,
}

/// One issue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// Like "FEAST-12", or "#12".
    pub key: String,
    pub title: String,
    /// Like "In Progress".
    pub status: Option<String>,
    /// Done, closed or cancelled.
    pub done: bool,
    pub url: String,
}

/// Whether you're signed in to the tracker, and as whom.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerStatus {
    pub signed_in: bool,
    pub user: Option<String>,
}

const LINEAR_API: &str = "https://api.linear.app/graphql";
const LINEAR_HOST: &str = "api.linear.app";
/// At most this many issues are looked up at once.
const MOST: usize = 40;

fn git() -> Result<Git> {
    Ok(Git::find(std::env::temp_dir())?.in_background())
}

/// Jira's address, with https:// and without a slash at the end.
pub fn jira_base(site: &str) -> Result<String> {
    let site = site.trim().trim_end_matches('/');
    if site.is_empty() {
        return Err("Enter your Jira's address first, like https://studio.atlassian.net.".into());
    }
    let base = if site.contains("://") {
        site.to_owned()
    } else {
        format!("https://{site}")
    };
    let url = reqwest::Url::parse(&base).map_err(|_| format!("\"{site}\" isn't an address."))?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err(format!("\"{site}\" isn't an https address.").into());
    }
    Ok(base)
}

/// The host a tracker's key is kept for.
fn credential_host(tracker: &Tracker) -> Result<String> {
    match tracker.kind {
        TrackerKind::Jira => {
            let base = jira_base(&tracker.site)?;
            Ok(reqwest::Url::parse(&base)
                .ok()
                .and_then(|url| url.host_str().map(str::to_owned))
                .unwrap_or_default())
        }
        TrackerKind::Linear => Ok(LINEAR_HOST.to_owned()),
        _ => Err("GitHub and GitLab issues use the site's own sign-in.".into()),
    }
}

/// The key kept for a Jira or Linear tracker: email (or nothing, for a personal access
/// token) and token.
fn stored(tracker: &Tracker) -> Option<Credential> {
    let host = credential_host(tracker).ok()?;
    git()
        .ok()?
        .fill_credential(&host, false, Duration::from_secs(10))
}

/// A request to Jira with its key: basic auth with an email (Jira Cloud), or a bearer
/// personal access token (Jira Server and Data Center).
fn jira_request(
    client: &reqwest::Client,
    url: String,
    credential: &Credential,
) -> reqwest::RequestBuilder {
    let request = client.get(url).header("Accept", "application/json");
    if credential.username.is_empty() {
        request.bearer_auth(&credential.password)
    } else {
        request.basic_auth(&credential.username, Some(&credential.password))
    }
}

fn jira_issue(base: &str, raw: &Value) -> Option<Issue> {
    let key = raw["key"].as_str()?.to_owned();
    let fields = &raw["fields"];
    Some(Issue {
        url: format!("{base}/browse/{key}"),
        key,
        title: fields["summary"].as_str().unwrap_or_default().to_owned(),
        status: fields["status"]["name"].as_str().map(str::to_owned),
        done: fields["status"]["statusCategory"]["key"].as_str() == Some("done"),
    })
}

fn linear_issue(raw: &Value) -> Option<Issue> {
    Some(Issue {
        key: raw["identifier"].as_str()?.to_owned(),
        title: raw["title"].as_str().unwrap_or_default().to_owned(),
        status: raw["state"]["name"].as_str().map(str::to_owned),
        done: matches!(
            raw["state"]["type"].as_str(),
            Some("completed" | "canceled")
        ),
        url: raw["url"].as_str().unwrap_or_default().to_owned(),
    })
}

/// A GraphQL query to Linear.
async fn linear(query: &str, variables: Value, key: &str) -> Result<Value> {
    let response = client()?
        .post(LINEAR_API)
        .header("Authorization", key)
        .json(&json!({ "query": query, "variables": variables }))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Linear ({e})"))?;
    if response.status().as_u16() == 401 {
        return Err(
            "Linear didn't accept the API key: sign in again in the repository's settings.".into(),
        );
    }
    let answer: Value = response
        .json()
        .await
        .map_err(|e| format!("Couldn't read Linear's answer ({e})"))?;
    if answer["data"].is_null() {
        let message = answer["errors"][0]["message"]
            .as_str()
            .unwrap_or("it answered with an error");
        return Err(format!("Linear couldn't answer: {message}").into());
    }
    Ok(answer["data"].clone())
}

const LINEAR_FIELDS: &str = "identifier title url state { name type }";

async fn site_of(path: &Path) -> Result<Site> {
    let path = path.to_owned();
    tauri::async_runtime::spawn_blocking(move || site(&path))
        .await
        .map_err(|e| Error::Message(e.to_string()))?
}

/// The issues `keys` (like "FEAST-12", or "#12"), the ones that can be found.
pub async fn issues(path: &Path, tracker: &Tracker, keys: &[String]) -> Result<Vec<Issue>> {
    let keys: Vec<&String> = keys.iter().take(MOST).collect();
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    match tracker.kind {
        TrackerKind::Github | TrackerKind::Gitlab => {
            let numbers: Vec<u64> = keys
                .iter()
                .filter_map(|key| key.trim_start_matches('#').parse().ok())
                .collect();
            match site_of(path).await? {
                Site::GitHub {
                    full_name, token, ..
                } => crate::github::issues::issues(&full_name, token.as_deref(), &numbers).await,
                Site::GitLab { project, token } => {
                    crate::gitlab::issues::issues(&project, token.as_deref(), &numbers).await
                }
            }
        }
        TrackerKind::Jira => {
            let base = jira_base(&tracker.site)?;
            let credential = stored(tracker)
                .ok_or("Sign in to Jira in the repository's settings to see its issues.")?;
            let client = client()?;
            let mut found = Vec::new();
            for key in keys {
                let url = format!("{base}/rest/api/2/issue/{key}?fields=summary,status");
                if let Ok(answer) = jira_request(&client, url, &credential).send().await
                    && answer.status().is_success()
                    && let Ok(raw) = answer.json::<Value>().await
                    && let Some(issue) = jira_issue(&base, &raw)
                {
                    found.push(issue);
                }
            }
            Ok(found)
        }
        TrackerKind::Linear => {
            let credential = stored(tracker)
                .ok_or("Sign in to Linear in the repository's settings to see its issues.")?;
            // One query, an alias for each issue.
            let query = keys
                .iter()
                .enumerate()
                .map(|(index, _)| format!("i{index}: issue(id: $k{index}) {{ {LINEAR_FIELDS} }}"))
                .collect::<Vec<_>>()
                .join(" ");
            let parameters = (0..keys.len())
                .map(|index| format!("$k{index}: String!"))
                .collect::<Vec<_>>()
                .join(", ");
            let mut variables = serde_json::Map::new();
            for (index, key) in keys.iter().enumerate() {
                variables.insert(format!("k{index}"), json!(key));
            }
            let data = linear(
                &format!("query({parameters}) {{ {query} }}"),
                Value::Object(variables),
                &credential.password,
            )
            .await?;
            Ok((0..keys.len())
                .filter_map(|index| linear_issue(&data[format!("i{index}")]))
                .collect())
        }
    }
}

/// The open issues assigned to you, most recently updated first.
pub async fn my_issues(path: &Path, tracker: &Tracker) -> Result<Vec<Issue>> {
    match tracker.kind {
        TrackerKind::Github | TrackerKind::Gitlab => {
            match site_of(path).await? {
                Site::GitHub {
                    full_name, token, ..
                } => {
                    let token = token.ok_or(
                        "Sign in to GitHub (Settings, Accounts) to see the issues assigned to you.",
                    )?;
                    crate::github::issues::assigned(&full_name, &token).await
                }
                Site::GitLab { project, token } => {
                    let token = token.ok_or("Git has no token for this GitLab server yet: push or fetch once to sign in.")?;
                    crate::gitlab::issues::assigned(&project, &token).await
                }
            }
        }
        TrackerKind::Jira => {
            let base = jira_base(&tracker.site)?;
            let credential =
                stored(tracker).ok_or("Sign in to Jira in the repository's settings first.")?;
            let mut jql = "assignee = currentUser() AND statusCategory != Done".to_owned();
            let keys: Vec<&str> = tracker
                .keys
                .iter()
                .map(|key| key.trim())
                .filter(|key| {
                    !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                })
                .collect();
            if !keys.is_empty() {
                jql.push_str(&format!(" AND project in ({})", keys.join(", ")));
            }
            jql.push_str(" ORDER BY updated DESC");
            let client = client()?;
            let mut url = reqwest::Url::parse(&format!("{base}/rest/api/3/search/jql"))
                .map_err(|e| e.to_string())?;
            url.query_pairs_mut()
                .append_pair("jql", &jql)
                .append_pair("fields", "summary,status")
                .append_pair("maxResults", "50");
            let mut answer = jira_request(&client, url.to_string(), &credential)
                .send()
                .await
                .map_err(|e| format!("Couldn't reach Jira ({e})"))?;
            if answer.status().as_u16() == 404 {
                // Jira Server and Data Center: the older search.
                url.set_path("/rest/api/2/search");
                answer = jira_request(&client, url.to_string(), &credential)
                    .send()
                    .await
                    .map_err(|e| format!("Couldn't reach Jira ({e})"))?;
            }
            if !answer.status().is_success() {
                return Err(match answer.status().as_u16() {
                    401 | 403 => {
                        "Jira didn't accept the key: sign in again in the repository's settings."
                            .into()
                    }
                    status => format!("Jira couldn't list your issues ({status}).").into(),
                });
            }
            let raw: Value = answer
                .json()
                .await
                .map_err(|e| format!("Couldn't read Jira's answer ({e})"))?;
            Ok(raw["issues"]
                .as_array()
                .map(|issues| {
                    issues
                        .iter()
                        .filter_map(|issue| jira_issue(&base, issue))
                        .collect()
                })
                .unwrap_or_default())
        }
        TrackerKind::Linear => {
            let credential =
                stored(tracker).ok_or("Sign in to Linear in the repository's settings first.")?;
            let query = format!(
                "query {{ viewer {{ assignedIssues(first: 50, orderBy: updatedAt, filter: {{ state: {{ type: {{ nin: [\"completed\", \"canceled\"] }} }} }}) {{ nodes {{ {LINEAR_FIELDS} }} }} }} }}"
            );
            let data = linear(&query, json!({}), &credential.password).await?;
            Ok(data["viewer"]["assignedIssues"]["nodes"]
                .as_array()
                .map(|nodes| nodes.iter().filter_map(linear_issue).collect())
                .unwrap_or_default())
        }
    }
}

/// Who you are on the tracker, with the key kept for it (Jira and Linear).
async fn who(tracker: &Tracker, credential: &Credential) -> Result<String> {
    match tracker.kind {
        TrackerKind::Jira => {
            let base = jira_base(&tracker.site)?;
            let answer = jira_request(&client()?, format!("{base}/rest/api/2/myself"), credential)
                .send()
                .await
                .map_err(|e| format!("Couldn't reach Jira ({e})"))?;
            if !answer.status().is_success() {
                return Err(format!(
                    "Jira didn't accept it ({}). For Jira Cloud, use your email and an API token; for your own Jira server, a personal access token without an email.",
                    answer.status()
                )
                .into());
            }
            let me: Value = answer.json().await.unwrap_or_default();
            Ok(me["displayName"]
                .as_str()
                .or(me["name"].as_str())
                .unwrap_or("you")
                .to_owned())
        }
        TrackerKind::Linear => {
            let data = linear("query { viewer { name } }", json!({}), &credential.password).await?;
            Ok(data["viewer"]["name"].as_str().unwrap_or("you").to_owned())
        }
        _ => Err("GitHub and GitLab issues use the site's own sign-in.".into()),
    }
}

/// Whether the tracker has a key kept for it, and who it belongs to.
pub async fn tracker_status(path: &Path, tracker: &Tracker) -> Result<TrackerStatus> {
    match tracker.kind {
        TrackerKind::Github | TrackerKind::Gitlab => {
            let signed_in = match site_of(path).await {
                Ok(Site::GitHub { token, .. } | Site::GitLab { token, .. }) => token.is_some(),
                Err(_) => false,
            };
            Ok(TrackerStatus {
                signed_in,
                user: None,
            })
        }
        TrackerKind::Jira | TrackerKind::Linear => {
            let found = {
                let tracker = tracker.clone();
                tauri::async_runtime::spawn_blocking(move || stored(&tracker))
                    .await
                    .map_err(|e| Error::Message(e.to_string()))?
            };
            let Some(credential) = found else {
                return Ok(TrackerStatus::default());
            };
            Ok(match who(tracker, &credential).await {
                Ok(user) => TrackerStatus {
                    signed_in: true,
                    user: Some(user),
                },
                Err(_) => TrackerStatus::default(),
            })
        }
    }
}

/// Check a key with the tracker, then hand it to git's credential helper.
pub async fn tracker_sign_in(tracker: &Tracker, user: &str, token: &str) -> Result<TrackerStatus> {
    let token = token.trim();
    if token.is_empty() {
        return Err("Paste the token first.".into());
    }
    let credential = Credential {
        username: match tracker.kind {
            TrackerKind::Linear => "api-key".to_owned(),
            _ => user.trim().to_owned(),
        },
        password: token.to_owned(),
    };
    let name = who(tracker, &credential).await?;
    let host = credential_host(tracker)?;
    git()?.approve_credential(&host, &credential)?;
    Ok(TrackerStatus {
        signed_in: true,
        user: Some(name),
    })
}

/// Forget the tracker's key (in git's credential helper).
pub fn tracker_sign_out(tracker: &Tracker) -> Result<()> {
    git()?.reject_credential(&credential_host(tracker)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_jira_addresses() {
        assert_eq!(
            jira_base("studio.atlassian.net/").ok().as_deref(),
            Some("https://studio.atlassian.net")
        );
        assert_eq!(
            jira_base(" https://jira.example.com ").ok().as_deref(),
            Some("https://jira.example.com")
        );
        assert!(jira_base("http://jira.example.com").is_err());
        assert!(jira_base("").is_err());
    }

    #[test]
    fn reads_jira_and_linear_issues() {
        let raw = json!({ "key": "FEAST-12", "fields": { "summary": "Barber's apron", "status": { "name": "Done", "statusCategory": { "key": "done" } } } });
        let issue =
            jira_issue("https://studio.atlassian.net", &raw).unwrap_or_else(|| panic!("no issue"));
        assert_eq!(issue.url, "https://studio.atlassian.net/browse/FEAST-12");
        assert!(issue.done);
        let raw = json!({ "identifier": "ENG-3", "title": "Door creak", "url": "https://linear.app/studio/issue/ENG-3", "state": { "name": "In Progress", "type": "started" } });
        let issue = linear_issue(&raw).unwrap_or_else(|| panic!("no issue"));
        assert_eq!(
            (issue.key.as_str(), issue.status.as_deref(), issue.done),
            ("ENG-3", Some("In Progress"), false)
        );
    }
}
