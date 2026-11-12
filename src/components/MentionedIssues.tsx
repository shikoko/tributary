import { useContext, useEffect, useMemo, useState } from "react";
import { issues as fetchIssues, type Issue, type PullRequest, type Tracker, type WebRemote } from "../api";
import { issueKeys, issueUrl, useIssueTracker } from "../lib/issues";
import { PullRequestsContext } from "../lib/pullRequests";
import { openInBrowser } from "../lib/weblinks";
import { PullRequestIcon } from "./Icons";
import { Button } from "./ui/Button";

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

/**
 * The issues a commit's message and branches mention, with their titles and states from
 * the repository's tracker (when it answers; otherwise just links). A pull request among
 * them can be shown in the app, as well as opened on the site.
 */
export function MentionedIssues({ text }: { text: string }) {
  const { repoPath, tracker, remote } = useIssueTracker();
  const requests = useContext(PullRequestsContext);
  const keys = useMemo(() => issueKeys(text, tracker).slice(0, 12), [text, tracker]);
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
  if (!tracker || keys.length === 0) return null;
  return (
    <ul className="mentioned-issues" aria-label="Issues">
      {keys.map((key) => {
        const issue = known.get(`${scope}|${key}`);
        const url = issue?.url ?? issueUrl(key, tracker, remote);
        const number = /^[#!](\d+)$/.exec(key)?.[1];
        const request = requests ? requestFor(key, issue, number ? requests.byNumber(Number(number)) : undefined, tracker, remote) : null;
        return (
          <li key={key} className={`mentioned-issue${issue?.done ? " done" : ""}`}>
            <Button kind="link" className="mentioned-issue-key mono" onClick={() => url && openInBrowser(url)} disabled={!url} data-url={url ?? undefined}>
              {key}
            </Button>
            {issue && <span className="mentioned-issue-title">{issue.title}</span>}
            {issue?.status && <span className="mentioned-issue-status">{issue.status}</span>}
            {request && requests && (
              <button className="mentioned-issue-show" onClick={() => requests.open(request)} title={`Show ${key} here, in Tributary`}>
                <PullRequestIcon size={12} />
                Show
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
