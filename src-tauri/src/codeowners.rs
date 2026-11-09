//! Who owns which files, as the repository's `CODEOWNERS` says (in `.github/`, at the top,
//! in `docs/`, or for GitLab in `.gitlab/`): to suggest who reviews a pull request, and to
//! show a file's owners.
//!
//! Each line is a pattern, like .gitignore's, then owners: `@user`, `@org/team` or an email
//! address. The last line that matches a file wins. GitLab splits the file into sections
//! (`[Art]`, `^[Optional docs] @lead`), each with its own last match, whose owners add up;
//! a section's owners stand in for lines that name none.

use std::collections::BTreeSet;
use std::path::Path;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::Serialize;

/// Where the file can be, first found first used (as GitHub and GitLab look).
const PLACES: [&str; 4] = [
    ".github/CODEOWNERS",
    "CODEOWNERS",
    "docs/CODEOWNERS",
    ".gitlab/CODEOWNERS",
];

/// A file and who owns it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileOwners {
    pub path: String,
    pub owners: Vec<String>,
}

struct Rule {
    matcher: Gitignore,
    /// Only the folder's own files (like `docs/*`), not those in folders inside it.
    shallow: bool,
    owners: Vec<String>,
}

struct Section {
    rules: Vec<Rule>,
}

/// A repository's code owners.
pub struct CodeOwners {
    sections: Vec<Section>,
}

/// A line's words, with `\ ` and `\#` kept as they are and a `#` after a space ending it.
fn words(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars
                .peek()
                .is_some_and(|next| *next == ' ' || *next == '#') =>
            {
                word.push(c);
                word.push(chars.next().unwrap_or(' '));
            }
            '#' if word.is_empty() => break,
            c if c.is_whitespace() => {
                if !word.is_empty() {
                    words.push(std::mem::take(&mut word));
                }
            }
            c => word.push(c),
        }
    }
    if !word.is_empty() {
        words.push(word);
    }
    words
}

/// `@user`, `@org/team` or an email address.
fn is_owner(word: &str) -> bool {
    word.starts_with('@') || (word.contains('@') && !word.contains('/'))
}

impl CodeOwners {
    pub fn parse(text: &str) -> CodeOwners {
        let mut sections = vec![Section { rules: Vec::new() }];
        let mut defaults: Vec<String> = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // A GitLab section: "[Name]", "^[Name][2]", maybe with default owners after it.
            let header = line.strip_prefix('^').unwrap_or(line);
            if header.starts_with('[')
                && let Some(end) = header.find(']')
            {
                let after = header[end + 1..].trim_start();
                // "[2]": how many approvals it needs.
                let after = match after.strip_prefix('[') {
                    Some(rest) => rest.split_once(']').map_or("", |(_, more)| more),
                    None => after,
                };
                defaults = words(after).into_iter().filter(|w| is_owner(w)).collect();
                sections.push(Section { rules: Vec::new() });
                continue;
            }
            let mut parts = words(line).into_iter();
            let Some(pattern) = parts.next() else {
                continue;
            };
            let owners: Vec<String> = parts.filter(|word| is_owner(word)).collect();
            let owners = if owners.is_empty() {
                defaults.clone()
            } else {
                owners
            };
            // Negation isn't part of CODEOWNERS.
            if pattern.starts_with('!') {
                continue;
            }
            let mut builder = GitignoreBuilder::new("");
            if builder.add_line(None, &pattern).is_err() {
                continue;
            }
            let Ok(matcher) = builder.build() else {
                continue;
            };
            let shallow = pattern.ends_with("/*") && !pattern.ends_with("**/*");
            if let Some(section) = sections.last_mut() {
                section.rules.push(Rule {
                    matcher,
                    shallow,
                    owners,
                });
            }
        }
        CodeOwners { sections }
    }

    /// The repository's code owners, from its first `CODEOWNERS` file, if it has one.
    pub fn of(workdir: &Path) -> Option<CodeOwners> {
        PLACES
            .iter()
            .find_map(|place| std::fs::read_to_string(workdir.join(place)).ok())
            .map(|text| CodeOwners::parse(&text))
    }

    /// Who owns `path` (relative to the repository's top).
    pub fn owners(&self, path: &str) -> Vec<String> {
        let mut owners: Vec<String> = Vec::new();
        for section in &self.sections {
            let found = section.rules.iter().rev().find(|rule| {
                let matched = if rule.shallow {
                    rule.matcher.matched(path, false)
                } else {
                    rule.matcher.matched_path_or_any_parents(path, false)
                };
                matched.is_ignore()
            });
            for owner in found.map(|rule| rule.owners.as_slice()).unwrap_or_default() {
                if !owners.contains(owner) {
                    owners.push(owner.clone());
                }
            }
        }
        owners
    }
}

