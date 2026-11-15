import { useContext, useEffect, useMemo, useState } from "react";
import { issues as fetchIssues, type Issue, type PullRequest, type Tracker, type WebRemote } from "../api";
import { issueKeys, issueUrl, useIssueTracker } from "../lib/issues";
import { PullRequestsContext, requestNumber } from "../lib/pullRequests";
import { openInBrowser } from "../lib/weblinks";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";

/** Issues already looked up, by tracker and key. */
const known = new Map<string, Issue | null>();

/**
 * The pull request (or GitLab merge request) `key` names, when it names one on the site the
 * repository is on: an open one, as the badges know it, or one its link says is a pull
 * request (a merged one, say), with what the app needs to show it.
 */
function requestFor(key: string, issue: Issue | null | undefined, open: PullRequest | undefined, tracker: Tracker, remote: WebRemote | undefined): PullRequest | null {
  if ((tracker.kind !== "github" && tracker.kind !== "gitlab") || !remote) return null;
  const match = /^([#!])(\d+)$/.exec(key);
  if (!match) return null;
  if (open) return open;
  const url = issue?.url ?? issueUrl(key, tracker, remote);
  const isRequest = match[1] === "!" || /\/pull\/\d+|\/merge_requests\/\d+/.test(issue?.url ?? "");
  if (!isRequest || !url) return null;
  return { number: Number(match[2]), title: issue?.title ?? key, url, remote: remote.name, branch: "", draft: false, author: "", checks: null, forge: tracker.kind };
}

/** A state's colour, as the pull request screen has them: merged purple, open green, the rest grey. */
export function tone(status: string): string {
  const state = status.toLowerCase();
  return state === "merged" || state === "open" ? state : "other";
}

/** One issue: its key (a link to it on the site), title and state. */
function Mention({ id, url, title, status, done }: { id: string; url: string | null; title?: string; status?: string | null; done?: boolean }) {
  return (
    <li className={`mentioned-issue${done ? " done" : ""}`}>
      <Button kind="link" className="mentioned-issue-key mono" onClick={() => url && openInBrowser(url)} disabled={!url} data-url={url ?? undefined}>
        {id}
      </Button>
      {title && <span className="mentioned-issue-title">{title}</span>}
      {status && (
        <span className="mentioned-issue-end">
          <Chip className={`mentioned-issue-status ${tone(status)}`}>{status}</Chip>
        </span>
      )}
    </li>
  );
}

/** An issue or pull request a commit names, as the details panel lists it. */
export interface Mentioned {
  key: string;
  /** "#12", "!12" or "FEAST-12". */
  id: string;
  url: string | null;
  title?: string;
  status?: string | null;
  done?: boolean;
  /** The pull request (or GitLab merge request) it is, if it's one. */
  request: PullRequest | null;
  /** Shows the pull request in the app. */
  onShow?: () => void;
}

/**
 * The open pull requests of the commit's branches (`open`), then the issues its message and
 * branches mention, with their titles and states from the repository's tracker (when it
 * answers; otherwise just links). A pull request can be shown in the app, as well as opened on
 * the site: an open one from its branch's commit, a merged one from its merge commit, which
 * mentions it.
 */
export function useMentions(text: string, open: PullRequest[] = []): Mentioned[] {
  const { repoPath, tracker, remote } = useIssueTracker();
  const requests = useContext(PullRequestsContext);
  // An open pull request is listed once, as the branch's.
  const keys = useMemo(() => {
    const listed = new Set(open.map(requestNumber));
    return issueKeys(text, tracker)
      .filter((key) => !listed.has(key))
      .slice(0, 12);
  }, [text, tracker, open]);
  const scope = tracker ? `${repoPath}|${tracker.kind}|${tracker.site}` : "";
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!tracker || keys.length === 0) return;
    const missing = keys.filter((key) => !known.has(`${scope}|${key}`));
    if (missing.length === 0) return;
    let current = true;
    fetchIssues(repoPath, tracker, missing)
      .then((found) => {
        for (const key of missing) known.set(`${scope}|${key}`, found.find((issue) => issue.key.toUpperCase() === key.toUpperCase()) ?? null);
        if (current) setVersion((version) => version + 1);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [repoPath, tracker, scope, keys]);
  const opened: Mentioned[] = open.map((pr) => ({
    key: `open:${pr.remote}/${pr.number}`,
    id: requestNumber(pr),
    url: pr.url,
    title: pr.title,
    status: pr.draft ? "Draft" : "Open",
    request: pr,
    onShow: requests ? () => requests.open(pr) : undefined,
  }));
  if (!tracker) return opened;
  return [
    ...opened,
    ...keys.map((key): Mentioned => {
      const issue = known.get(`${scope}|${key}`);
      const number = /^[#!](\d+)$/.exec(key)?.[1];
      const request = requests ? requestFor(key, issue, number ? requests.byNumber(Number(number)) : undefined, tracker, remote) : null;
      return {
        key,
        id: key,
        url: issue?.url ?? issueUrl(key, tracker, remote),
        title: issue?.title,
        status: issue?.status,
        done: issue?.done,
        request,
        onShow: request && requests ? () => requests.open(request) : undefined,
      };
    }),
  ];
}

/** The issues a commit names, a row each, under its message. (Pull requests have cards of their own: CommitRequests.) */
export function MentionedIssues({ mentions }: { mentions: Mentioned[] }) {
  const issues = mentions.filter((mention) => !mention.request);
  if (issues.length === 0) return null;
  return (
    <ul className="mentioned-issues" aria-label="Issues">
      {issues.map((mention) => (
        <Mention key={mention.key} id={mention.id} url={mention.url} title={mention.title} status={mention.status} done={mention.done} />
      ))}
    </ul>
  );
}
