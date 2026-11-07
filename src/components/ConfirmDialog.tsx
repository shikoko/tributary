import { useState, type ReactNode } from "react";
import { runAction, type Action } from "../api";
import { Dialog } from "./Dialog";

interface Props {
  repoPath: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  danger?: boolean;
  action: Action;
  /** After a failure: an alternative to offer, like "Delete anyway". */
  retryFor?: (error: string) => { label: string; action: Action } | null;
  onCancel: () => void;
  onDone: (message: string) => void;
}

/** Asks before running `action`, and shows git's error if it fails. */
export function ConfirmDialog(props: Props) {
  const { repoPath, title, children, confirmLabel, busyLabel, danger, action, retryFor, onCancel, onDone } = props;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (what: Action) => {
    setRunning(true);
    setError(null);
    try {
      onDone(await runAction(repoPath, what));
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };
  const retry = error && retryFor ? retryFor(error) : null;

  return (
    <Dialog
      title={title}
      error={error}
      errorAction={retry && { label: retry.label, onClick: () => run(retry.action) }}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={running} autoFocus>
            Cancel
          </button>
          <button className={danger ? "danger-button" : "primary-small-button"} onClick={() => run(action)} disabled={running}>
            {running ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
