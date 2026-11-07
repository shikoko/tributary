import type { CommitRow } from "../api";
import { copyText } from "../lib/clipboard";
import { shortId } from "../lib/format";
import { Avatar } from "./Avatar";
import { CherryIcon, CloseIcon, CopyIcon, RevertIcon } from "./Icons";

interface Props {
  /** The selected commits, in list order (newest first). */
  commits: CommitRow[];
  branch: string | null;
  canChange: boolean;
  onCherryPick: () => void;
  onRevert: () => void;
  onClose: () => void;
}

/** Shown instead of a commit's details while several commits are selected. */
export function MultiSelectPanel({ commits, branch, canChange, onCherryPick, onRevert, onClose }: Props) {
  const merges = commits.filter((commit) => commit.parents.length > 1).length;
  const stashes = commits.some((commit) => commit.kind !== "commit");
  const blocked = merges > 0 ? "Merge commits can only be cherry-picked or reverted one at a time." : stashes ? "Stashes can't be cherry-picked this way." : null;
  const disabled = !canChange || !branch || blocked !== null;
  return (
    <aside className="details" aria-label="Selected commits">
      <header className="details-header">
        <span className="details-label">{commits.length} commits selected</span>
        <span className="spacer" />
        <button className="icon-button" onClick={onClose} title="Clear the selection (Esc)" aria-label="Clear the selection">
          <CloseIcon />
        </button>
      </header>
      <div className="details-scroll">
        <div className="details-actions">
          <button className="outline-button" onClick={onCherryPick} disabled={disabled}>
            <CherryIcon size={14} />
            Cherry-pick {commits.length} onto {branch ?? "HEAD"}
          </button>
          <button className="outline-button" onClick={onRevert} disabled={disabled}>
            <RevertIcon size={14} />
            Revert {commits.length}
          </button>
          <button
            className="outline-button"
            onClick={() => copyText(commits.map((commit) => commit.id).join("\n"))}
          >
            <CopyIcon size={14} />
            Copy SHAs
          </button>
        </div>
        {blocked && <p className="hint">{blocked}</p>}
        <p className="hint">
          Cherry-picking applies them oldest first; reverting undoes them newest first. Shift-click to select a range,{" "}
          {navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl"}-click to add or remove one.
        </p>
        <ul className="selected-commits">
          {commits.map((commit) => (
            <li key={commit.id}>
              <Avatar name={commit.authorName} email={commit.authorEmail} size={18} />
              <span className="mono">{shortId(commit.id)}</span>
              <span className="selected-summary" title={commit.summary}>
                {commit.summary}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
