import type { Operation } from "../api";
import { plural } from "../lib/format";

interface Props {
  operation: Operation;
  branch: string;
  /** Files that still have conflicts. */
  conflicts: number;
  busy: boolean;
  onContinue: () => void;
  onSkip: () => void;
  onAbort: () => void;
  onShowFiles: () => void;
}

const NAMES = { merge: "merge", rebase: "rebase", cherryPick: "cherry-pick", revert: "revert", other: "operation" };

/** Shown while a merge, rebase, cherry-pick or revert waits for conflicts to be resolved. */
export function OperationBar({ operation, branch, conflicts, busy, onContinue, onSkip, onAbort, onShowFiles }: Props) {
  const name = NAMES[operation.kind];
  if (operation.kind === "other") {
    return (
      <div className="operation-bar" role="status">
        <span>A git operation (like <code>git am</code> or <code>git bisect</code>) is in progress. Finish it in a terminal.</span>
      </div>
    );
  }
  const next = operation.kind === "merge" ? "commit" : "continue";
  return (
    <div className="operation-bar" role="status">
      <span className="operation-title">
        {operation.kind === "merge" ? "Merging into" : `${name[0].toUpperCase()}${name.slice(1)} in progress on`}{" "}
        <strong>{branch}</strong>
      </span>
      <span className="operation-help">
        {conflicts > 0 ? (
          <>
            <button className="link-button" onClick={onShowFiles}>
              {plural(conflicts, "file")} with conflicts
            </button>
            : fix them, stage them, then {next}.
          </>
        ) : (
          <>No conflicts left: {next} when you're ready.</>
        )}
      </span>
      <span className="operation-buttons">
        <button className="primary-small-button" onClick={onContinue} disabled={busy || conflicts > 0}>
          {operation.kind === "merge" ? "Commit merge" : "Continue"}
        </button>
        {operation.kind !== "merge" && (
          <button className="secondary-button" onClick={onSkip} disabled={busy} title="Leave out this commit">
            Skip commit
          </button>
        )}
        <button className="danger-outline-button" onClick={onAbort} disabled={busy}>
          Abort {name}
        </button>
      </span>
    </div>
  );
}
