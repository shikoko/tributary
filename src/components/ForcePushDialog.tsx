import { useState } from "react";
import { runAction, type RepoSnapshot } from "../api";
import { Dialog } from "./Dialog";
import { TypeToConfirm } from "./Safety";

interface Props {
  snapshot: RepoSnapshot;
  /** The checked-out branch, when it's protected: its name must be typed to go ahead. */
  protectedName?: string | null;
  onCancel: () => void;
  onDone: (message: string) => void;
}

/** Asks for confirmation before `git push --force-with-lease`. */
export function ForcePushDialog({ snapshot, protectedName, onCancel, onDone }: Props) {
  const [typed, setTyped] = useState("");
  const confirmed = !protectedName || typed.trim() === protectedName;
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
          <button className="secondary-button" onClick={onCancel} disabled={running} autoFocus={!protectedName}>
            Cancel
          </button>
          <button className="danger-button" onClick={push} disabled={running || !confirmed}>
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
      {protectedName && <TypeToConfirm name={protectedName} value={typed} onChange={setTyped} />}
    </Dialog>
  );
}
