import { useState } from "react";
import type { RequestComment } from "../../api";
import type { ReviewThread } from "../../lib/reviewThreads";
import { CommentBody, CommentBox } from "../RequestReview";
import { Button } from "../ui/Button";

/** A pull request's review comments, to show in its files' changes, and how to reply to them. */
export interface ReviewNotes {
  repoPath: string;
  /** The pull request's number. */
  number: number;
  comments: RequestComment[];
  /** You can reply: you're signed in to its site. */
  canReply: boolean;
  openUrl: (url: string) => void;
  /** After a reply: say so, and read its comments again. */
  onReplied: (message: string) => void;
}

/**
 * Review threads, each its comments and a way to reply. Under their line (`atLine`), they
 * don't say which line, or quote it.
 */
export function ReviewThreads({ threads, notes, atLine }: { threads: ReviewThread[]; notes: ReviewNotes; atLine: boolean }) {
  const [replying, setReplying] = useState<string | null>(null);
  return (
    <div className="review-threads">
      {threads.map((thread) => {
        const replyTo = thread.comments[0].thread;
        return (
          <div key={thread.id} className="review-thread">
            <ol className="request-conversation">
              {thread.comments.map((comment) => (
                <li key={comment.id} className={`request-comment${comment.reply ? " reply" : ""}`}>
                  <CommentBody comment={comment} openUrl={notes.openUrl} atLine={atLine} />
                </li>
              ))}
            </ol>
            {notes.canReply &&
              replyTo !== null &&
              (replying === thread.id ? (
                <CommentBox
                  repoPath={notes.repoPath}
                  number={notes.number}
                  thread={replyTo}
                  placeholder="Your reply"
                  onDone={(message) => {
                    setReplying(null);
                    notes.onReplied(message);
                  }}
                  onCancel={() => setReplying(null)}
                />
              ) : (
                <Button kind="link" className="request-reply" onClick={() => setReplying(thread.id)}>
                  Reply
                </Button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
