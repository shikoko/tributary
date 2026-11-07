import { useMemo, useState } from "react";
import { runAction, type CommitRow, type RepoSnapshot } from "../api";
import { ancestors, countMissing } from "../lib/graph";
import { plural, shortId } from "../lib/format";
import { Dialog } from "./Dialog";

interface Props {
  snapshot: RepoSnapshot;
  target: CommitRow;
  onCancel: () => void;
  /** Called with git's result message once the reset worked. */
  onDone: (message: string) => void;
}

/** Asks for confirmation before `git reset --hard`, saying exactly what will be lost. */
export function ResetDialog({ snapshot, target, onCancel, onDone }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branch = snapshot.headBranch ?? "HEAD";

  const { head, leaving, lostFiles, untrackedFiles } = useMemo(() => {
    const byId = new Map(snapshot.commits.map((commit) => [commit.id, commit]));
    const leaving = countMissing(ancestors(snapshot.headCommit, byId), ancestors(target.id, byId));
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
      onDone(await runAction(snapshot.path, { kind: "resetHard", id: target.id }));
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };

  return (
    <Dialog
      title={`Hard reset ${branch}?`}
      error={error}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={running} autoFocus>
            Cancel
          </button>
          <button className="danger-button" onClick={reset} disabled={running}>
            {running ? "Resetting…" : `Reset ${branch}`}
          </button>
        </>
      }
    >
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
    </Dialog>
  );
}

export function CommitRef({ commit }: { commit: CommitRow }) {
  return (
    <span className="commit-ref" title={commit.summary}>
      <code>{shortId(commit.id)}</code> {commit.summary}
    </span>
  );
}
