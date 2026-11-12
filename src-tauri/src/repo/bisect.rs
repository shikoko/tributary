//! A bisect under way: the commits marked good and bad, the one being tested, and the
//! first bad commit once it's found.

use std::path::Path;

use gix::bstr::ByteSlice;
use serde::Serialize;
use ts_rs::TS;

use crate::git::Git;

/// A bisect under way: the commits marked good and bad, and the first bad one once found.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Bisect {
    /// Where it started (a branch, or a commit), to go back to.
    pub start: Option<String>,
    pub bad: Option<String>,
    pub good: Vec<String>,
    pub skipped: Vec<String>,
    /// Commits that could still be the first bad one.
    pub left: Option<u32>,
    /// About how many more commits to test.
    pub steps: Option<u32>,
    /// The first bad commit, once it's found.
    pub found: Option<String>,
}

/// The bisect under way in the repository, if there is one.
pub(crate) fn bisect(repo: &gix::Repository, folder: &Path) -> Option<Bisect> {
    let start = std::fs::read_to_string(repo.git_dir().join("BISECT_START")).ok()?;
    let mut found = Bisect {
        start: Some(start.trim().to_owned()).filter(|start| !start.is_empty()),
        ..Bisect::default()
    };
    if let Ok(references) = repo.references()
        && let Ok(iter) = references.prefixed("refs/bisect/")
    {
        for mut reference in iter.filter_map(Result::ok) {
            let name = reference.name().as_bstr().to_str_lossy().into_owned();
            let Ok(id) = reference.peel_to_id() else {
                continue;
            };
            let id = id.to_string();
            match name.strip_prefix("refs/bisect/") {
                Some("bad") => found.bad = Some(id),
                Some(rest) if rest.starts_with("good-") => found.good.push(id),
                Some(rest) if rest.starts_with("skip-") => found.skipped.push(id),
                _ => {}
            }
        }
    }
    if let Some(bad) = &found.bad
        && !found.good.is_empty()
        && let Ok(git) = Git::find(folder.to_owned())
    {
        let mut args = vec!["rev-list", "--bisect-vars", bad.as_str(), "--not"];
        args.extend(found.good.iter().map(String::as_str));
        if let Ok(vars) = git.in_background().run(&args) {
            let (left, steps) = read_vars(&vars);
            found.left = left;
            found.steps = steps;
            // Only the bad commit is left: it's the first bad one.
            if left == Some(1) {
                found.found = Some(bad.clone());
            }
        }
    }
    Some(found)
}

/// `bisect_all` (the commits left, the bad one included) and `bisect_steps` from
/// `git rev-list --bisect-vars`.
fn read_vars(vars: &str) -> (Option<u32>, Option<u32>) {
    let value = |name: &str| {
        vars.lines()
            .find_map(|line| line.strip_prefix(name)?.strip_prefix('='))
            .and_then(|value| value.trim().trim_matches('\'').parse().ok())
    };
    (value("bisect_all"), value("bisect_steps"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_bisect_vars() {
        let vars = "bisect_rev='abc'\nbisect_nr=2\nbisect_good=3\nbisect_bad=2\nbisect_all=6\nbisect_steps=2\n";
        assert_eq!(read_vars(vars), (Some(6), Some(2)));
        assert_eq!(read_vars(""), (None, None));
    }
}
