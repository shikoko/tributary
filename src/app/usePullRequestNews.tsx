import { useEffect, useRef } from "react";
import { pullRequestDetails, requestConversation, type PullRequest } from "../api";
import { BellIcon } from "../components/Icons";
import type { ToastMessage } from "../components/Toast";
import { notifySystem } from "../lib/notify";
import { describeRequestNews, seenNow, wasMergedHere, type RequestSeen } from "../lib/requestNews";
import type { NewCommitNotices } from "./usePreferences";

/** At most this many of your pull requests are followed. */
const MOST = 8;

interface Options {
  repoPath: string | null;
  repoName: string;
  /** The open pull requests, as the badges know them: asked for again after fetches. */
  list: PullRequest[];
  /** Your local branches: pull requests from them are yours. */
  localBranches: ReadonlySet<string>;
  notices: NewCommitNotices;
  notify: (toast: ToastMessage) => void;
  open: (pr: PullRequest) => void;
}

/**
 * News of your pull requests (those you opened, or from your local branches): reviews and
 * comments by others, checks that finished or failed, and being merged or closed. Looked
 * for each time the list of pull requests is asked for again (every minute, after a fetch, or coming
 * back to the window); the first look at one only remembers where it stands.
 */
export function usePullRequestNews(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const seen = useRef(new Map<string, { pr: PullRequest; seen: RequestSeen }>());
  const you = useRef(new Map<string, string | null>());
  const looking = useRef(false);

  useEffect(() => {
    const { repoPath, list, notices, localBranches } = latest.current;
    if (!repoPath || notices === "off" || looking.current) return;
    looking.current = true;
    const key = (number: number) => `${repoPath}#${number}`;
    const announce = (pr: PullRequest, news: string[]) => {
      const { notify, open, notices, repoName } = latest.current;
      if (news.length === 0 || notices === "off") return;
      notify({
        text: news[0] + (news.length > 1 ? `, and ${news.length - 1} more` : ""),
        icon: <BellIcon size={14} />,
        action: { label: "Show", onClick: () => open(pr) },
      });
      if (notices === "system" && !document.hasFocus()) for (const item of news) notifySystem(repoName, item);
    };
    (async () => {
      try {
        const me = you.current.get(repoPath);
        const yours = (pr: PullRequest, login: string | null | undefined) => localBranches.has(pr.branch) || Boolean(login && pr.author.toLowerCase() === login.toLowerCase());
        // Who you are comes with a conversation: the first time, ask about one to find out.
        const candidates = list.filter((pr) => yours(pr, me) || (me === undefined && pr === list[0])).slice(0, MOST);
        for (const pr of candidates) {
          const [conversation, details] = await Promise.all([requestConversation(repoPath, pr.number), pullRequestDetails(repoPath, pr.number)]);
          if (!you.current.has(repoPath)) you.current.set(repoPath, conversation.you);
          if (!yours(pr, conversation.you)) continue;
          const now = seenNow(conversation, details);
          const before = seen.current.get(key(pr.number));
          seen.current.set(key(pr.number), { pr, seen: now });
          // Merged from this window: not news.
          if (wasMergedHere(repoPath, pr.number)) now.state = before?.seen.state ?? now.state;
          if (before) announce(pr, describeRequestNews(pr, before.seen, now, conversation));
        }
        // Yours that aren't open any more: merged or closed (unless merged here).
        const open = new Set(list.map((pr) => key(pr.number)));
        for (const [known, { pr, seen: before }] of [...seen.current]) {
          if (!known.startsWith(`${repoPath}#`) || open.has(known)) continue;
          seen.current.delete(known);
          if (wasMergedHere(repoPath, pr.number)) continue;
          const details = await pullRequestDetails(repoPath, pr.number);
          announce(pr, describeRequestNews(pr, before, { ...before, state: details.state }, null));
        }
      } catch {
        // No network, or no token: nothing to tell.
      } finally {
        looking.current = false;
      }
    })();
  }, [options.list]);
}
