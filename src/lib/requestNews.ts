import type { PullRequest, RequestCheck, RequestConversation, RequestDetails } from "../api";
import { requestNumber } from "./pullRequests";

/** What was known of a pull request the last time it was looked at. */
export interface RequestSeen {
  /** The comments (and reviews) seen so far, by id. */
  comments: Set<string>;
  checks: "pending" | "success" | "failure" | "cancelled" | null;
  state: RequestDetails["state"];
}

/** Where the checks stand: still running, any failed, all passed, or none ran. */
export function checksState(checks: RequestCheck[]): RequestSeen["checks"] {
  if (checks.some((check) => check.state === "pending")) return "pending";
  if (checks.some((check) => check.state === "failure")) return "failure";
  // Stopped before finishing (replaced by a newer run): no news either way.
  if (checks.some((check) => check.state === "cancelled")) return "cancelled";
  if (checks.some((check) => check.state === "success")) return "success";
  return null;
}

export function seenNow(conversation: RequestConversation, details: RequestDetails): RequestSeen {
  return { comments: new Set(conversation.comments.map((comment) => comment.id)), checks: checksState(details.checks), state: details.state };
}

/**
 * What happened on `pr` between two looks, in words, most important first: reviews and
 * comments by others (yours are left out), checks that finished or failed, and whether it
 * was merged or closed.
 */
export function describeRequestNews(pr: PullRequest, before: RequestSeen, now: RequestSeen, conversation: RequestConversation | null): string[] {
  const number = requestNumber(pr);
  const news: string[] = [];
  if (before.state !== now.state && (now.state === "merged" || now.state === "closed")) {
    news.push(`${number} was ${now.state}`);
  }
  const you = conversation?.you?.toLowerCase();
  const fresh = (conversation?.comments ?? []).filter((comment) => !before.comments.has(comment.id) && comment.author.toLowerCase() !== you);
  for (const review of fresh.filter((comment) => comment.review)) {
    const what = review.review === "approved" ? "approved" : review.review === "changesRequested" ? "asked for changes on" : "reviewed";
    news.push(`${review.author} ${what} ${number}`);
  }
  const comments = fresh.filter((comment) => !comment.review);
  if (comments.length === 1) {
    const [comment] = comments;
    news.push(`${comment.author} ${comment.reply ? "replied on" : "commented on"} ${number}${comment.path ? ` (${comment.path.split("/").pop()})` : ""}`);
  } else if (comments.length > 1) {
    const people = [...new Set(comments.map((comment) => comment.author))];
    news.push(`${comments.length} new comments on ${number} from ${people.length > 2 ? `${people.slice(0, 2).join(", ")} and others` : people.join(" and ")}`);
  }
  const checks = pr.forge === "gitlab" ? "pipeline" : "checks";
  if (now.checks === "failure" && before.checks !== "failure") news.push(`${number}'s ${checks} failed`);
  else if (now.checks === "success" && before.checks === "pending") news.push(`${number}'s ${checks} passed`);
  return news;
}

/** Requests merged from this window: their merge isn't news. */
const mergedHere = new Set<string>();

export function noteMergedHere(repoPath: string, number: number) {
  mergedHere.add(`${repoPath}#${number}`);
}

export function wasMergedHere(repoPath: string, number: number): boolean {
  return mergedHere.has(`${repoPath}#${number}`);
}
