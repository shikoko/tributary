import { useMemo, useState } from "react";
import { resetHard, type CommitRow, type RepoSnapshot } from "../api";
import { plural, shortId } from "../lib/format";

interface Props {
  snapshot: RepoSnapshot;
  target: CommitRow;
  onCancel: () => void;
  onDone: () => void;
}

/** Commits reachable from `start` through loaded parents. */
function ancestors(start: string | null, byId: Map<string, CommitRow>): Set<string> {
  const seen = new Set<string>();
  const stack = start ? [start] : [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const commit = byId.get(id);
    if (seen.has(id) || !commit || commit.kind !== "commit") continue;
    seen.add(id);
    stack.push(...commit.parents);
  }
  return seen;
}

/** Asks for confirmation before `git reset --hard`, saying exactly what will be lost. */
export function ResetDialog({ snapshot, target, onCancel, onDone }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branch = snapshot.headBranch ?? "HEAD";

  const { head, leaving, lostFiles, untrackedFiles } = useMemo(() => {
    const byId = new Map(snapshot.commits.map((commit) => [commit.id, commit]));
    const kept = ancestors(target.id, byId);
    const leaving = [...ancestors(snapshot.headCommit, byId)].filter((id) => !kept.has(id)).length;
    const changes = [...(snapshot.worktree?.staged ?? []), ...(snapshot.worktree?.unstaged ?? [])];
    const lost = new Set(changes.filter((f) => f.status !== "untracked").map((f) => f.path));
    const untracked = changes.filter((f) => f.status === "untracked").length;
    const head = snapshot.headCommit ? byId.get(snapshot.headCommit) : undefined;
    return { head, leaving, lostFiles: lost.size, untrackedFiles: untracked };
  }, [snapshot, target]);

  const reset = async () => {
    setRunning(true);
    setError(null);
    try {
      await resetHard(snapshot.path, target.id);
      onDone();
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={() => !running && onCancel()}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !running) {
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id="reset-title">Hard reset {branch}?</h2>
        <p>
          <strong>{branch}</strong> will point to <CommitRef commit={target} />
          {head && head.id !== target.id && (
            <>
              {" "}
              instead of <CommitRef commit={head} />
            </>
          )}
          , and your files will be changed to match it.
        </p>
        <ul className="dialog-consequences">
          {leaving > 0 && (
            <li>
              {plural(leaving, "commit")} will no longer be on {branch}. You can still get them back with{" "}
              <code>git reflog</code> for a while.
            </li>
          )}
          {lostFiles > 0 && (
            <li className="danger">
              Uncommitted changes to {plural(lostFiles, "file")} will be discarded. This can't be undone.
            </li>
          )}
          {untrackedFiles > 0 && <li>Untracked files are kept.</li>}
          {leaving === 0 && lostFiles === 0 && <li>No commits or uncommitted changes will be lost.</li>}
        </ul>
        {error && <div className="error-banner">{error}</div>}
        <div className="dialog-buttons">
          <button className="secondary-button" onClick={onCancel} disabled={running} autoFocus>
            Cancel
          </button>
          <button className="danger-button" onClick={reset} disabled={running}>
            {running ? "Resetting…" : `Reset ${branch}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommitRef({ commit }: { commit: CommitRow }) {
  return (
    <span className="commit-ref" title={commit.summary}>
      <code>{shortId(commit.id)}</code> {commit.summary}
    </span>
  );
}
