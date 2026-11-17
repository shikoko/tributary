// Issue trackers: GitHub or GitLab issues, Jira or Linear.
import { invoke } from "./invoke";
import type { Issue, Tracker, TrackerKind, TrackerStatus } from "./generated";
export type { Issue, Tracker, TrackerKind, TrackerStatus };

/** The issues `keys` mentions, the ones that can be found. */
export function issues(path: string, tracker: Tracker, keys: string[]): Promise<Issue[]> {
  return invoke("issues", { path, tracker, keys });
}

/** The open issues assigned to you, most recently updated first. */
export function myIssues(path: string, tracker: Tracker): Promise<Issue[]> {
  return invoke("my_issues", { path, tracker });
}

export function trackerStatus(path: string, tracker: Tracker): Promise<TrackerStatus> {
  return invoke("tracker_status", { path, tracker });
}

/** Sign in to Jira (email and API token, or a personal access token) or Linear (API key). */
export function trackerSignIn(tracker: Tracker, user: string, token: string): Promise<TrackerStatus> {
  return invoke("tracker_sign_in", { tracker, user, token });
}

export function trackerSignOut(tracker: Tracker): Promise<void> {
  return invoke("tracker_sign_out", { tracker });
}
