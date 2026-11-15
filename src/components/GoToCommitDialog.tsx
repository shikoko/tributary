import { useState } from "react";
import { findCommit } from "../api";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";

interface Props {
  repoPath: string;
  onCancel: () => void;
  /** The commit it found, to go to. */
  onFound: (id: string) => void;
}

/** Go to Commit (Ctrl+G): a commit by its id or the start of it, a branch, a tag, or a day. */
export function GoToCommitDialog({ repoPath, onCancel, onFound }: Props) {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    const text = query.trim();
    if (!text || running) return;
    setRunning(true);
    setError(null);
    try {
      const id = await findCommit(repoPath, text);
      if (id) {
        onFound(id);
        return;
      }
      setError(`There's no commit, branch or tag called "${text}".`);
    } catch (e) {
      setError(String(e));
    }
    setRunning(false);
  };

  return (
    <Dialog
      title="Go to commit"
      error={error}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="secondary" onClick={onCancel} disabled={running}>
            Cancel
          </Button>
          <Button kind="primary" onClick={go} disabled={running || !query.trim()}>
            Go
          </Button>
        </>
      }
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void go();
        }}
      >
        <Field label="A commit's id, a branch, a tag, or a day">
          <input
            className="text-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError(null);
            }}
            placeholder="a1b2c3d, main, v1.2 or 2026-10-01"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
          />
        </Field>
        <p className="hint">A day goes to the last commit made by its end, in any branch. Older history loads if it's needed.</p>
      </form>
    </Dialog>
  );
}
