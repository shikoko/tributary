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

/** A commit's message: its first line, and the rest. */
export interface CommitMessage {
  summary: string;
  body: string;
}

/** What opening a pull request for a branch starts from. */
export interface NewRequestInfo {
  forge: "github" | "gitlab";
  /** The remote on the site, like "origin". */
  remote: string;
  /** The remote's branches, to merge into. */
  bases: string[];
  /** The one to suggest: the remote's default branch. */
  base: string | null;
  /** Git keeps a token for the site. */
  signedIn: boolean;
  /** The branch is on the remote already. */
  onRemote: boolean;
  /** Commits of the local branch not pushed yet. */
  unpushed: number;
  /** The commits it would bring into the suggested base, oldest first. */
  commits: CommitMessage[];
}

/** `branch`: its name on the remote; `local`: the local branch, if there is one. */
export function newRequestInfo(path: string, branch: string, local: string | null): Promise<NewRequestInfo> {
  return invoke<NewRequestInfo>("new_request_info", { path, branch, local });
}

export interface NewRequest {
  branch: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
}

/** Open a pull request (GitHub) or merge request (GitLab). */
export function createPullRequest(path: string, request: NewRequest): Promise<PullRequest> {
  return invoke<PullRequest>("create_pull_request", { path, request });
}

export type CheckState = "success" | "failure" | "pending";

/** One check (GitHub) or pipeline job (GitLab). */
export interface RequestCheck {
  name: string;
  /** Null when it was skipped, or neither passed nor failed. */
  state: CheckState | null;
  url: string | null;
  detail: string | null;
}

export interface RequestReview {
  author: string;
  state: "approved" | "changesRequested" | "commented" | "requested";
}

/** A pull (or merge) request in full. */
export interface RequestDetails {
  number: number;
  title: string;
  url: string;
  /** Its description (Markdown). */
  body: string;
  author: string;
  state: "open" | "draft" | "merged" | "closed";
  base: string;
  branch: string;
  /** When it was opened (RFC 3339). */
  created: string;
  additions: number | null;
  deletions: number | null;
  files: number | null;
  comments: number;
  /** Whether it can be merged now; null when closed, merged or a draft. */
  mergeable: "ready" | "conflicts" | "behind" | "blocked" | "checking" | null;
  reviews: RequestReview[];
  checks: RequestCheck[];
  forge: "github" | "gitlab";
}

export function pullRequestDetails(path: string, number: number): Promise<RequestDetails> {
  return invoke<RequestDetails>("pull_request_details", { path, number });
}
