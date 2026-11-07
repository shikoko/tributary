//! Web pages for remotes: turning a remote's address, like `git@github.com:owner/repo.git`,
//! into the repository's page on the web, like `https://github.com/owner/repo`.

use serde::Serialize;

/// The kind of site a remote lives on, which decides how its pages are laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Host {
    GitHub,
    GitLab,
    Bitbucket,
    /// Gitea, Forgejo and Codeberg.
    Gitea,
    /// Anything else: only the repository's own page is known.
    Other,
}

/// A remote whose repository has a web page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebRemote {
    /// The remote's name, like `origin`.
    pub name: String,
    pub host: Host,
    /// The repository's page, like `https://github.com/owner/repo`.
    pub url: String,
}

/// The web page for a remote address, or `None` for local paths and addresses that
/// can't be read. Credentials in the address are never kept.
pub fn web_url(remote_url: &str) -> Option<(Host, String)> {
    let url = remote_url.trim();
    let scp_like;
    let (scheme, rest) = match url.split_once("://") {
        Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
        None => {
            // scp-like syntax: [user@]host:path, as long as the part before the colon
            // has no slash (otherwise it's a local path like ./a:b or C:\repo).
            let (host, path) = url.split_once(':')?;
            if host.contains('/') || host.contains('\\') || host.len() <= 1 {
                return None;
            }
            scp_like = format!("{host}/{path}");
            ("ssh".to_owned(), scp_like.as_str())
        }
    };
    let web_scheme = match scheme.as_str() {
        "https" | "ssh" | "git" | "git+ssh" | "ssh+git" => "https",
        "http" => "http",
        _ => return None,
    };
    let (authority, path) = rest.split_once('/')?;
    // Drop any user name or password.
    let authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    // SSH ports aren't web ports; HTTP(S) ports are kept.
    let authority = if web_scheme == "https" && scheme != "https" {
        authority
            .split_once(':')
            .map_or(authority, |(host, _)| host)
    } else {
        authority
    };
    let host_name = authority
        .split_once(':')
        .map_or(authority, |(host, _)| host)
        .to_ascii_lowercase();
    if host_name.is_empty() {
        return None;
    }
    let path = path.trim_matches('/');
    let path = path
        .strip_suffix(".git")
        .unwrap_or(path)
        .trim_end_matches('/');
    // Old-style GitLab and Bitbucket SSH addresses put the path after a leading `~` or `scm/`.
    let path = path.strip_prefix("scm/").unwrap_or(path);
    if path.is_empty() || path.contains(char::is_whitespace) {
        return None;
    }

    let host = if host_name == "github.com" || host_name.starts_with("github.") {
        Host::GitHub
    } else if host_name == "gitlab.com" || host_name.starts_with("gitlab.") {
        Host::GitLab
    } else if host_name == "bitbucket.org" {
        Host::Bitbucket
    } else if host_name == "codeberg.org"
        || host_name.starts_with("gitea.")
        || host_name.starts_with("forgejo.")
    {
        Host::Gitea
    } else {
        Host::Other
    };
    Some((host, format!("{web_scheme}://{authority}/{path}")))
}

/// The address of a pull request page that git printed after a push, like GitHub's
/// "Create a pull request for 'feature' on GitHub by visiting: https://…".
pub fn pull_request_url(push_output: &str) -> Option<String> {
    push_output.lines().find_map(|line| {
        let text = line.trim().strip_prefix("remote:")?.trim();
        let looks_like_one = text.starts_with("https://") || text.starts_with("http://");
        let is_new_request = [
            "/pull/new/",
            "merge_requests/new",
            "pull-requests/new",
            "/compare/",
        ]
        .iter()
        .any(|part| text.contains(part));
        (looks_like_one && is_new_request && !text.contains(char::is_whitespace))
            .then(|| text.to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn web(url: &str) -> Option<(Host, String)> {
        web_url(url)
    }

    #[test]
    fn reads_common_remote_addresses() {
        let github = Some((Host::GitHub, "https://github.com/owner/repo".to_owned()));
        assert_eq!(web("git@github.com:owner/repo.git"), github);
        assert_eq!(web("https://github.com/owner/repo.git"), github);
        assert_eq!(web("https://github.com/owner/repo"), github);
        assert_eq!(
            web("https://user:secret@github.com/owner/repo.git/"),
            github
        );
        assert_eq!(web("ssh://git@github.com:22/owner/repo.git"), github);
        assert_eq!(web("git://github.com/owner/repo.git"), github);
        assert_eq!(
            web("git@gitlab.com:group/sub/project.git"),
            Some((Host::GitLab, "https://gitlab.com/group/sub/project".into()))
        );
        assert_eq!(
            web("git@bitbucket.org:team/repo.git"),
            Some((Host::Bitbucket, "https://bitbucket.org/team/repo".into()))
        );
        assert_eq!(
            web("https://codeberg.org/someone/thing.git"),
            Some((Host::Gitea, "https://codeberg.org/someone/thing".into()))
        );
        assert_eq!(
            web("http://git.example.com:8080/repos/thing"),
            Some((
                Host::Other,
                "http://git.example.com:8080/repos/thing".into()
            ))
        );
        assert_eq!(
            web("git@github.mycompany.com:team/app.git"),
            Some((Host::GitHub, "https://github.mycompany.com/team/app".into()))
        );
    }

    #[test]
    fn ignores_local_paths() {
        assert_eq!(web("/home/me/repos/thing.git"), None);
        assert_eq!(web("../thing"), None);
        assert_eq!(web("C:\\repos\\thing"), None);
        assert_eq!(web("C:/repos/thing"), None);
        assert_eq!(web("file:///home/me/thing.git"), None);
        assert_eq!(web(""), None);
    }

    #[test]
    fn finds_pull_request_links_in_push_output() {
        let github = "remote: \nremote: Create a pull request for 'feature' on GitHub by visiting:\n\
                      remote:      https://github.com/owner/repo/pull/new/feature\nremote: \n\
                      To github.com:owner/repo.git\n * [new branch]      feature -> feature";
        assert_eq!(
            pull_request_url(github).as_deref(),
            Some("https://github.com/owner/repo/pull/new/feature")
        );
        let gitlab = "remote: To create a merge request for feature, visit:\nremote:   \
                      https://gitlab.com/group/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature";
        assert!(
            pull_request_url(gitlab)
                .unwrap()
                .contains("merge_requests/new")
        );
        assert_eq!(
            pull_request_url("To /tmp/remote.git\n   abc..def  main -> main"),
            None
        );
    }
}
