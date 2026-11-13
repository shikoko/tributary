import { openUrl } from "@tauri-apps/plugin-opener";
import type { RepoSnapshot, WebRemote } from "../api";

/** "GitHub" for a GitHub remote, and so on; null when the site isn't known. */
export function siteName(remote: WebRemote): string {
  switch (remote.host) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "gitea":
      return remote.url.includes("codeberg.org") ? "Codeberg" : "Gitea";
    default:
      return new URL(remote.url).host;
  }
}

/** The remote to link to: the one `branch` tracks, else origin, else the first one with a web page. */
export function webRemote(snapshot: RepoSnapshot, remoteName?: string | null): WebRemote | undefined {
  const { webRemotes } = snapshot;
  const tracked = remoteName ?? snapshot.upstream?.name.split("/")[0];
  return (
    webRemotes.find((remote) => remote.name === tracked) ??
    webRemotes.find((remote) => remote.name === "origin") ??
    webRemotes[0]
  );
}

/** Each part of a branch name escaped, keeping the slashes. */
const path = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");

export function commitUrl(remote: WebRemote, id: string): string | null {
  switch (remote.host) {
    case "github":
    case "gitea":
      return `${remote.url}/commit/${id}`;
    case "gitlab":
      return `${remote.url}/-/commit/${id}`;
    case "bitbucket":
      return `${remote.url}/commits/${id}`;
    default:
      return null;
  }
}

export function branchUrl(remote: WebRemote, branch: string): string | null {
  switch (remote.host) {
    case "github":
      return `${remote.url}/tree/${path(branch)}`;
    case "gitlab":
      return `${remote.url}/-/tree/${path(branch)}`;
    case "bitbucket":
      return `${remote.url}/branch/${path(branch)}`;
    case "gitea":
      return `${remote.url}/src/branch/${path(branch)}`;
    default:
      return null;
  }
}

/** The page for opening a pull (or merge) request from `branch`. */
export function newPullRequestUrl(remote: WebRemote, branch: string): string | null {
  switch (remote.host) {
    case "github":
      return `${remote.url}/compare/${path(branch)}?expand=1`;
    case "gitlab":
      return `${remote.url}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}`;
    case "bitbucket":
      return `${remote.url}/pull-requests/new?source=${encodeURIComponent(branch)}`;
    default:
      return null;
  }
}

/** "#123" (and on GitLab "!123", a merge request) in a commit message. */
export function referenceUrl(remote: WebRemote, reference: string): string | null {
  const number = reference.slice(1);
  if (reference.startsWith("!")) return remote.host === "gitlab" ? `${remote.url}/-/merge_requests/${number}` : null;
  switch (remote.host) {
    case "github":
    case "gitea":
      return `${remote.url}/issues/${number}`;
    case "gitlab":
      return `${remote.url}/-/issues/${number}`;
    default:
      return null;
  }
}

/** Open a web page in the default browser. */
export function openInBrowser(url: string) {
  if (!/^https?:\/\//.test(url)) return;
  openUrl(url).catch(() => window.open(url, "_blank", "noopener"));
}

/** A piece of a commit message: plain text, a web link, a link to an issue, or a commit id. */
export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "url"; text: string; url: string }
  | { kind: "commit"; text: string; id: string };

// (No lookbehind: older macOS versions' web views don't support it.)
const PATTERN = /(https?:\/\/[^\s<>"']+)|(^|[^\w/#!&])([#!]\d+)\b|\b([0-9a-f]{7,40})\b/g;

/** Split a commit message into text and links. `resolveCommit` turns an abbreviated id into a loaded commit's id. */
export function linkify(
  text: string,
  remote: WebRemote | undefined,
  resolveCommit: (prefix: string) => string | null,
): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  for (const match of text.matchAll(PATTERN)) {
    const [whole, url, before, reference, sha] = match;
    let part: MessagePart | null = null;
    let start = match.index ?? 0;
    let length = whole.length;
    if (reference) {
      // The character before "#123" is part of the match, but not of the link.
      start += before.length;
      length -= before.length;
    }
    if (url) {
      // Leave closing punctuation out of the link.
      const trimmed = url.replace(/[.,;:!?)\]]+$/, "");
      length = trimmed.length;
      part = { kind: "url", text: trimmed, url: trimmed };
    } else if (reference && remote) {
      const target = referenceUrl(remote, reference);
      if (target) part = { kind: "url", text: reference, url: target };
    } else if (sha) {
      const id = resolveCommit(sha);
      if (id) part = { kind: "commit", text: sha, id };
    }
    if (!part) continue;
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    parts.push(part);
    last = start + length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** "Co-authored-by: Name <email>" lines at the end of a commit message. */
export function coAuthors(body: string): { name: string; email: string }[] {
  const people: { name: string; email: string }[] = [];
  for (const line of body.split("\n")) {
    const match = /^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/i.exec(line.trim());
    if (match) people.push({ name: match[1], email: match[2] });
  }
  return people;
}

/** Tributary's own page on GitHub: its code, issues and releases. */
export const TRIBUTARY_ON_GITHUB = "https://github.com/shikoko/tributary";
