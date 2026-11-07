import { useState } from "react";
import { runAction, type WorktreeStatus } from "../api";
import { plural } from "../lib/format";
import { Dialog } from "./Dialog";

interface Props {
  repoPath: string;
  status: WorktreeStatus;
  onCancel: () => void;
  onDone: (message: string) => void;
}

/** Saves uncommitted changes as a stash, with an optional message. */
export function StashDialog({ repoPath, status, onCancel, onDone }: Props) {
  const untracked = status.unstaged.filter((file) => file.status === "untracked").length;
  const tracked = status.staged.length + status.unstaged.length - untracked;
  const [message, setMessage] = useState("");
  // Stash everything by default when untracked files are all there is.
  const [includeUntracked, setIncludeUntracked] = useState(tracked === 0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stash = async () => {
    setRunning(true);
    setError(null);
    try {
      onDone(await runAction(repoPath, { kind: "stashPush", message: message.trim() || null, includeUntracked }));
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };

  return (
    <Dialog
      title="Stash changes"
      error={error}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={running}>
            Cancel
          </button>
          <button className="primary-small-button" onClick={stash} disabled={running}>
            {running ? "Stashing…" : "Stash"}
          </button>
        </>
      }
    >
      <p>Your uncommitted changes are saved and removed from the working tree. Apply the stash to get them back.</p>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          stash();
        }}
      >
        <label className="field">
          <span>Message (optional)</span>
          <input
            className="text-input"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What were you working on?"
            autoFocus
          />
        </label>
        {untracked > 0 && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeUntracked}
              onChange={(event) => setIncludeUntracked(event.target.checked)}
            />
            Include {plural(untracked, "untracked file")}
          </label>
        )}
      </form>
    </Dialog>
  );
}