/// The owners of each of `files`, in a repository's working tree (empty when it has no
/// `CODEOWNERS`).
pub fn owners_of(workdir: &Path, files: &[String]) -> Vec<FileOwners> {
    let Some(code_owners) = CodeOwners::of(workdir) else {
        return Vec::new();
    };
    files
        .iter()
        .map(|path| FileOwners {
            path: path.clone(),
            owners: code_owners.owners(path),
        })
        .collect()
}

/// Everyone who owns any of `files`, most files first.
pub fn owners_of_all(workdir: &Path, files: &[&str]) -> Vec<String> {
    let Some(code_owners) = CodeOwners::of(workdir) else {
        return Vec::new();
    };
    let mut counts: Vec<(String, usize)> = Vec::new();
    for file in files {
        for owner in code_owners.owners(file) {
            match counts.iter_mut().find(|(known, _)| *known == owner) {
                Some((_, n)) => *n += 1,
                None => counts.push((owner, 1)),
            }
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let mut seen = BTreeSet::new();
    counts
        .into_iter()
        .map(|(owner, _)| owner)
        .filter(|owner| seen.insert(owner.to_lowercase()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = "\
# Everything, unless a later line says otherwise
*                       @studio/leads
*.png *.psd             @studio/art
/Content/Maps/          @maya  rosa@example.com   # level design
docs/*                  @lena
Source/**/Audio/        @theo
/build/logs/            # nobody
";

    #[test]
    fn the_last_matching_line_wins() {
        let owners = CodeOwners::parse(FILE);
        assert_eq!(owners.owners("README.md"), vec!["@studio/leads"]);
        assert_eq!(owners.owners("Content/Hero.png"), vec!["@studio/art"]);
        assert_eq!(
            owners.owners("Content/Maps/Arena.umap"),
            vec!["@maya", "rosa@example.com"]
        );
        assert_eq!(owners.owners("docs/setup.md"), vec!["@lena"]);
        // docs/* is only the folder's own files.
        assert_eq!(owners.owners("docs/art/colours.md"), vec!["@studio/leads"]);
        assert_eq!(owners.owners("Source/Game/Audio/Mixer.cpp"), vec!["@theo"]);
        assert!(owners.owners("build/logs/today.txt").is_empty());
    }

    #[test]
    fn gitlab_sections_add_up() {
        let owners = CodeOwners::parse(
            "* @leads\n\n[Art] @studio/art\n*.png\n\n^[Docs][2] @lena\ndocs/ @diego\n",
        );
        assert_eq!(
            owners.owners("Content/Hero.png"),
            vec!["@leads", "@studio/art"]
        );
        assert_eq!(owners.owners("docs/a.md"), vec!["@leads", "@diego"]);
    }

    #[test]
    fn reads_escaped_spaces_and_comments() {
        assert_eq!(
            words(r"My\ Folder/ @maya # who"),
            vec![r"My\ Folder/", "@maya"]
        );
        assert_eq!(words(r"\#notes @maya"), vec![r"\#notes", "@maya"]);
    }
}
