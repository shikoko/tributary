import { useState } from "react";
import { runAction, type CommitRow } from "../api";
import { shortId } from "../lib/format";
import { Dialog } from "./Dialog";

interface Props {
  repoPath: string;
  target: CommitRow;
  /** The remote to offer pushing the tag to, if there is one. */
  remote: string | null;
  onCancel: () => void;
  /** `name`: the new tag, for undoing. */
  onDone: (message: string, name: string) => void;
}

/** Create a tag on a commit: annotated with a message, or lightweight without one. */
export function TagDialog({ repoPath, target, remote, onCancel, onDone }: Props) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [push, setPush] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const tag = name.trim();
    if (!tag || running) return;
    setRunning(true);
    setError(null);
    try {
      let result = await runAction(repoPath, { kind: "createTag", name: tag, id: target.id, message: message.trim() || null });
      if (push && remote) {
        try {
          await runAction(repoPath, { kind: "pushTag", name: tag, remote });
          result = `${result} and pushed it to ${remote}`;
        } catch (e) {
          // The tag exists now; say why pushing it didn't work.
          setError(`Created tag ${tag}, but pushing it failed:\n\n${String(e)}`);
          setRunning(false);
          return;
        }
      }
      onDone(result, tag);
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };

  return (
    <Dialog
      title="New tag"
      error={error}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={running}>
            Cancel
          </button>
          <button className="primary-small-button" onClick={create} disabled={running || !name.trim()}>
            {running ? "Creating…" : "Create tag"}
          </button>
        </>
      }
    >
      <p>
        On <span className="mono">{shortId(target.id)}</span> {target.summary}
      </p>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input
            className="text-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="v1.2.0"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Message (optional)</span>
          <textarea
            className="text-input"
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="With a message, the tag is annotated: it records who made it and when."
          />
        </label>
        {remote && (
          <label className="checkbox">
            <input type="checkbox" checked={push} onChange={(event) => setPush(event.target.checked)} />
            Push it to {remote}
          </label>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
