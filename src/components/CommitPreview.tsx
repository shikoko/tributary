import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CommitDetails, CommitRow } from "../api";
import { laneColor } from "../lib/colors";
import { fullDate, plural, shortId } from "../lib/format";
import { Avatar } from "./Avatar";
import { RefPills } from "./RefPills";

interface Props {
  commit: CommitRow;
  /** Where the pointer is, in window coordinates. */
  x: number;
  y: number;
  loadDetails: (id: string) => Promise<CommitDetails>;
}

/** A card with a commit's full message and changed-file counts, shown on hover. */
export function CommitPreview({ commit, x, y, loadDetails }: Props) {
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x + 16, top: y + 16 });

  useEffect(() => {
    let cancelled = false;
    loadDetails(commit.id).then(
      (loaded) => !cancelled && setDetails(loaded),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [commit.id, loadDetails]);

  // Keep the card inside the window.
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const left = Math.min(x + 16, window.innerWidth - width - 8);
    const top = y + 16 + height > window.innerHeight - 8 ? y - height - 12 : y + 16;
    setPosition({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y, details]);

  const counts = details && {
    added: details.files.filter((f) => f.status === "added" || f.status === "copied" || f.status === "untracked").length,
    deleted: details.files.filter((f) => f.status === "deleted").length,
    modified: details.files.filter((f) => f.status === "modified" || f.status === "renamed").length,
  };
  const body = details?.body.split("\n").slice(0, 8).join("\n");

  return (
    <div ref={card} className="commit-preview" style={position} role="tooltip">
      <div className="preview-summary">{details?.summary ?? commit.summary}</div>
      {body && <div className="preview-body">{body}</div>}
      {commit.refs.length > 0 && (
        <div className="preview-refs">
          <RefPills refs={commit.refs} color={laneColor(commit.graph.column)} />
        </div>
      )}
      <div className="preview-meta">
        <Avatar name={commit.authorName} email={commit.authorEmail} size={18} />
        <span>{commit.authorName}</span>
        <span className="muted">· {fullDate(commit.time)}</span>
        <code>{shortId(commit.id)}</code>
      </div>
      <div className="preview-files">
        {!details ? (
          <span className="muted">Loading…</span>
        ) : details.files.length === 0 ? (
          <span className="muted">No file changes</span>
        ) : (
          <>
            <span>{plural(details.files.length, "file")}</span>
            {counts!.added > 0 && <span className="change-count added">+{counts!.added}</span>}
            {counts!.modified > 0 && <span className="change-count modified">~{counts!.modified}</span>}
            {counts!.deleted > 0 && <span className="change-count deleted">−{counts!.deleted}</span>}
          </>
        )}
      </div>
    </div>
  );
}
