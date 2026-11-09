import { useEffect, useMemo, useState } from "react";
import { issues as fetchIssues, type Issue } from "../api";
import { issueKeys, issueUrl, useIssueTracker } from "../lib/issues";
import { openInBrowser } from "../lib/weblinks";

/** Issues already looked up, by tracker and key. */
const known = new Map<string, Issue | null>();

/**
 * The issues a commit's message and branches mention, with their titles and states from
 * the repository's tracker (when it answers; otherwise just links).
 */
export function MentionedIssues({ text }: { text: string }) {
  const { repoPath, tracker, remote } = useIssueTracker();
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
        return (
          <li key={key} className={`mentioned-issue${issue?.done ? " done" : ""}`}>
            <button className="link-button mentioned-issue-key mono" onClick={() => url && openInBrowser(url)} disabled={!url} title={url ?? undefined}>
              {key}
            </button>
            {issue && <span className="mentioned-issue-title">{issue.title}</span>}
            {issue?.status && <span className="mentioned-issue-status">{issue.status}</span>}
          </li>
        );
      })}
    </ul>
  );
}
