// Issue trackers: GitHub or GitLab issues, Jira or Linear.
import { invoke } from "@tauri-apps/api/core";

export type TrackerKind = "github" | "gitlab" | "jira" | "linear";

/** A repository's issue tracker, as set in its settings. */
export interface Tracker {
  kind: TrackerKind;
  /** Jira's address (like https://studio.atlassian.net), or Linear's workspace (studio). */
  site: string;
  /** Project (or team) keys, like FEAST; empty for any. */
  keys: string[];
}

export interface Issue {
  /** Like "FEAST-12", or "#12". */
  key: string;
  title: string;
  /** Like "In Progress". */
  status: string | null;
  /** Done, closed or cancelled. */
  done: boolean;
  url: string;
}

export interface TrackerStatus {
  signedIn: boolean;
  user: string | null;
}

/** The issues `keys` mentions, the ones that can be found. */
export function issues(path: string, tracker: Tracker, keys: string[]): Promise<Issue[]> {
  return invoke<Issue[]>("issues", { path, tracker, keys });
}

/** The open issues assigned to you, most recently updated first. */
export function myIssues(path: string, tracker: Tracker): Promise<Issue[]> {
  return invoke<Issue[]>("my_issues", { path, tracker });
}

export function trackerStatus(path: string, tracker: Tracker): Promise<TrackerStatus> {
  return invoke<TrackerStatus>("tracker_status", { path, tracker });
}

/** Sign in to Jira (email and API token, or a personal access token) or Linear (API key). */
export function trackerSignIn(tracker: Tracker, user: string, token: string): Promise<TrackerStatus> {
  return invoke<TrackerStatus>("tracker_sign_in", { tracker, user, token });
}

export function trackerSignOut(tracker: Tracker): Promise<void> {
  return invoke<void>("tracker_sign_out", { tracker });
}
