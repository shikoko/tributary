import type { Operation } from "../api";
import { plural } from "../lib/format";

interface Props {
  operation: Operation;
  branch: string;
  /** Files that still have conflicts. */
  conflicts: number;
  /** What the two sides are called, like "main" and "feat/x". */
  sides: { mine: string; theirs: string };
  busy: boolean;
  onContinue: () => void;
  onSkip: () => void;
  onAbort: () => void;
  onShowFiles: () => void;
  /** Take one side's version of every conflicted file. */
  onKeepAll: (keep: "mine" | "theirs") => void;
}

const NAMES = { merge: "merge", rebase: "rebase", cherryPick: "cherry-pick", revert: "revert", applyPatches: "patches", other: "operation" };

/** Shown while a merge, rebase, cherry-pick or revert waits for conflicts to be resolved. */
export function OperationBar({ operation, branch, conflicts, sides, busy, onContinue, onSkip, onAbort, onShowFiles, onKeepAll }: Props) {
  const name = NAMES[operation.kind];
  if (operation.kind === "other") {
    return (
      <div className="operation-bar" role="status">
        <span>A git operation is in progress. Finish it in a terminal.</span>
      </div>
    );
  }
  const next = operation.kind === "merge" ? "commit" : "continue";
  return (
    <div className="operation-bar" role="status">
      <span className="operation-text">
        <span className="operation-title">
          {operation.kind === "merge" ? "Merging into" : operation.kind === "applyPatches" ? "Applying patches on" : `${name[0].toUpperCase()}${name.slice(1)} in progress on`}{" "}
          <strong>{branch}</strong>.
        </span>{" "}
        {conflicts > 0 ? (
          <>
            <button className="link-button" onClick={onShowFiles}>
              {plural(conflicts, "file")} with conflicts
            </button>
            : pick a version of each, or fix and stage them, then {next}.
          </>
        ) : (
          <>No conflicts left: {next} when you're ready.</>
        )}
      </span>
      <span className="operation-buttons">
        {conflicts > 0 ? (
          <>
            <button className="secondary-button" onClick={() => onKeepAll("mine")} disabled={busy} title={`Keep ${sides.mine}'s version of every conflicted file`}>
              Keep all mine
            </button>
            <button className="secondary-button" onClick={() => onKeepAll("theirs")} disabled={busy} title={`Take ${sides.theirs}'s version of every conflicted file`}>
              Take all theirs
            </button>
          </>
        ) : (
          <button className="primary-small-button" onClick={onContinue} disabled={busy}>
            {operation.kind === "merge" ? "Commit merge" : "Continue"}
          </button>
        )}
        {operation.kind !== "merge" && (
          <button className="secondary-button" onClick={onSkip} disabled={busy} title={operation.kind === "applyPatches" ? "Leave out this patch" : "Leave out this commit"}>
            {operation.kind === "applyPatches" ? "Skip patch" : "Skip commit"}
          </button>
        )}
        <button className="danger-outline-button" onClick={onAbort} disabled={busy}>
          {operation.kind === "applyPatches" ? "Stop applying" : `Abort ${name}`}
        </button>
      </span>
    </div>
  );
}
