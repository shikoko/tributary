import { useState } from "react";
import { runAction, type Action, type CommitRow } from "../api";
import { involvesUntrackedFiles, isLocalChangesError } from "../lib/errors";
import { Dialog } from "./Dialog";
import { CommitRef } from "./ResetDialog";

interface Props {
  repoPath: string;
  target: CommitRow;
  /** False when checking out isn't possible (a bare repository). */
  canCheckout: boolean;
  onCancel: () => void;
  onDone: (message: string) => void;
}

/** Asks for a name, then creates a branch at `target`, optionally checking it out. */
export function NewBranchDialog({ repoPath, target, canCheckout, onCancel, onDone }: Props) {
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(canCheckout);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: Action) => {
    setRunning(true);
    setError(null);
    try {
      onDone(await runAction(repoPath, action));
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };
  const createAction = (): Action => ({ kind: "createBranch", name: name.trim(), id: target.id, checkout });
  const create = () => {
    if (name.trim() && !running) run(createAction());
  };
  // Checking out failed because of uncommitted changes: offer to stash them around it.
  const stashRetry =
    error && checkout && isLocalChangesError(error)
      ? {
          label: "Stash changes and retry",
          onClick: () =>
            run({ kind: "stashAndRetry", action: createAction(), includeUntracked: involvesUntrackedFiles(error) }),
        }
      : null;

  return (
    <Dialog
      title="New branch"
      error={error}
      errorAction={stashRetry}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={running}>
            Cancel
          </button>
          <button className="primary-small-button" onClick={create} disabled={running || !name.trim()}>
            {running ? "Creating…" : "Create branch"}
          </button>
        </>
      }
    >
      <p>
        Starting at <CommitRef commit={target} />
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
            placeholder="feature/my-change"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={checkout}
            disabled={!canCheckout}
            onChange={(event) => setCheckout(event.target.checked)}
          />
          Check out the new branch
        </label>
      </form>
    </Dialog>
  );
}
