import { createContext, useContext } from "react";
import type { RepoSnapshot, Tracker, WebRemote } from "../api";
import { referenceUrl, type MessagePart } from "./weblinks";

/** The repository's issue tracker, for commit messages, details and new branches. */
export const IssueTrackerContext = createContext<{ repoPath: string; tracker: Tracker | null; remote: WebRemote | undefined }>({
  repoPath: "",
  tracker: null,
  remote: undefined,
});

export function useIssueTracker() {
  return useContext(IssueTrackerContext);
}

/** What a repository's tracker setting says: "off", a tracker, or null (the remote's own issues). */
export type TrackerSetting = Tracker | "off" | null;

/** The tracker in use: the one chosen, or the GitHub or GitLab remote's own issues. */
export function effectiveTracker(setting: TrackerSetting, snapshot: Pick<RepoSnapshot, "webRemotes"> | null): Tracker | null {
  if (setting === "off") return null;
  if (setting) return setting;
  const host = snapshot?.webRemotes.find((remote) => remote.name === "origin")?.host ?? snapshot?.webRemotes[0]?.host;
  if (host === "github") return { kind: "github", site: "", keys: [] };
  if (host === "gitlab") return { kind: "gitlab", site: "", keys: [] };
  return null;
}

/** Jira's and Linear's keys look like FEAST-12; GitHub's and GitLab's like #12. */
const KEY = /\b([A-Z][A-Z0-9_]{1,9})-(\d{1,7})\b/g;
const NUMBER = /(^|[^\w&/])#(\d{1,7})\b/g;

/** The issues `text` mentions, in order, each once. */
export function issueKeys(text: string, tracker: Tracker | null): string[] {
  if (!tracker) return [];
  const found: string[] = [];
  if (tracker.kind === "jira" || tracker.kind === "linear") {
    const projects = new Set(tracker.keys.map((key) => key.trim().toUpperCase()).filter(Boolean));
    for (const match of text.matchAll(KEY)) {
      if (projects.size === 0 || projects.has(match[1])) found.push(match[0]);
    }
  } else {
    for (const match of text.matchAll(NUMBER)) found.push(`#${match[2]}`);
  }
  return [...new Set(found)];
}

/** Where an issue is, without asking the tracker. */
export function issueUrl(key: string, tracker: Tracker, remote: WebRemote | undefined): string | null {
  switch (tracker.kind) {
    case "jira": {
      const site = tracker.site.trim().replace(/\/+$/, "");
      if (!site) return null;
      return `${site.includes("://") ? site : `https://${site}`}/browse/${key}`;
    }
    case "linear":
      return tracker.site.trim() ? `https://linear.app/${encodeURIComponent(tracker.site.trim())}/issue/${key}` : null;
    default:
      return remote ? referenceUrl(remote, key) : null;
  }
}

/** A branch name for working on an issue: "FEAST-12-barber-s-apron", or "12-barber-s-apron". */
export function branchNameFor(issue: { key: string; title: string }): string {
  const slug = issue.title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const key = issue.key.replace(/^#/, "");
  return slug ? `${key}-${slug}` : key;
}

/** Message parts with Jira's or Linear's issue keys (FEAST-12) in their text linked. */
export function linkIssueKeys(parts: MessagePart[], tracker: Tracker | null, remote: WebRemote | undefined): MessagePart[] {
  if (!tracker || (tracker.kind !== "jira" && tracker.kind !== "linear")) return parts;
  const keys = new Set(tracker.keys.map((key) => key.trim().toUpperCase()).filter(Boolean));
  return parts.flatMap((part) => {
    if (part.kind !== "text") return [part];
    const out: MessagePart[] = [];
    let last = 0;
    for (const match of part.text.matchAll(KEY)) {
      const url = keys.size === 0 || keys.has(match[1]) ? issueUrl(match[0], tracker, remote) : null;
      if (!url) continue;
      const start = match.index ?? 0;
      if (start > last) out.push({ kind: "text", text: part.text.slice(last, start) });
      out.push({ kind: "url", text: match[0], url });
      last = start + match[0].length;
    }
    if (last < part.text.length) out.push({ kind: "text", text: part.text.slice(last) });
    return out;
  });
}
