// GitHub: signing in, and open pull requests.
import { invoke } from "@tauri-apps/api/core";
import type { CheckState, CommitChecks, CommitMessage, GitHubAccount, GitHubStatus, MergeMethod, MergeRequestOptions, NewRequest, NewRequestInfo, PullRequest, RequestChange, RequestCheck, RequestComment, RequestConversation, RequestDetails, RequestReview, ReviewVerdict } from "./generated";
export type { CheckState, CommitChecks, CommitMessage, GitHubAccount, GitHubStatus, MergeMethod, MergeRequestOptions, NewRequest, NewRequestInfo, PullRequest, RequestChange, RequestCheck, RequestComment, RequestConversation, RequestDetails, RequestReview, ReviewVerdict };

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

export function pullRequests(path: string): Promise<PullRequest[]> {
  return invoke<PullRequest[]>("pull_requests", { path });
}

/** `branch`: its name on the remote; `local`: the local branch, if there is one. */
export function newRequestInfo(path: string, branch: string, local: string | null): Promise<NewRequestInfo> {
  return invoke<NewRequestInfo>("new_request_info", { path, branch, local });
}

/** Open a pull request (GitHub) or merge request (GitLab). */
export function createPullRequest(path: string, request: NewRequest): Promise<PullRequest> {
  return invoke<PullRequest>("create_pull_request", { path, request });
}

export function pullRequestDetails(path: string, number: number): Promise<RequestDetails> {
  return invoke<RequestDetails>("pull_request_details", { path, number });
}

export function requestConversation(path: string, number: number): Promise<RequestConversation> {
  return invoke<RequestConversation>("request_conversation", { path, number });
}

/** Comment on a request, or reply in one of its threads. Resolves to what was done. */
export function commentOnRequest(path: string, number: number, body: string, thread: string | null): Promise<string> {
  return invoke<string>("comment_on_request", { path, number, body, thread });
}

/** Approve a request, ask for changes, or comment on it as a review. */
export function reviewRequest(path: string, number: number, verdict: ReviewVerdict, body: string): Promise<string> {
  return invoke<string>("review_request", { path, number, verdict, body });
}

/** Merge a request on its site. */
export function mergeRequest(path: string, number: number, options: MergeRequestOptions): Promise<string> {
  return invoke<string>("merge_request", { path, number, options });
}

/** The CI state of each of `ids` (full commit ids) that has one, on GitHub or GitLab. */
export function commitStates(path: string, ids: string[]): Promise<Record<string, CheckState>> {
  return invoke<Record<string, CheckState>>("commit_states", { path, ids });
}

export function commitChecks(path: string, id: string): Promise<CommitChecks> {
  return invoke<CommitChecks>("commit_checks", { path, id });
}

/** Run a commit's failed checks again; says what was done. */
export function rerunFailedChecks(path: string, id: string): Promise<string> {
  return invoke<string>("rerun_failed_checks", { path, id });
}

/** Change request `number`: ready or a draft, more reviewers, or auto-merge; says what was done. */
export function changeRequest(path: string, number: number, change: RequestChange): Promise<string> {
  return invoke<string>("change_request", { path, number, change });
}
