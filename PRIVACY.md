# Privacy

Tributary has no analytics, no crash reporting and no account of its own. It doesn't send anything to the project or its maintainer. It only talks to the services below, for the reasons given.

## What it connects to

| What | Where it goes | When | What's sent |
| --- | --- | --- | --- |
| **Your repositories** | Your remotes (GitHub, GitLab, your own server…), through your own `git` and Git LFS | When you fetch, pull, push or clone, and every few minutes in the background if **Fetch in the background** is on (Settings → Fetching) | What git itself sends, with the sign-in git already uses |
| **Update checks** | `github.com`, the project's releases page | Shortly after start-up and every six hours if **Check for updates automatically** is on (Help → About Tributary), and when you open About Tributary or choose **Check again** there | An ordinary web request for the latest release's `latest.json`, and, when there's a newer version, its installer (installed when you restart Tributary for it, or quit). No sign-in. |
| **Pull requests and CI** | GitHub's or GitLab's API, for repositories hosted there | When a repository on GitHub or GitLab is open, to show pull requests, reviews and checks | The repository's name and branch names, with the token git keeps for that site, if it has one |
| **Issues** | GitHub, GitLab, Jira or Linear | Only for the tracker you set up for a repository | The issue keys mentioned in commit messages and branch names, with the key you signed in with |
| **Profile pictures** | GitHub, your GitLab server and Gravatar | Only if you turn on **Profile pictures**, which are off at first | For GitHub, the repository's name, to match its recent commits' authors to accounts; for GitLab, authors' email addresses; for Gravatar, a SHA-256 hash of each address, never the address itself |
| **GitHub sign-in** | `api.github.com` | When you sign in to GitHub, and when the start screen, Settings or the clone dialog shows who's signed in | The token git keeps for GitHub (or the one you enter), to check whose it is |
| **GitLab sign-in** | The GitLab server you sign in to (gitlab.com, or your company's) | When you sign in to GitLab, and when the start screen, Settings or the clone dialog shows who's signed in | The token git keeps for that server (or the one you enter), to check whose it is |
| **Your account's picture** | GitHub's picture server, or your GitLab server (which may send it on from Gravatar) | When the start screen, Settings or the clone dialog shows who's signed in | Only the request for the picture of the account you're signed in as; it's fetched once per session |
| **Your repositories to clone** | `api.github.com`, and your GitLab server | When the clone dialog opens while you're signed in | The token git keeps for each, to list your repositories |

Links such as **Open on GitHub** open your web browser; Tributary doesn't fetch the page itself.

## What it keeps on your computer

- **Settings**, in the app's own storage. **Settings → Export and import** exports them to a file you choose.
- **The activity log** of the git commands it ran, with their output, only in memory while the app runs. Passwords and tokens in addresses are left out.
- **Profile pictures**, if turned on, for a week, named by a hash of each address.
- **Local history:** snapshots of your uncommitted work, inside the repository (under `refs/tributary/snapshots/`), for as long as Settings → Local history says. They're never pushed.
- **Backups** of branches Tributary deletes or rewrites, inside the repository, for 30 days.

Tributary doesn't store passwords, tokens or keys itself. Those are kept by git's credential helper (like Git Credential Manager or the macOS Keychain), where git and other tools can use them too.

## What it shares with your team

Only what you choose to send: commits you push, and **shelves**, which are pushed to the remote under `refs/tributary/shelves/` so that anyone who can read the repository can open them. Deleting a shelf deletes it from the remote too.

## Diagnostics

**Help → Copy Diagnostics…** shows everything it would copy before copying it, and it's only sent where you paste it. It includes the open repository's folder and remote addresses; passwords and tokens are left out.

## Questions

If anything here is unclear, or Tributary seems to connect somewhere not listed, please [open an issue](https://github.com/shikoko/tributary/issues), or for anything sensitive, report it privately as [SECURITY.md](SECURITY.md) describes.
