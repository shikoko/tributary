//! Why a file is ignored: the `.gitignore` (or `.git/info/exclude`, or the global excludes
//! file) rule that leaves it out, so a file that never shows up in the changes can be
//! explained, and staged anyway when it's wanted.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::support::{LITERAL, count};
use super::validate::check_paths;
use crate::error::{Error, Result};
use crate::git::Git;

/// Why a file is ignored, if it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreReason {
    /// The file, relative to the repository's top.
    pub path: String,
    /// It's tracked: ignore rules don't apply to files already committed.
    pub tracked: bool,
    /// The rule that ignores it, if one does.
    pub rule: Option<IgnoreRule>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreRule {
    /// The file it's in, like ".gitignore" or "Content/.gitignore" (relative to the
    /// repository's top when it's inside it).
    pub source: String,
    pub line: u32,
    pub pattern: String,
}

/// `git check-ignore -v` output: "<source>:<line>:<pattern>\t<path>".
fn rule_from(output: &str) -> Option<IgnoreRule> {
    let (rule, _) = output.lines().next()?.split_once('\t')?;
    // The source may have colons of its own (C:\...): the line and pattern are the last two.
    let (rest, pattern) = rule.rsplit_once(':')?;
    let (source, line) = rest.rsplit_once(':')?;
    Some(IgnoreRule {
        source: source.to_owned(),
        line: line.parse().ok()?,
        pattern: pattern.to_owned(),
    })
}

/// Why `file` (absolute, or relative to the repository's top) is ignored, if it is.
pub fn ignore_reason(path: &Path, file: &str) -> Result<IgnoreReason> {
    let repo = gix::discover(path).map_err(|e| Error::not_a_repository(path, e))?;
    let workdir = repo
        .workdir()
        .ok_or("This repository has no working tree.")?
        .to_owned();
    let git = Git::find(workdir.clone())?.in_background();
    let relative = Path::new(file)
        .strip_prefix(&workdir)
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| file.replace('\\', "/"));
    if relative.is_empty() || relative.starts_with("..") || Path::new(&relative).is_absolute() {
        return Err(format!("{file} isn't in this repository.").into());
    }
    let tracked = git
        .run_with_env(&["ls-files", "--error-unmatch", "--", &relative], &LITERAL)
        .is_ok();
    // --no-index: the rule that matches even for a tracked file.
    let (code, output) = git.run_status(&["check-ignore", "-v", "--no-index", "--", &relative])?;
    let rule = if code == Some(0) {
        rule_from(&output)
    } else {
        None
    };
    Ok(IgnoreReason {
        path: relative,
        tracked,
        rule,
    })
}

/// Stage ignored files anyway (`git add --force`): once committed, ignore rules don't apply.
pub(super) fn stage_ignored(git: &Git, paths: Vec<String>) -> Result<String> {
    let paths = check_paths(&paths)?;
    let mut args = vec!["add", "--force", "--"];
    args.extend(paths.iter().copied());
    git.run_with_env(&args, &LITERAL)?;
    Ok(format!(
        "Staged {}, ignored or not",
        count(paths.len(), "file")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_rule() {
        assert_eq!(
            rule_from(".gitignore:3:Saved/\tSaved/Logs/editor.log\n"),
            Some(IgnoreRule {
                source: ".gitignore".into(),
                line: 3,
                pattern: "Saved/".into()
            })
        );
        assert_eq!(
            rule_from("C:/Users/maya/.config/git/ignore:1:*.log\tlog.log").map(|r| r.source),
            Some("C:/Users/maya/.config/git/ignore".into())
        );
        assert_eq!(rule_from(""), None);
    }
}
