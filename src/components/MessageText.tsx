import { useMemo } from "react";
import type { WebRemote } from "../api";
import { linkIssueKeys, useIssueTracker } from "../lib/issues";
import { linkify, openInBrowser } from "../lib/weblinks";

interface Props {
  text: string;
  remote: WebRemote | undefined;
  /** An abbreviated commit id → the id of a loaded commit with it, or null. */
  resolveCommit: (prefix: string) => string | null;
  onSelectCommit: (id: string) => void;
}

/** A commit message with its links, issue numbers and commit ids clickable. */
export function MessageText({ text, remote, resolveCommit, onSelectCommit }: Props) {
  const { tracker } = useIssueTracker();
  const parts = useMemo(() => linkIssueKeys(linkify(text, remote, resolveCommit), tracker, remote), [text, remote, resolveCommit, tracker]);
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <span key={index}>{part.text}</span>
        ) : part.kind === "url" ? (
          <a
            key={index}
            href={part.url}
            className="message-link"
            title={part.url}
            onClick={(event) => {
              event.preventDefault();
              openInBrowser(part.url);
            }}
          >
            {part.text}
          </a>
        ) : (
          <button key={index} className="sha-link inline" onClick={() => onSelectCommit(part.id)} title="Go to this commit">
            {part.text}
          </button>
        ),
      )}
    </>
  );
}
