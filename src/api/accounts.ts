// Your repositories on GitHub and GitLab, and signing in to GitLab (GitHub's sign-in is in
// ./github). Tokens are git's: its credential helper keeps them, never Tributary.
import { invoke } from "./invoke";
import type { AccountRepo, Fork, ForkCommit, ForkParent, Forks, ForkStatus, ForkSync, GitLabAccount, GitLabStatus, SyncOutcome } from "./generated";
export type { AccountRepo, Fork, ForkCommit, ForkParent, Forks, ForkStatus, ForkSync, GitLabAccount, GitLabStatus, SyncOutcome };

/** Your repositories on GitHub, the most recently pushed first (none when you aren't signed in). */
export function gitHubRepositories(): Promise<AccountRepo[]> {
  return invoke("github_repositories");
}

/** Your forks on GitHub, by name (none when you aren't signed in). */
export function gitHubForks(): Promise<Forks> {
  return invoke("github_forks");
}

/** How a fork's branch compares with its original's: the original's new commits, and its own. */
export function forkStatus(fork: Fork): Promise<ForkStatus> {
  return invoke("github_fork_status", { fork });
}

/** Sync a fork's branch with its original on GitHub, as its Sync fork button does. */
export function syncFork(fork: Fork): Promise<ForkSync> {
  return invoke("github_sync_fork", { fork });
}

export function gitLabStatus(host: string): Promise<GitLabStatus> {
  return invoke("gitlab_status", { host });
}

export function signInToGitLab(host: string, token: string): Promise<GitLabAccount> {
  return invoke("gitlab_sign_in", { host, token });
}

export function signInToGitLabWithBrowser(host: string): Promise<GitLabAccount> {
  return invoke("gitlab_sign_in_with_browser", { host });
}

export function signOutOfGitLab(host: string): Promise<void> {
  return invoke("gitlab_sign_out", { host });
}

/** Your projects on a GitLab server, the most recently active first (none when you aren't signed in). */
export function gitLabRepositories(host: string): Promise<AccountRepo[]> {
  return invoke("gitlab_repositories", { host });
}
