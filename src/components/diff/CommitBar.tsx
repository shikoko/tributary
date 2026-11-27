import type { CommitSteps } from "../../lib/diffTargets";
import { relativeTime } from "../../lib/format";
import { isMac } from "../../lib/platform";
import { ChevronDownIcon, ChevronUpIcon } from "../Icons";
import { Button } from "../ui/Button";

const ALT = isMac ? "⌥" : "Alt";

/**
 * Under a commit's file's changes: which commit they're from, and the way to the same file in
 * the newer or older commit (Alt+↑ and Alt+↓), without closing them.
 */
export function CommitBar({ steps }: { steps: CommitSteps }) {
  const { commit, position, total, more, onStep } = steps;
  return (
    <div className="diff-commit-bar" role="group" aria-label="Commit">
      <div className="diff-steps">
        <Button kind="icon" onClick={() => onStep(-1)} disabled={position === 0} title={`Newer commit (${ALT}+↑)`} aria-label="Newer commit">
          <ChevronUpIcon size={14} />
        </Button>
        <Button
          kind="icon"
          onClick={() => onStep(1)}
          disabled={position === total - 1}
          title={`Older commit (${ALT}+↓)`}
          aria-label="Older commit"
        >
          <ChevronDownIcon size={14} />
        </Button>
        <span className="diff-count">
          Commit {(position + 1).toLocaleString()} of {total.toLocaleString()}
          {more ? "+" : ""}
        </span>
      </div>
      <span className="diff-commit-summary" title={commit.summary}>
        {commit.summary}
      </span>
      <span className="diff-commit-who">
        {commit.authorName} · {relativeTime(commit.time)}
      </span>
      <span className="diff-commit-keys" aria-hidden="true">
        {ALT} + ↑ ↓ for a newer or older commit
      </span>
    </div>
  );
}
