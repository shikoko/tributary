import { useEffect, useState } from "react";
import { branchBackups, runAction, type Backup, type BackupEvent } from "../api";
import { relativeTime, shortId } from "../lib/format";
import { Dialog } from "./Dialog";
import { CloseIcon } from "./Icons";
import { Button } from "./ui/Button";

interface Props {
  repoPath: string;
  onCancel: () => void;
  onRestore: (backup: Backup) => void;
}

const EVENTS: Record<BackupEvent, string> = {
  deleted: "Deleted",
  deletedFromRemote: "Deleted from the remote",
  forcePushed: "Replaced by a force push",
  reset: "Reset",
  rebased: "Rebased",
};

/** What restoring a backup will do, in a few words. */
function outcome(backup: Backup): string {
  const leaf = backup.remote ? backup.name.slice(backup.name.indexOf("/") + 1) : backup.name;
  if (backup.event === "forcePushed") return `Creates the local branch ${leaf}-before-force-push`;
  if (backup.remote) {
    return backup.current === null ? `Pushes it back to ${backup.name.split("/")[0]}` : `Creates the local branch ${leaf}-restored`;
  }
  if (backup.current === null) return `Recreates ${backup.name}`;
  if (backup.current === backup.id) return `${backup.name} is already there, as it was`;
  return `${backup.name} has moved on, so this creates ${backup.name}-restored`;
}

/**
 * Where branches were before Tributary deleted, reset, rebased or force-pushed them, for
 * the last 30 days. Restoring never overwrites anything.
 */
export function RestoreDialog({ repoPath, onCancel, onRestore }: Props) {
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    branchBackups(repoPath)
      .then(setBackups)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);
  const remove = async (backup: Backup) => {
    try {
      await runAction(repoPath, { kind: "removeBackup", reference: backup.reference });
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Dialog
      title="Restore a branch"
      wide
      error={error}
      onCancel={onCancel}
      buttons={
        <Button kind="secondary" onClick={onCancel}>
          Close
        </Button>
      }
    >
      <p className="hint">
        Whenever Tributary deletes, resets, rebases or force-pushes a branch, it keeps where the branch was for 30 days.
        Restoring never overwrites anything: if a branch has moved on since, its earlier version comes back beside it.
      </p>
      {backups === null ? (
        !error && <p className="hint">Looking…</p>
      ) : backups.length === 0 ? (
        <p className="hint">Nothing to restore yet.</p>
      ) : (
        <ul className="restore-list">
          {backups.map((backup) => (
            <li key={backup.reference} className="restore-row">
              <div className="restore-main">
                <div className="restore-top">
                  <span className="restore-name">{backup.name}</span>
                  <span className={`restore-event ${backup.event}`}>{EVENTS[backup.event] ?? backup.event}</span>
                  <span className="restore-when">{relativeTime(backup.time)}</span>
                </div>
                <div className="restore-commit">
                  <span className="mono">{shortId(backup.id)}</span> {backup.summary}
                </div>
                <div className="restore-outcome">{outcome(backup)}</div>
              </div>
              <Button
                kind="outline"
                onClick={() => onRestore(backup)}
                disabled={!backup.remote && backup.current === backup.id}
              >
                <span className="button-label">Restore</span>
              </Button>
              <Button kind="icon" className="restore-remove" onClick={() => remove(backup)} title="Forget this backup" aria-label="Forget this backup">
                <CloseIcon size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
