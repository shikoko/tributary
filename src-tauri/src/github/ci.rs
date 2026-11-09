//! CI on GitHub for any commit: the overall state of many commits in one GraphQL query
//! (each commit's "status check rollup", as GitHub shows next to it), and re-running a
//! commit's failed workflow jobs.

use std::collections::HashMap;

use serde::Deserialize;

use super::{CheckState, api_request, client};
use crate::error::Result;

/// A rollup's state as a dot's colour.
fn rollup_state(state: &str) -> Option<CheckState> {
    match state {
        "SUCCESS" => Some(CheckState::Success),
        "FAILURE" | "ERROR" => Some(CheckState::Failure),
        "PENDING" | "EXPECTED" => Some(CheckState::Pending),
        _ => None,
    }
}

/// The GraphQL query for `shas` (full commit ids) of `owner/name`.
fn query(full_name: &str, shas: &[String]) -> Option<String> {
    let (owner, name) = full_name.split_once('/')?;
    let safe = |text: &str| {
        text.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    if !safe(owner) || !safe(name) {
        return None;
    }
    let mut fields = String::new();
    for (index, sha) in shas.iter().enumerate() {
        if sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
            fields.push_str(&format!(
                "c{index}: object(oid: \"{sha}\") {{ ... on Commit {{ statusCheckRollup {{ state }} }} }} "
            ));
        }
    }
    Some(format!(
        "query {{ repository(owner: \"{owner}\", name: \"{name}\") {{ {fields}}} }}"
    ))
}

#[derive(Deserialize)]
struct Answer {
    data: Option<Data>,
}

#[derive(Deserialize)]
struct Data {
    repository: Option<HashMap<String, Option<Object>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Object {
    status_check_rollup: Option<Rollup>,
}

#[derive(Deserialize)]
struct Rollup {
    state: String,
}

/// The overall CI state of each of `shas` that has one (GraphQL needs a token).
pub(crate) async fn commit_states(
    full_name: &str,
    token: &str,
    shas: &[String],
) -> HashMap<String, CheckState> {
    let mut states = HashMap::new();
    let Some(query) = query(full_name, shas) else {
        return states;
    };
    let Ok(client) = client() else {
        return states;
    };
    let answer = client
        .post("https://api.github.com/graphql")
        .bearer_auth(token)
        .json(&serde_json::json!({ "query": query }))
        .send()
        .await;
    let Ok(answer) = answer else {
        return states;
    };
    let Ok(Answer {
        data: Some(Data {
            repository: Some(objects),
        }),
    }) = answer.json::<Answer>().await
    else {
        return states;
    };
    for (alias, object) in objects {
        let index = alias
            .strip_prefix('c')
            .and_then(|n| n.parse::<usize>().ok());
        if let (Some(sha), Some(state)) = (
            index.and_then(|index| shas.get(index)),
            object
                .and_then(|o| o.status_check_rollup)
                .and_then(|rollup| rollup_state(&rollup.state)),
        ) {
            states.insert(sha.clone(), state);
        }
    }
    states
}

#[derive(Deserialize)]
struct Runs {
    workflow_runs: Vec<Run>,
}

#[derive(Deserialize)]
struct Run {
    id: u64,
    conclusion: Option<String>,
}

/// Re-run the failed jobs of `sha`'s workflow runs; how many runs that was.
pub(crate) async fn rerun_failed(full_name: &str, token: &str, sha: &str) -> Result<usize> {
    let client = client()?;
    let base = format!("https://api.github.com/repos/{full_name}/actions/runs");
    let runs: Runs = api_request(
        &client,
        format!("{base}?head_sha={sha}&per_page=100"),
        Some(token),
    )
    .send()
    .await
    .map_err(|e| format!("Couldn't reach GitHub ({e})"))?
    .json()
    .await
    .map_err(|e| format!("Couldn't read GitHub's answer ({e})"))?;
    let failed: Vec<u64> = runs
        .workflow_runs
        .iter()
        .filter(|run| {
            matches!(
                run.conclusion.as_deref(),
                Some("failure" | "cancelled" | "timed_out")
            )
        })
        .map(|run| run.id)
        .collect();
    for id in &failed {
        let answer = client
            .post(format!("{base}/{id}/rerun-failed-jobs"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Couldn't reach GitHub ({e})"))?;
        if !answer.status().is_success() {
            return Err(match answer.status().as_u16() {
                403 | 404 => "GitHub didn't let you re-run them: the token may not be allowed to run workflows here.".into(),
                _ => format!("GitHub didn't re-run them ({}).", answer.status()).into(),
            });
        }
    }
    Ok(failed.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_for_many_commits_in_one_query() {
        let shas = vec!["a".repeat(40), "not-an-id".into(), "b".repeat(40)];
        let asked = query("studio/feast", &shas).unwrap();
        assert!(asked.starts_with("query { repository(owner: \"studio\", name: \"feast\")"));
        assert!(asked.contains(&format!("c0: object(oid: \"{}\")", "a".repeat(40))));
        assert!(asked.contains(&format!("c2: object(oid: \"{}\")", "b".repeat(40))));
        assert!(!asked.contains("not-an-id"));
        assert!(query(r#"studio/fe"ast"#, &shas).is_none());
        assert_eq!(rollup_state("EXPECTED"), Some(CheckState::Pending));
    }
}
