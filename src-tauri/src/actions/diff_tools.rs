//! Which diff and merge tools git opens (`git difftool`, `git mergetool`): the ones set up,
//! the ones git finds on this computer, and setting one. They're git's own settings
//! (`diff.tool`, `merge.tool`), so git uses them too.

use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::error::Result;
use crate::git::Git;

/// Visual Studio Code isn't one of git's known tools: it's set up with a command.
const VSCODE_DIFF: &str = r#"code --wait --diff "$LOCAL" "$REMOTE""#;
const VSCODE_MERGE: &str = r#"code --wait --merge "$REMOTE" "$LOCAL" "$BASE" "$MERGED""#;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DiffToolSettings {
    /// The tool names set (`diff.tool`, `merge.tool`), like "meld" or "vscode".
    pub diff: Option<String>,
    pub merge: Option<String>,
    /// Their commands, when they're set up with one (`difftool.<name>.cmd`).
    pub diff_command: Option<String>,
    pub merge_command: Option<String>,
    /// The tools git can open here (when asked for), the windowed ones only.
    pub available: Vec<ToolChoice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ToolChoice {
    pub name: String,
    /// Like "Meld" or "Beyond Compare".
    pub label: String,
    /// It can compare files, resolve conflicts, or both.
    pub diff: bool,
    pub merge: bool,
}

/// Where the setting is kept: for every repository, or for one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    Global,
    Local,
}

/// Git, in `path` (or the home folder, when no repository is open).
fn git_in(path: Option<&Path>) -> Result<Git> {
    let folder = path.map(Path::to_owned).unwrap_or_else(|| {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    });
    Ok(Git::find(folder)?.in_background())
}

/// The diff and merge tools set up, and with `list`, the ones git finds here.
pub fn diff_tool_settings(path: Option<&Path>, list: bool) -> Result<DiffToolSettings> {
    let git = git_in(path)?;
    let get = |key: &str| {
        git.run(&["config", "--get", key])
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    };
    let diff = get("diff.tool");
    let merge = get("merge.tool");
    let diff_command = diff
        .as_ref()
        .and_then(|name| get(&format!("difftool.{name}.cmd")));
    let merge_command = merge
        .as_ref()
        .and_then(|name| get(&format!("mergetool.{name}.cmd")));
    let available = if list {
        available_tools(&git)
    } else {
        Vec::new()
    };
    Ok(DiffToolSettings {
        diff,
        merge,
        diff_command,
        merge_command,
        available,
    })
}

/// The windowed tools `git difftool` and `git mergetool` find here, and Visual Studio Code.
fn available_tools(git: &Git) -> Vec<ToolChoice> {
    let diff = git
        .run(&["difftool", "--tool-help"])
        .map(|text| parse_tool_help(&text))
        .unwrap_or_default();
    let merge = git
        .run(&["mergetool", "--tool-help"])
        .map(|text| parse_tool_help(&text))
        .unwrap_or_default();
    let mut tools: Vec<ToolChoice> = vec![ToolChoice {
        name: "vscode".into(),
        label: "Visual Studio Code".into(),
        diff: true,
        merge: true,
    }];
    for (name, label) in diff.iter().chain(merge.iter()) {
        if tools.iter().any(|tool| &tool.name == name) {
            continue;
        }
        tools.push(ToolChoice {
            name: name.clone(),
            label: label.clone(),
            diff: diff.iter().any(|(other, _)| other == name),
            merge: merge.iter().any(|(other, _)| other == name),
        });
    }
    tools
}

/// The tools `--tool-help` says are available (before "valid, but not currently
/// available"), leaving out the ones that need a terminal (Tributary has none to give).
fn parse_tool_help(text: &str) -> Vec<(String, String)> {
    let available = text
        .split("The following tools are valid")
        .next()
        .unwrap_or("");
    available
        .lines()
        .skip(1)
        .filter_map(|line| {
            let line = line.trim();
            let (name, description) = line.split_once(char::is_whitespace)?;
            let description = description.trim();
            if !description.contains("graphical") {
                return None;
            }
            let label = description
                .trim_start_matches("Use ")
                .replace(" (requires a graphical session)", "");
            Some((name.to_owned(), label.trim().to_owned()))
        })
        .collect()
}

/// Open diffs (or, with `merge`, conflicts) in `tool`: a tool git knows, "vscode", or
/// "custom" with `command`. None goes back to git's default.
pub fn set_diff_tool(
    path: Option<&Path>,
    merge: bool,
    tool: Option<String>,
    command: Option<String>,
    scope: Scope,
) -> Result<String> {
    let git = git_in(path)?;
    let scope = match scope {
        Scope::Global => "--global",
        Scope::Local => "--local",
    };
    let (setting, section, what) = if merge {
        ("merge.tool", "mergetool", "Conflicts")
    } else {
        ("diff.tool", "difftool", "Diffs")
    };
    let Some(tool) = tool
        .map(|tool| tool.trim().to_owned())
        .filter(|tool| !tool.is_empty())
    else {
        // Exit code 5: it wasn't set, which is fine.
        if let Err(error) = git.run(&["config", scope, "--unset", setting])
            && git.run(&["config", scope, "--get", setting]).is_ok()
        {
            return Err(error);
        }
        return Ok(format!("{what} open in git's default tool again"));
    };
    if !tool
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("\"{tool}\" isn't a tool git knows.").into());
    }
    let command = match tool.as_str() {
        "vscode" => Some((if merge { VSCODE_MERGE } else { VSCODE_DIFF }).to_owned()),
        "custom" => {
            let command = command
                .map(|c| c.trim().to_owned())
                .filter(|c| !c.is_empty());
            let Some(command) = command else {
                return Err("Enter the command to run.".into());
            };
            if command.contains(['\n', '\r']) {
                return Err("The command has to fit on one line.".into());
            }
            Some(command)
        }
        _ => None,
    };
    if let Some(command) = &command {
        git.run(&["config", scope, &format!("{section}.{tool}.cmd"), command])?;
    }
    git.run(&["config", scope, setting, &tool])?;
    let label = match tool.as_str() {
        "vscode" => "Visual Studio Code".to_owned(),
        "custom" => "your command".to_owned(),
        other => other.to_owned(),
    };
    Ok(format!("{what} open in {label}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_tools_git_finds() {
        let help = "'git difftool --tool=<tool>' may be set to one of the following:\n\
                    \t\tmeld             Use Meld (requires a graphical session)\n\
                    \t\tvimdiff          Use Vim\n\n\
                    The following tools are valid, but not currently available:\n\
                    \t\tbc               Use Beyond Compare (requires a graphical session)\n";
        assert_eq!(
            parse_tool_help(help),
            vec![("meld".to_owned(), "Meld".to_owned())]
        );
    }
}
