import { useEffect, useState, type ReactNode } from "react";
import { unseenCommits, upstreamChoices, type Action, type CommitRow, type UnseenCommits, type UpstreamChoices } from "../api";
import { ErrorBanner, type ErrorChoice } from "../components/ErrorBanner";
import { byWhom, explainError, gitHeadline, type ErrorFix } from "../lib/explainError";
import { relativeTime, shortId } from "../lib/format";
import type { Running } from "./constants";
import type { RepoError } from "./useRepository";
import { useOpenRepository } from "./OpenRepository";

interface Props {
  error: RepoError;
  /** The checked-out commit's row, for a new branch from it. */
  head: CommitRow | undefined;
  running: Running;
  onDismiss: () => void;
}

/**
 * The last error, in plain words when it's one git often gives, with what can be done about
 * it. A force push that stopped for someone else's commits lists them.
 */
export function RepoErrorBanner({ error, head, running, onDismiss }: Props) {
  const { snapshot, act, openDialog, openTab: openWorktree, goTo } = useOpenRepository();
  const branch = snapshot.headBranch ?? "HEAD";
  const upstream = snapshot.upstream?.name ?? null;
  // A safe force push stopped for commits someone else pushed: the push fetched them, to
  // be listed here.
  const stale = error.kind?.kind === "staleLease";
  const [unseen, setUnseen] = useState<UnseenCommits | null>(null);
  useEffect(() => {
    if (!stale || !upstream) return;
    let live = true;
    unseenCommits(snapshot.path, upstream, error.upstreamWas ?? null)
      .then((found) => live && setUnseen(found))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [stale, snapshot.path, upstream, error.upstreamWas, error.message]);

  // The branch's remote branch is gone: what it could go with instead.
  const gone = error.kind?.kind === "upstreamGone";
  const [others, setOthers] = useState<UpstreamChoices | null>(null);
  useEffect(() => {
    if (!gone || !snapshot.headBranch) return;
    let live = true;
    upstreamChoices(snapshot.path, snapshot.headBranch)
      .then((found) => live && setOthers(found))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [gone, snapshot.path, snapshot.headBranch, error.message]);

  // Whose commits they are: who pushed them isn't known (a merge brings in others' commits).
  const by = unseen ? byWhom(unseen.commits.map((commit) => commit.author), unseen.count > unseen.commits.length) : null;
  const explained = explainError(error.kind ?? null, { branch, upstream, unseen: unseen && unseen.count > 0 ? { count: unseen.count, by } : null });
  const headline = explained?.headline ?? gitHeadline(error.message);
  const busy = running !== null;
  const them = unseen?.count === 1 ? "it" : "them";

  const choice = (fix: ErrorFix): ErrorChoice | null => {
    switch (fix) {
      case "sync":
        return {
          label: "Sync",
          says: (
            <>
              Get their commits, then push yours on top. <b>Nothing is lost.</b>
            </>
          ),
          run: () => act({ kind: "sync" }),
          disabled: busy,
        };
      case "forcePush":
        return {
          label: "Force push…",
          says: (
            <>
              Replace {upstream ?? "the remote branch"} with your {branch}. <b>Their commits are removed from it.</b>
            </>
          ),
          run: () => openDialog({ kind: "forcePush" }),
          disabled: busy,
        };
      case "forcePushAnyway":
        return {
          label: "Force push anyway…",
          says: (
            <>
              Replace {them} with your {branch}. <b>{unseen?.count === 1 ? "It's" : "They're"} removed from {upstream ?? "the remote branch"}</b>, and a copy
              is kept in Repository → Restore.
            </>
          ),
          run: () => openDialog({ kind: "forcePush", overwrite: true }),
          disabled: busy,
        };
      case "showUnseen": {
        const newest = unseen?.commits[0];
        return newest
          ? { label: unseen.count === 1 ? "Show it" : "Show them", says: `Go to ${unseen.count === 1 ? "it" : "the newest"} in the history.`, run: () => goTo(newest.id) }
          : null;
      }
      case "retry":
        return error.action
          ? { label: "Try again", says: "Run it again.", run: () => act(error.action!), disabled: busy }
          : null;
      case "push":
        return {
          label: "Push",
          says: `Push ${branch}, which links it to a branch of the same name on the remote.`,
          run: () => act({ kind: "push", force: false }),
          disabled: busy,
        };
      case "stash":
        return error.retry ? stashChoice(error.retry) : null;
      case "newBranch":
        return head
          ? {
              label: "New branch…",
              says: "Make a branch for your commits, push it, and open a pull request from it.",
              run: () => openDialog({ kind: "newBranch", target: head }),
              disabled: busy,
            }
          : null;
      case "useUpstream": {
        const suggested = others?.suggested;
        if (!suggested || !others) return null;
        const why = suggested === others.defaultBranch ? `It's ${others.remote}'s main branch` : `It has the same name as your ${branch}`;
        return {
          label: `Use ${suggested}`,
          says: `Pull from and push to ${suggested} from now on. ${why}${others.suggestedHasAll ? `, and has everything ${others.gone} had.` : "."}`,
          run: () => act({ kind: "setUpstream", branch, upstream: suggested }),
          disabled: busy,
        };
      }
      case "chooseUpstream":
        return {
          label: others?.suggested ? "Choose another…" : "Choose…",
          says: `Pick which of ${others?.remote ?? "the remote"}'s branches ${branch} goes with.`,
          run: () => openDialog({ kind: "chooseUpstream", branch }),
          disabled: busy,
        };
      case "pushBack":
        return {
          label: `Push ${branch}`,
          says: `Put ${branch} back on ${others?.remote ?? "the remote"}, as a branch of its own.`,
          run: () => act({ kind: "push", force: false }),
          disabled: busy,
        };
      case "moveToLfs":
        return { label: "Move into Git LFS…", says: "See which files are too big, and move them into Git LFS.", run: () => openDialog({ kind: "repoSize" }) };
    }
  };
  const stashChoice = (retry: Action): ErrorChoice => ({
    label: "Stash changes and retry",
    says: "Put your changes aside, do it, then bring them back.",
    run: () => act(retry),
    disabled: busy,
  });

  const fixes = explained?.fixes ?? [];
  const choices = fixes.map(choice).filter((found): found is ErrorChoice => found !== null);
  // What the error came with, beyond what the words above offer.
  if (error.retry && !fixes.includes("stash")) choices.push(stashChoice(error.retry));
  if (error.anyway) {
    const anyway = error.anyway;
    choices.push({ label: "Download anyway", says: "If the disk fills up, the download stops partway.", run: () => act(anyway), disabled: busy });
  }
  if (error.worktree) {
    const worktree = error.worktree;
    choices.push({ label: "Open that worktree", says: "It's checked out in that working tree: open it in its own tab.", run: () => openWorktree(worktree) });
  }

  let detail: ReactNode = explained?.detail;
  if (stale && unseen && unseen.count > 0) detail = `${explained?.detail ?? ""} ${unseen.count === 1 ? "It would be:" : "These would be:"}`;
  // git's own words, when there's more to them than the headline.
  const raw = error.message.trim() !== headline ? error.message.trim() : undefined;

  return (
    <ErrorBanner headline={headline} detail={detail} choices={choices} raw={raw} onDismiss={onDismiss}>
      {stale && unseen && unseen.count > 0 && (
        <ul className="error-commits">
          {unseen.commits.map((commit) => (
            <li key={commit.id}>
              <code>{shortId(commit.id)}</code>
              <strong>{commit.summary}</strong>
              <span>
                {commit.author}, {relativeTime(commit.time)}
              </span>
            </li>
          ))}
          {unseen.count > unseen.commits.length && <li className="error-commits-more">and {unseen.count - unseen.commits.length} more</li>}
        </ul>
      )}
    </ErrorBanner>
  );
}
