import { useState } from "react";
import {
  commentOnRequest,
  mergeRequest,
  reviewRequest,
  type MergeMethod,
  type RequestComment,
  type RequestConversation,
  type RequestDetails,
  type ReviewVerdict,
} from "../api";
import { relativeTime } from "../lib/format";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";

const METHODS: Record<MergeMethod, { label: string; hint: string }> = {
  merge: { label: "Merge", hint: "Its commits as they are, joined by a merge commit." },
  squash: { label: "Squash and merge", hint: "All its commits as one." },
  rebase: { label: "Rebase and merge", hint: "Its commits replayed on top, one by one, without a merge commit." },
};

const VERDICTS: Record<NonNullable<RequestComment["review"]>, string> = {
  approved: "approved",
  changesRequested: "asked for changes",
  commented: "reviewed",
  requested: "was asked to review",
};

/** Merge a request on its site: how, the commit's message, and whether to delete its branch. */
export function MergeRequestDialog({
  repoPath,
  details,
  methods,
  onCancel,
  onDone,
}: {
  repoPath: string;
  details: RequestDetails;
  methods: MergeMethod[];
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [method, setMethod] = useState<MergeMethod>(methods[0] ?? "merge");
  const noun = details.forge === "gitlab" ? "merge request" : "pull request";
  const number = details.forge === "gitlab" ? `!${details.number}` : `#${details.number}`;
  const [title, setTitle] = useState(details.forge === "gitlab" ? "" : `${details.title} (${number})`);
  const [message, setMessage] = useState("");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const warning =
    details.mergeable === "conflicts"
      ? `It conflicts with ${details.base}: the site will refuse to merge it until that's resolved.`
      : details.mergeable === "blocked"
        ? "Something the site requires is missing (approvals, passing checks…): it may refuse to merge it."
        : details.mergeable === "behind"
          ? `It's behind ${details.base}: the site may want it brought up to date first.`
          : null;
  const merge = async () => {
    setRunning(true);
    setError(null);
    try {
      onDone(await mergeRequest(repoPath, details.number, { method, title: method === "rebase" ? "" : title, message: method === "rebase" ? "" : message, deleteBranch }));
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };
  return (
    <Dialog
      title={`Merge ${noun} ${number}?`}
      error={error}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={running}>
            Cancel
          </button>
          <button className="primary-button" onClick={merge} disabled={running}>
            {running ? "Merging…" : METHODS[method].label}
          </button>
        </>
      }
    >
      <p>
        <strong>{details.branch}</strong> goes into <strong>{details.base}</strong> on {details.forge === "gitlab" ? "GitLab" : "GitHub"}. Pull afterwards to get it here.
      </p>
      {warning && <p className="dialog-note-line warning">{warning}</p>}
      {methods.length > 1 && (
        <div className="merge-methods" role="radiogroup" aria-label="How to merge it">
          {methods.map((each) => (
            <label key={each} className={`merge-method${method === each ? " selected" : ""}`}>
              <input type="radio" name="merge-method" checked={method === each} onChange={() => setMethod(each)} />
              <span className="merge-method-label">{METHODS[each].label}</span>
              <span className="merge-method-hint">{METHODS[each].hint}</span>
            </label>
          ))}
        </div>
      )}
      {method !== "rebase" && (
        <>
          <label className="field">
            <span>{method === "squash" ? "Commit summary" : "Merge commit summary"}</span>
            <input className="text-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="The site's usual one" spellCheck />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea className="text-input request-body short" rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Optional" />
          </label>
        </>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={deleteBranch} onChange={(event) => setDeleteBranch(event.target.checked)} />
        Delete {details.branch} on the site afterwards
      </label>
    </Dialog>
  );
}

/** Approve, ask for changes, or comment, as a review. */
export function ReviewBox({
  repoPath,
  details,
  conversation,
  onDone,
  onCancel,
}: {
  repoPath: string;
  details: RequestDetails;
  conversation: RequestConversation;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [running, setRunning] = useState<ReviewVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const yours = conversation.you !== null && conversation.you.toLowerCase() === details.author.toLowerCase();
  const send = async (verdict: ReviewVerdict) => {
    setRunning(verdict);
    setError(null);
    try {
      onDone(await reviewRequest(repoPath, details.number, verdict, body));
    } catch (e) {
      setError(String(e));
      setRunning(null);
    }
  };
  return (
    <div className="review-box">
      <textarea
        className="text-input request-body"
        rows={4}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={yours ? "A note on your own changes (Markdown)" : "What you think of it (Markdown); optional to approve"}
        autoFocus
        aria-label="Your review"
      />
      {error && <p className="review-error">{error}</p>}
      <div className="review-buttons">
        <button className="link-button" onClick={onCancel} disabled={running !== null}>
          Cancel
        </button>
        <span className="spacer" />
        <button className="outline-button" onClick={() => send("comment")} disabled={running !== null || !body.trim()}>
          <span className="button-label">{running === "comment" ? "Sending…" : "Comment"}</span>
        </button>
        {!yours && conversation.canRequestChanges && (
          <button className="outline-button review-changes" onClick={() => send("requestChanges")} disabled={running !== null || !body.trim()} title="Say what should change first">
            <span className="button-label">{running === "requestChanges" ? "Sending…" : "Ask for changes"}</span>
          </button>
        )}
        {!yours && (
          <button className="primary-small-button" onClick={() => send("approve")} disabled={running !== null}>
            {running === "approve" ? "Approving…" : "Approve"}
          </button>
        )}
      </div>
    </div>
  );
}

/** A request's comments, reviews and comments on lines, with replies and a box to comment. */
export function ConversationList({
  repoPath,
  details,
  conversation,
  onDone,
}: {
  repoPath: string;
  details: RequestDetails;
  conversation: RequestConversation;
  onDone: (message: string) => void;
}) {
  const [replying, setReplying] = useState<string | null>(null);
  return (
    <>
      {conversation.comments.length === 0 ? (
        <p className="muted request-empty">No comments yet.</p>
      ) : (
        <ol className="request-conversation">
          {conversation.comments.map((comment, index) => {
            const next = conversation.comments[index + 1];
            // The reply box goes after a thread's last comment.
            const lastInThread = comment.thread !== null && (!next || next.thread !== comment.thread || !next.reply);
            return (
              <li key={comment.id} className={`request-comment${comment.reply ? " reply" : ""}${comment.review ? ` review ${comment.review}` : ""}`}>
                <CommentBody comment={comment} />
                {lastInThread &&
                  conversation.you &&
                  (replying === comment.thread ? (
                    <CommentBox
                      repoPath={repoPath}
                      number={details.number}
                      thread={comment.thread}
                      placeholder="Your reply (Markdown)"
                      onDone={(message) => {
                        setReplying(null);
                        onDone(message);
                      }}
                      onCancel={() => setReplying(null)}
                    />
                  ) : (
                    <button className="link-button request-reply" onClick={() => setReplying(comment.thread)}>
                      Reply
                    </button>
                  ))}
              </li>
            );
          })}
        </ol>
      )}
      {conversation.you && (
        <CommentBox repoPath={repoPath} number={details.number} thread={null} placeholder="Add a comment (Markdown)" onDone={onDone} />
      )}
    </>
  );
}

function CommentBody({ comment }: { comment: RequestComment }) {
  const when = Date.parse(comment.created) / 1000;
  return (
    <div className="request-comment-body">
      <div className="request-comment-head">
        <Avatar name={comment.author} email="" size={20} />
        <strong>{comment.author}</strong>
        {comment.review && <span className={`request-review ${comment.review}`}>{VERDICTS[comment.review]}</span>}
        {comment.path && !comment.reply && (
          <span className="request-comment-where mono" title={comment.path}>
            {comment.path.split("/").pop()}
            {comment.line !== null && `:${comment.line}`}
          </span>
        )}
        {Number.isFinite(when) && <span className="request-comment-when">{relativeTime(when)}</span>}
      </div>
      {comment.hunk && !comment.reply && (
        <pre className="request-hunk">
          {comment.hunk.split("\n").map((line, index) => (
            <span key={index} className={line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : undefined}>
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
      {comment.body.trim() && <div className="request-description">{comment.body.trim()}</div>}
    </div>
  );
}

function CommentBox({
  repoPath,
  number,
  thread,
  placeholder,
  onDone,
  onCancel,
}: {
  repoPath: string;
  number: number;
  thread: string | null;
  placeholder: string;
  onDone: (message: string) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setRunning(true);
    setError(null);
    try {
      const message = await commentOnRequest(repoPath, number, body, thread);
      setBody("");
      setRunning(false);
      onDone(message);
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };
  return (
    <div className="comment-box">
      <textarea
        className="text-input request-body"
        rows={thread ? 2 : 3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && body.trim()) {
            event.preventDefault();
            void send();
          }
        }}
        placeholder={placeholder}
        autoFocus={thread !== null}
        aria-label={thread ? "Your reply" : "Your comment"}
      />
      {error && <p className="review-error">{error}</p>}
      <div className="review-buttons">
        {onCancel && (
          <button className="link-button" onClick={onCancel} disabled={running}>
            Cancel
          </button>
        )}
        <span className="spacer" />
        <button className="primary-small-button" onClick={send} disabled={running || !body.trim()}>
          {running ? "Sending…" : thread ? "Reply" : "Comment"}
        </button>
      </div>
    </div>
  );
}
