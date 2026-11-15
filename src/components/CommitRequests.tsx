import { useEffect, useState } from "react";
import { pullRequestDetails, type RequestDetails } from "../api";
import { requestStanding, type Standing } from "../lib/pullRequests";
import { openInBrowser } from "../lib/weblinks";
import { SectionButton, SiteChip } from "./DetailsSite";
import { PullRequestIcon } from "./Icons";
import { tone, type Mentioned } from "./MentionedIssues";
import { Button } from "./ui/Button";

/** Pull requests' details already asked for, by repository and number: shown at once next time, then asked again. */
const known = new Map<string, RequestDetails>();

/**
 * The pull requests of a commit's details (or GitLab merge requests): those of its branches,
 * and those its message names, like a merge commit's. Built as its checks are: where it
 * stands, as its view says it ("Can't be merged yet: changes were asked for", "Merged into
 * main"), in its tone's colour, with Show, which shows it in the app; under that, its number
 * (a link to it on the site), its title and who opened it.
 */
export function CommitRequests({ repoPath, requests }: { repoPath: string; requests: Mentioned[] }) {
  if (requests.length === 0) return null;
  const gitlab = requests.every((mention) => mention.request?.forge === "gitlab");
  const noun = gitlab ? "Merge request" : "Pull request";
  return (
    <section className="details-section commit-requests">
      <div className="details-section-head">
        <h3>{requests.length > 1 ? `${noun}s` : noun}</h3>
        <SiteChip site={gitlab ? "GitLab" : "GitHub"} />
      </div>
      {requests.map((mention) => (
        <RequestItem key={mention.key} repoPath={repoPath} mention={mention} />
      ))}
    </section>
  );
}

/**
 * Where a pull request stands, from its details (asked for when it's shown); until they come,
 * or without them, what its chip would say, like "Open" or "Merged".
 */
function useStanding(repoPath: string, mention: Mentioned): Standing {
  const number = mention.request?.number;
  const key = `${repoPath}#${mention.request?.remote ?? ""}#${number}`;
  const [details, setDetails] = useState<RequestDetails | undefined>(() => known.get(key));
  useEffect(() => {
    setDetails(known.get(key));
    if (number === undefined) return;
    let current = true;
    pullRequestDetails(repoPath, number)
      .then((found) => {
        known.set(key, found);
        if (current) setDetails(found);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [repoPath, number, key]);
  const standing = details && requestStanding(details);
  if (standing) return standing;
  const status = mention.status ?? "Open";
  return { text: details ? `Open, into ${details.base}` : status, tone: tone(status) === "merged" ? "merged" : "neutral" };
}

function RequestItem({ repoPath, mention }: { repoPath: string; mention: Mentioned }) {
  const standing = useStanding(repoPath, mention);
  const author = mention.request?.author;
  return (
    <div className={`site-item commit-request ${standing.tone}`}>
      <span className="site-item-icon">
        <PullRequestIcon size={14} />
      </span>
      <span className="site-item-text commit-request-standing" title={standing.text}>
        {standing.text}
      </span>
      {mention.onShow && <SectionButton onClick={mention.onShow} icon={<PullRequestIcon size={12} />} label="Show" title={`Show ${mention.id} here, in Tributary`} />}
      <span className="site-item-under commit-request-title">
        <Button kind="link" className="commit-request-key mono" onClick={() => mention.url && openInBrowser(mention.url)} disabled={!mention.url} data-url={mention.url ?? undefined} title={mention.url ? `Open ${mention.id} on the site` : undefined}>
          {mention.id}
        </Button>
        <span className="commit-request-name">
          {mention.title}
          {author && ` · ${author}`}
        </span>
      </span>
    </div>
  );
}
