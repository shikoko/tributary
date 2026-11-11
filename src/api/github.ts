// GitHub: signing in, and open pull requests.
import { invoke } from "@tauri-apps/api/core";

/** A GitHub user. */
export interface GitHubAccount {
  login: string;
  name: string | null;
  /** The account's picture, as a data: URL (when it could be fetched). */
  picture?: string | null;
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
  checks: "success" | "failure" | "pending" | "cancelled" | null;
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
  /** Who owns the files it changes, by the repository's CODEOWNERS (most files first). */
  owners: string[];
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
  /** People (`@user`) and teams (`@org/team`) to ask for a review. */
  reviewers?: string[];
}

/** Open a pull request (GitHub) or merge request (GitLab). */
export function createPullRequest(path: string, request: NewRequest): Promise<PullRequest> {
  return invoke<PullRequest>("create_pull_request", { path, request });
}

/** How a check went. Cancelled: stopped before it finished (replaced by a newer run, say), neither passed nor failed. */
export type CheckState = "success" | "failure" | "pending" | "cancelled";

/** One check (GitHub) or pipeline job (GitLab). */
export interface RequestCheck {
  name: string;
  /** Null when it was skipped, or neither passed nor failed. */
  state: CheckState | null;
  url: string | null;
  detail: string | null;
  /** When it started running (RFC 3339), if it has. */
  startedAt?: string | null;
  /** When it finished, if it has. */
  finishedAt?: string | null;
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
  /** The commits it's between: where the branch it goes into is, and its own branch's last commit. */
  baseSha: string | null;
  headSha: string | null;
  /** It merges by itself once its checks pass. */
  autoMerge: boolean;
}

export function pullRequestDetails(path: string, number: number): Promise<RequestDetails> {
  return invoke<RequestDetails>("pull_request_details", { path, number });
}

/** One comment in a request's conversation. */
export interface RequestComment {
  id: string;
  author: string;
  /** As written (Markdown). */
  body: string;
  /** When (RFC 3339). */
  created: string;
  /** A review's verdict, when the comment is one. */
  review: RequestReview["state"] | null;
  /** The file and line it's on, for a comment on the changes. */
  path: string | null;
  line: number | null;
  /** The lines it's about, from the diff. */
  hunk: string | null;
  /** The thread it's in: replies go to it. Null when it can't be replied to. */
  thread: string | null;
  /** It answers an earlier comment in its thread. */
  reply: boolean;
}

/** How to merge a request: with a merge commit, squashed into one, or rebased (GitHub). */
export type MergeMethod = "merge" | "squash" | "rebase";

/** A request's conversation, and what you can do with it. */
export interface RequestConversation {
  /** Oldest first; replies follow their thread's first comment. */
  comments: RequestComment[];
  /** Who you are on the site, when git has a token for it. */
  you: string | null;
  /** The ways it can be merged there, the site's default first. */
  mergeMethods: MergeMethod[];
  /** Asking for changes is possible (GitHub). */
  canRequestChanges: boolean;
}

export function requestConversation(path: string, number: number): Promise<RequestConversation> {
  return invoke<RequestConversation>("request_conversation", { path, number });
}

/** Comment on a request, or reply in one of its threads. Resolves to what was done. */
export function commentOnRequest(path: string, number: number, body: string, thread: string | null): Promise<string> {
  return invoke<string>("comment_on_request", { path, number, body, thread });
}

export type ReviewVerdict = "approve" | "requestChanges" | "comment";

/** Approve a request, ask for changes, or comment on it as a review. */
export function reviewRequest(path: string, number: number, verdict: ReviewVerdict, body: string): Promise<string> {
  return invoke<string>("review_request", { path, number, verdict, body });
}

export interface MergeRequestOptions {
  method: MergeMethod;
  /** The merge (or squashed) commit's summary and message; the site's own when empty. */
  title: string;
  message: string;
  deleteBranch: boolean;
}

/** Merge a request on its site. */
export function mergeRequest(path: string, number: number, options: MergeRequestOptions): Promise<string> {
  return invoke<string>("merge_request", { path, number, options });
}

/** The CI state of each of `ids` (full commit ids) that has one, on GitHub or GitLab. */
export function commitStates(path: string, ids: string[]): Promise<Record<string, CheckState>> {
  return invoke<Record<string, CheckState>>("commit_states", { path, ids });
}

/** A commit's checks (GitHub) or latest pipeline's jobs (GitLab). */
export interface CommitChecks {
  checks: RequestCheck[];
  /** Failed ones can be run again from here. */
  canRerun: boolean;
  /** "GitHub" or "GitLab". */
  site: string;
}

export function commitChecks(path: string, id: string): Promise<CommitChecks> {
  return invoke<CommitChecks>("commit_checks", { path, id });
}

/** Run a commit's failed checks again; says what was done. */
export function rerunFailedChecks(path: string, id: string): Promise<string> {
  return invoke<string>("rerun_failed_checks", { path, id });
}

/** A change to an open request from its view. */
export type RequestChange =
  | { kind: "draft"; draft: boolean }
  | { kind: "reviewers"; reviewers: string[] }
  | { kind: "autoMerge"; on: boolean; method?: string };

/** Change request `number`: ready or a draft, more reviewers, or auto-merge; says what was done. */
export function changeRequest(path: string, number: number, change: RequestChange): Promise<string> {
  return invoke<string>("change_request", { path, number, change });
}
