import { useState } from "react";
import type { Action } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { LostCommitsNote } from "./Safety";

/** Delete a local branch, saying first exactly which commits would be lost. */
export function DeleteBranchDialog({
  repoPath,
  branch,
  retryFor,
  onCancel,
  onDone,
}: {
  repoPath: string;
  branch: string;
  retryFor: (error: string) => { label: string; action: Action } | null;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  // Once the commits that would be lost have been shown, git needn't ask again.
  const [checked, setChecked] = useState(false);
  return (
    <ConfirmDialog
      repoPath={repoPath}
      title={`Delete ${branch}?`}
      confirmLabel="Delete branch"
      busyLabel="Deleting…"
      danger
      action={{ kind: "deleteBranch", name: branch, force: checked }}
      retryFor={retryFor}
      onCancel={onCancel}
      onDone={onDone}
    >
      <LostCommitsNote
        repoPath={repoPath}
        reference={`refs/heads/${branch}`}
        name={branch}
        onChecked={(lost) => setChecked(lost !== null)}
      />
    </ConfirmDialog>
  );
}

/** Delete a branch from its remote, saying first which commits only it has. */
export function DeleteRemoteBranchDialog({
  repoPath,
  name,
  remote,
  branch,
  onCancel,
  onDone,
}: {
  repoPath: string;
  /** Like "origin/feat/x". */
  name: string;
  remote: string;
  branch: string;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  return (
    <ConfirmDialog
      repoPath={repoPath}
      title={`Delete ${branch} from ${remote}?`}
      confirmLabel="Delete from remote"
      busyLabel="Deleting…"
      danger
      action={{ kind: "deleteRemoteBranch", name }}
      onCancel={onCancel}
      onDone={onDone}
    >
      <p>
        <strong>{name}</strong> will be removed from the remote, for everyone who uses it. Local branches are kept.
      </p>
      <LostCommitsNote repoPath={repoPath} reference={`refs/remotes/${name}`} name={name} />
    </ConfirmDialog>
  );
}
