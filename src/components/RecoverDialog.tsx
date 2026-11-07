import { useEffect, useMemo, useState } from "react";
import { reflog, type ReflogEntry } from "../api";
import { relativeTime, shortId } from "../lib/format";
import { Dialog } from "./Dialog";

interface Props {
  repoPath: string;
  /** Whether a commit is in the loaded history (reachable from a branch, remote branch or tag). */
  isLoaded: (id: string) => boolean;
  /** The history wasn't loaded completely, so "on no branch" is a guess for old commits. */
  truncated: boolean;
  onCancel: () => void;
  onShow: (id: string) => void;
  onCreateBranch: (entry: ReflogEntry) => void;
}

/** "reset: moving to HEAD~2" → ["Reset", "moving to HEAD~2"]. */
export function describeReflog(message: string): { action: string; detail: string } {
  const colon = message.indexOf(": ");
  const kind = colon > 0 ? message.slice(0, colon) : message;
  const detail = colon > 0 ? message.slice(colon + 2) : "";
  const names: Record<string, string> = {
    commit: "Commit",
    "commit (amend)": "Amend",
    "commit (initial)": "First commit",
    "commit (merge)": "Merge commit",
    checkout: "Checkout",
    reset: "Reset",
    merge: "Merge",
    pull: "Pull",
    "pull --rebase": "Pull (rebase)",
    "cherry-pick": "Cherry-pick",
    revert: "Revert",
    clone: "Clone",
  };
  const action = names[kind] ?? (kind.startsWith("rebase") ? "Rebase" : kind[0]?.toUpperCase() + kind.slice(1));
  return { action, detail };
}

/**
 * HEAD's reflog: everything that moved HEAD, newest first. Commits that are on no branch
 * any more (after a reset, a rebase, a deleted branch, …) can be given a branch again.
 */
export function RecoverDialog({ repoPath, isLoaded, truncated, onCancel, onShow, onCreateBranch }: Props) {
  const [entries, setEntries] = useState<ReflogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyLost, setOnlyLost] = useState(false);
  useEffect(() => {
    reflog(repoPath, 400)
      .then(setEntries)
      .catch((e) => setError(String(e)));
  }, [repoPath]);

  // Each commit once, at its most recent entry.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (entries ?? []).filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  }, [entries]);
  const lostCount = rows.filter((entry) => !isLoaded(entry.id)).length;
  const shown = onlyLost ? rows.filter((entry) => !isLoaded(entry.id)) : rows;

  return (
    <Dialog
      title="Recover commits"
      wide
      error={error}
      onCancel={onCancel}
      buttons={
        <>
          <label className="checkbox small dialog-note">
            <input type="checkbox" checked={onlyLost} onChange={(event) => setOnlyLost(event.target.checked)} />
            Only commits on no branch ({lostCount})
          </label>
          <button className="secondary-button" onClick={onCancel}>
            Close
          </button>
        </>
      }
    >
      <p className="hint">
        Everything that moved HEAD here (commits, checkouts, resets, rebases…), newest first, from git's reflog. A commit
        that's on no branch any more can get a branch again.
        {truncated && " Only the loaded history is checked, so older commits may show as on no branch."}
      </p>
      {entries === null ? (
        !error && <p className="hint">Reading…</p>
      ) : shown.length === 0 ? (
        <p className="hint">{onlyLost ? "Every commit here is on a branch." : "Nothing recorded yet."}</p>
      ) : (
        <ul className="recover-list">
          {shown.map((entry) => {
            const loaded = isLoaded(entry.id);
            const { action, detail } = describeReflog(entry.message);
            return (
              <li key={`${entry.id}:${entry.time}`} className={`recover-row${loaded ? "" : " lost"}`}>
                <div className="recover-main">
                  <div className="recover-top">
                    <span className="recover-action">{action}</span>
                    <span className="recover-detail" title={entry.message}>
                      {detail}
                    </span>
                    <span className="recover-when">{relativeTime(entry.time)}</span>
                  </div>
                  <div className="recover-commit">
                    <span className="mono">{shortId(entry.id)}</span> {entry.summary}
                    {!loaded && <span className="recover-lost">on no branch</span>}
                  </div>
                </div>
                {loaded ? (
                  <button className="outline-button" onClick={() => onShow(entry.id)}>
                    <span className="button-label">Show</span>
                  </button>
                ) : (
                  <button className="outline-button" onClick={() => onCreateBranch(entry)}>
                    <span className="button-label">Create branch…</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
