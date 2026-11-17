// Your repositories on GitHub and GitLab, and signing in to GitLab (GitHub's sign-in is in
// ./github). Tokens are git's: its credential helper keeps them, never Tributary.
import { invoke } from "./invoke";
import type { AccountRepo, GitLabAccount, GitLabStatus } from "./generated";
export type { AccountRepo, GitLabAccount, GitLabStatus };

/** Your repositories on GitHub, the most recently pushed first (none when you aren't signed in). */
export function gitHubRepositories(): Promise<AccountRepo[]> {
  return invoke("github_repositories");
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
