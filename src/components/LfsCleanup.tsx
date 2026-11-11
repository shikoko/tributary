import { useEffect, useState } from "react";
import { lfsStorage, type LfsStorage } from "../api";
import { formatBytes, plural } from "../lib/format";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "./ui/Button";

/** How much space the repository's Git LFS files take here; null while looking, or without LFS. */
function useLfsStorage(repoPath: string): LfsStorage | null | undefined {
  const [storage, setStorage] = useState<LfsStorage | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    lfsStorage(repoPath)
      .then((found) => live && setStorage(found))
      .catch(() => live && setStorage(null));
    return () => {
      live = false;
    };
  }, [repoPath]);
  return storage;
}

/** For Settings: the space LFS files take, with a button to clean up. */
export function LfsStorageSummary({ repoPath, onCleanUp }: { repoPath: string; onCleanUp: () => void }) {
  const storage = useLfsStorage(repoPath);
  if (storage === undefined) return <span className="settings-hint">Measuring…</span>;
  if (storage === null) return <span className="settings-hint">Not used here</span>;
  return (
    <span className="settings-inline">
      <span className="settings-value">{formatBytes(storage.bytes)}</span>
      <Button kind="outline" onClick={onCleanUp} disabled={storage.files === 0}>
        <span className="button-label">Clean up…</span>
      </Button>
    </span>
  );
}

/** Delete local copies of Git LFS files that aren't needed any more (`git lfs prune`). */
export function PruneLfsDialog({ repoPath, onCancel, onDone }: { repoPath: string; onCancel: () => void; onDone: (message: string) => void }) {
  const storage = useLfsStorage(repoPath);
  return (
    <ConfirmDialog
      repoPath={repoPath}
      title="Clean up Git LFS files?"
      confirmLabel="Clean up"
      busyLabel="Cleaning up…"
      action={{ kind: "pruneLfs" }}
      onCancel={onCancel}
      onDone={onDone}
    >
      <p>
        Git LFS keeps a copy of every version of the LFS files you've downloaded
        {storage ? (
          <>
            : <strong>{formatBytes(storage.bytes)}</strong> in {plural(storage.files, "file")} for this repository
          </>
        ) : null}
        . Cleaning up deletes the copies that aren't needed any more: old versions that are already on the server.
      </p>
      <p className="dialog-note-line">
        The files you have checked out, recent commits, and anything you haven't pushed yet are kept.
      </p>
    </ConfirmDialog>
  );
}
