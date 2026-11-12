import { useMemo, useState } from "react";
import { runAction, type CommitRow, type RepoSnapshot } from "../api";
import { ancestors, countMissing } from "../lib/graph";
import { plural, shortId } from "../lib/format";
import { Dialog } from "./Dialog";
import { TypeToConfirm } from "./Safety";
import { Button } from "./ui/Button";

interface Props {
  snapshot: RepoSnapshot;
  target: CommitRow;
  /** The checked-out branch, when it's protected: its name must be typed to go ahead. */
  protectedName?: string | null;
  onCancel: () => void;
  /** Called with git's result message once the reset worked. */
  onDone: (message: string) => void;
  /** Throw away every uncommitted change, new files too, to undo later (the action's runner does it). */
  onDiscardAll: () => void;
}

/**
 * Asks for confirmation before `git reset --hard`, saying exactly what will be lost. To the
 * checked-out commit, it only discards uncommitted changes: then new files go too, and it can
 * be undone (except while a merge or rebase is under way, which a reset ends).
 */
export function ResetDialog({ snapshot, target, protectedName, onCancel, onDone, onDiscardAll }: Props) {
  const [typed, setTyped] = useState("");
  const confirmed = !protectedName || typed.trim() === protectedName;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branch = snapshot.headBranch ?? "HEAD";
  // Resetting to the current commit only throws away uncommitted changes.
  const discardOnly = target.id === snapshot.headCommit;
  // That's discarding them all, new files too, to put back later; not in a merge or a rebase.
  const discardAll = discardOnly && !snapshot.operation;

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
      title={discardOnly ? "Discard all uncommitted changes?" : `Hard reset ${branch}?`}
      error={error}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="secondary" onClick={onCancel} disabled={running} autoFocus={!protectedName}>
            Cancel
          </Button>
          <Button kind="danger" onClick={discardAll ? onDiscardAll : reset} disabled={running || !confirmed}>
            {running ? (discardOnly ? "Discarding…" : "Resetting…") : discardOnly ? "Discard changes" : `Reset ${branch}`}
          </Button>
        </>
      }
    >
      {discardAll ? (
        <p>Your files will be changed back to how they are in the last commit, and new files will be deleted.</p>
      ) : discardOnly ? (
        <p>Your files will be changed back to how they are in the last commit.</p>
      ) : (
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
      )}
      <ul className="dialog-consequences">
        {leaving > 0 && (
          <li>
            {plural(leaving, "commit")} will no longer be on {branch}. You can still get them back with{" "}
            <code>git reflog</code> for a while.
          </li>
        )}
        {discardAll ? (
          <>
            {lostFiles > 0 && <li className="danger">Changes to {plural(lostFiles, "file")} will be discarded.</li>}
            {untrackedFiles > 0 && <li className="danger">{plural(untrackedFiles, "new file")} will be deleted.</li>}
            <li>You can put them back with Undo, for 30 days.</li>
          </>
        ) : (
          <>
            {lostFiles > 0 && (
              <li className="danger">
                Uncommitted changes to {plural(lostFiles, "file")} will be discarded. This can't be undone.
              </li>
            )}
            {untrackedFiles > 0 && <li>New files are kept.</li>}
            {leaving === 0 && lostFiles === 0 && <li>No commits or uncommitted changes will be lost.</li>}
          </>
        )}
      </ul>
      {protectedName && <TypeToConfirm name={protectedName} value={typed} onChange={setTyped} />}
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
