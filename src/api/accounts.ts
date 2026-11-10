// Your repositories on GitHub and GitLab, and signing in to GitLab (GitHub's sign-in is in
// ./github). Tokens are git's: its credential helper keeps them, never Tributary.
import { invoke } from "@tauri-apps/api/core";

/** One of your repositories, on GitHub or GitLab. */
export interface AccountRepo {
  forge: "GitHub" | "GitLab";
  /** The user or organization (a GitLab group, with its subgroups) it belongs to. */
  owner: string;
  name: string;
  description: string | null;
  private: boolean;
  /** When it last changed (ISO 8601). */
  updated: string;
  /** The address to clone it from. */
  url: string;
}

export interface GitLabAccount {
  username: string;
  name?: string | null;
}

/** Who's signed in to a GitLab server, and how one can sign in. */
export interface GitLabStatus {
  /** Like "gitlab.com". */
  host: string;
  account: GitLabAccount | null;
  /** Git keeps a token that the server no longer accepts. */
  tokenRejected: boolean;
  /** Git can keep a token: it has a credential helper. */
  canKeepToken: boolean;
  /** Git Credential Manager is set up, so signing in can happen in the browser. */
  browserSignIn: boolean;
}

/** Your repositories on GitHub, the most recently pushed first (none when you aren't signed in). */
export function gitHubRepositories(): Promise<AccountRepo[]> {
  return invoke<AccountRepo[]>("github_repositories");
}

export function gitLabStatus(host: string): Promise<GitLabStatus> {
  return invoke<GitLabStatus>("gitlab_status", { host });
}

export function signInToGitLab(host: string, token: string): Promise<GitLabAccount> {
  return invoke<GitLabAccount>("gitlab_sign_in", { host, token });
}

export function signInToGitLabWithBrowser(host: string): Promise<GitLabAccount> {
  return invoke<GitLabAccount>("gitlab_sign_in_with_browser", { host });
}

export function signOutOfGitLab(host: string): Promise<void> {
  return invoke<void>("gitlab_sign_out", { host });
}

/** Your projects on a GitLab server, the most recently active first (none when you aren't signed in). */
export function gitLabRepositories(host: string): Promise<AccountRepo[]> {
  return invoke<AccountRepo[]>("gitlab_repositories", { host });
}
