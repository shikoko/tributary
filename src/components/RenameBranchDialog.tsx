import { useState } from "react";
import { runAction } from "../api";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";

interface Props {
  repoPath: string;
  branch: string;
  onCancel: () => void;
  onDone: (message: string, newName: string) => void;
}

export function RenameBranchDialog({ repoPath, branch, onCancel, onDone }: Props) {
  const [name, setName] = useState(branch);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = name.trim() === branch || !name.trim();

  const rename = async () => {
    if (unchanged || running) return;
    setRunning(true);
    setError(null);
    try {
      onDone(await runAction(repoPath, { kind: "renameBranch", name: branch, newName: name.trim() }), name.trim());
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };

  return (
    <Dialog
      title={`Rename ${branch}`}
      error={error}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="secondary" onClick={onCancel} disabled={running}>
            Cancel
          </Button>
          <Button kind="primary" onClick={rename} disabled={running || unchanged}>
            {running ? "Renaming…" : "Rename"}
          </Button>
        </>
      }
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          rename();
        }}
      >
        <Field label="New name">
          <input
            className="text-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onFocus={(event) => event.currentTarget.select()}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
          />
        </Field>
      </form>
    </Dialog>
  );
}
