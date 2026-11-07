import { useMemo, useState } from "react";
import { runAction, type FileChange, type WorktreeStatus } from "../api";
import { plural } from "../lib/format";
import { baseName, folderOf } from "../lib/paths";
import { Dialog } from "./Dialog";

interface Props {
  repoPath: string;
  status: WorktreeStatus;
  /** The files to start with; all of them when left out. */
  paths?: string[];
  onCancel: () => void;
  onDone: (message: string) => void;
}

/** Saves some or all of the uncommitted changes as a stash, with an optional message. */
export function StashDialog({ repoPath, status, paths, onCancel, onDone }: Props) {
  // Each changed file once (a file can be both staged and changed again), without conflicts.
  const files = useMemo(() => {
    const byPath = new Map<string, FileChange>();
    for (const file of [...status.staged, ...status.unstaged]) {
      if (file.status !== "conflicted" && !byPath.has(file.path)) byPath.set(file.path, file);
    }
    return [...byPath.values()];
  }, [status]);
  const tracked = files.filter((file) => file.status !== "untracked");
  const [message, setMessage] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(() => {
    if (paths) return new Set(files.filter((file) => paths.includes(file.path)).map((file) => file.path));
    // Untracked files only when they're all there is, as git stash does by default.
    return new Set((tracked.length > 0 ? tracked : files).map((file) => file.path));
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (path: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const picked = files.filter((file) => chosen.has(file.path));
  const includeUntracked = picked.some((file) => file.status === "untracked");
  // Everything git stashes anyway: no need to list the files.
  const everything = tracked.every((file) => chosen.has(file.path)) && (includeUntracked ? picked.length === files.length : true);

  const stash = async () => {
    if (picked.length === 0) return;
    setRunning(true);
    setError(null);
    try {
      const list = everything ? [] : picked.flatMap((file) => (file.oldPath ? [file.oldPath, file.path] : [file.path]));
      onDone(await runAction(repoPath, { kind: "stashPush", message: message.trim() || null, includeUntracked, paths: list }));
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
          <button className="link-button dialog-note" onClick={() => setChosen(new Set(chosen.size === files.length ? [] : files.map((f) => f.path)))}>
            {chosen.size === files.length ? "Select none" : "Select all"}
          </button>
          <button className="secondary-button" onClick={onCancel} disabled={running}>
            Cancel
          </button>
          <button className="primary-small-button" onClick={stash} disabled={running || picked.length === 0}>
            {running ? "Stashing…" : everything ? "Stash" : `Stash ${plural(picked.length, "file")}`}
          </button>
        </>
      }
    >
      <p>The changes you pick are saved and removed from the working tree. Apply the stash to get them back.</p>
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
        <ul className="stash-files">
          {files.map((file) => (
            <li key={file.path}>
              <label className="checkbox">
                <input type="checkbox" checked={chosen.has(file.path)} onChange={() => toggle(file.path)} />
                <span className="stash-file-name">{baseName(file.path)}</span>
                <span className="stash-file-dir">{file.status === "untracked" ? "new" : folderOf(file.path)}</span>
              </label>
            </li>
          ))}
        </ul>
      </form>
    </Dialog>
  );
}
