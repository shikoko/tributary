//! Issues on GitHub: the ones commit messages mention (#12), and those assigned to you.

use serde::Deserialize;

use super::{api_request, client};
use crate::error::Result;
use crate::issues::Issue;

#[derive(Deserialize)]
struct RawIssue {
    number: u64,
    title: String,
    state: String,
    html_url: String,
    /// Set on pull requests, which GitHub lists among issues.
    #[serde(default)]
    pull_request: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Login {
    login: String,
}

fn issue(raw: RawIssue) -> Issue {
    Issue {
        key: format!("#{}", raw.number),
        title: raw.title,
        status: Some(
            if raw.state == "closed" {
                "Closed"
            } else {
                "Open"
            }
            .to_owned(),
        ),
        done: raw.state == "closed",
        url: raw.html_url,
    }
}

/// Issues (or pull requests) `numbers`, the ones that can be found.
pub(crate) async fn issues(
    full_name: &str,
    token: Option<&str>,
    numbers: &[u64],
) -> Result<Vec<Issue>> {
    let client = client()?;
    let mut found = Vec::new();
    for number in numbers {
        let url = format!("https://api.github.com/repos/{full_name}/issues/{number}");
        if let Ok(answer) = api_request(&client, url, token).send().await
            && answer.status().is_success()
            && let Ok(raw) = answer.json::<RawIssue>().await
        {
            found.push(issue(raw));
        }
    }
    Ok(found)
}

/// The open issues in the repository assigned to you, most recently updated first.
pub(crate) async fn assigned(full_name: &str, token: &str) -> Result<Vec<Issue>> {
    let client = client()?;
    let me: Login = api_request(&client, "https://api.github.com/user".into(), Some(token))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub ({e})"))?
        .json()
        .await
        .map_err(|_| "GitHub didn't accept the token git keeps: sign in again in Settings.")?;
    let url = format!(
        "https://api.github.com/repos/{full_name}/issues?assignee={}&state=open&sort=updated&per_page=50",
        me.login
    );
    let answer = api_request(&client, url, Some(token))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
    if !answer.status().is_success() {
        return Err(format!("GitHub couldn't list your issues ({}).", answer.status()).into());
    }
    let raw: Vec<RawIssue> = answer
        .json()
        .await
        .map_err(|e| format!("Couldn't read GitHub's answer ({e})"))?;
    Ok(raw
        .into_iter()
        .filter(|raw| raw.pull_request.is_none())
        .map(issue)
        .collect())
}
