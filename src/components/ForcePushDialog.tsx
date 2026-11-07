import { useState } from "react";
import { runAction, type RepoSnapshot } from "../api";
import { Dialog } from "./Dialog";

interface Props {
  snapshot: RepoSnapshot;
  onCancel: () => void;
  onDone: (message: string) => void;
}

/** Asks for confirmation before `git push --force-with-lease`. */
export function ForcePushDialog({ snapshot, onCancel, onDone }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branch = snapshot.headBranch ?? "HEAD";
  const target = snapshot.upstream?.name ?? `${snapshot.remotes.includes("origin") ? "origin" : (snapshot.remotes[0] ?? "the remote")}/${branch}`;

  const push = async () => {
    setRunning(true);
    setError(null);
    try {
      onDone(await runAction(snapshot.path, { kind: "push", force: true }));
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };

  return (
    <Dialog
      title={`Force push ${branch}?`}
      error={error}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={running} autoFocus>
            Cancel
          </button>
          <button className="danger-button" onClick={push} disabled={running}>
            {running ? "Force pushing…" : "Force push"}
          </button>
        </>
      }
    >
      <p>
        <strong>{target}</strong> will be replaced with your local <strong>{branch}</strong>.
      </p>
      <ul className="dialog-consequences">
        <li className="danger">Commits on {target} that aren't in your {branch} will be removed from it.</li>
        <li>
          It's a safe force push (<code>--force-with-lease</code>): it stops if someone else pushed to {target}{" "}
          since you last fetched.
        </li>
      </ul>
    </Dialog>
  );
}
