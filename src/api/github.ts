// GitHub: signing in, and open pull requests.
import { invoke } from "@tauri-apps/api/core";

/** A GitHub user. */
export interface GitHubAccount {
  login: string;
  name: string | null;
}

/** Who's signed in to GitHub, going by the token git keeps, and how one can sign in. */
export interface GitHubStatus {
  account: GitHubAccount | null;
  /** Git keeps a token that GitHub no longer accepts. */
  tokenRejected: boolean;
  /** Git has a credential helper to keep a token in. */
  canKeepToken: boolean;
  /** Git Credential Manager can sign in in the browser. */
  browserSignIn: boolean;
}

export function gitHubStatus(): Promise<GitHubStatus> {
  return invoke<GitHubStatus>("github_status");
}

export function signInToGitHub(token: string): Promise<GitHubAccount> {
  return invoke<GitHubAccount>("github_sign_in", { token });
}

export function signInToGitHubWithBrowser(): Promise<GitHubAccount> {
  return invoke<GitHubAccount>("github_sign_in_with_browser");
}

export function signOutOfGitHub(): Promise<void> {
  return invoke<void>("github_sign_out");
}

/** An open pull request on GitHub, or merge request on GitLab. */
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  /** Like "origin". */
  remote: string;
  /** Its branch on that remote, like "feat/menu". */
  branch: string;
  draft: boolean;
  author: string;
  /** Checks (GitHub) or the latest pipeline (GitLab). */
  checks: "success" | "failure" | "pending" | null;
  /** Where it is. Merge requests are numbered like !12. */
  forge?: "github" | "gitlab";
}

export function pullRequests(path: string): Promise<PullRequest[]> {
  return invoke<PullRequest[]>("pull_requests", { path });
}
