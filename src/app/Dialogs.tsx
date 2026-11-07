import type { Action, CommitDetails, CommitRow, RepoSnapshot } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DeleteBranchDialog, DeleteRemoteBranchDialog } from "../components/DeleteBranchDialogs";
import { ForcePushDialog } from "../components/ForcePushDialog";
import { InteractiveRebaseDialog } from "../components/InteractiveRebaseDialog";
import { PruneLfsDialog } from "../components/LfsCleanup";
import { NewBranchDialog } from "../components/NewBranchDialog";
import { PruneDialog } from "../components/PruneDialog";
import { RecoverDialog } from "../components/RecoverDialog";
import { RenameBranchDialog } from "../components/RenameBranchDialog";
import { ResetDialog } from "../components/ResetDialog";
import { RestoreDialog } from "../components/RestoreDialog";
import { ProtectedActionDialog } from "../components/Safety";
import { StashDialog } from "../components/StashDialog";
import { TagDialog } from "../components/TagDialog";
import { baseName } from "../lib/paths";
import { deleteAnyway, splitRemoteBranch, type OpenDialog } from "../menus";
import type { Running } from "./constants";

interface Props {
  dialog: OpenDialog;
  snapshot: RepoSnapshot;
  byId: Map<string, CommitRow>;
  /** The checked-out branch, or "HEAD". */
  branchLabel: string;
  /** The checked-out branch, if it's protected. */
  protectedHead: string | null;
  protectedBranches: string[];
  pins: string[];
  loadDetails: (id: string) => Promise<CommitDetails>;
  run: (action: Action, kind?: Running, options?: { quiet?: boolean; confirmed?: boolean }) => unknown;
  select: (id: string) => void;
  /** Open another dialog. */
  open: (dialog: OpenDialog) => void;
  onClose: () => void;
  /** A dialog did its action: show the message (with an undo), and reload. */
  onFinish: (message: string, undo?: Action) => void;
  /** Locks were changed outside the usual actions. */
  onLocksChanged: () => void;
}

/** The dialog that's open over a repository, if any. */
export function RepositoryDialogs(props: Props) {
  const { dialog, snapshot, byId, branchLabel, protectedHead, protectedBranches, pins, loadDetails, run, select, open, onClose, onFinish, onLocksChanged } = props;
  return (
    <>
    {dialog?.kind === "reset" && (
      <ResetDialog
        snapshot={snapshot}
        target={dialog.target}
        protectedName={dialog.target.id === snapshot.headCommit ? null : protectedHead}
        onCancel={() => onClose()}
        onDone={(message) => {
          const before = snapshot.headCommit;
          if (dialog.target.id !== before) select(dialog.target.id);
          onFinish(message, before && dialog.target.id !== before ? { kind: "resetHard", id: before } : undefined);
        }}
      />
    )}
    {dialog?.kind === "newBranch" && (
      <NewBranchDialog
        repoPath={snapshot.path}
        target={dialog.target}
        canCheckout={!snapshot.bare}
        onCancel={() => onClose()}
        onDone={(message) => onFinish(message)}
      />
    )}
    {dialog?.kind === "tag" && (
      <TagDialog
        repoPath={snapshot.path}
        target={dialog.target}
        remote={snapshot.remotes.includes("origin") ? "origin" : (snapshot.remotes[0] ?? null)}
        onCancel={() => onClose()}
        onDone={(message, name) => onFinish(message, { kind: "deleteTag", name })}
      />
    )}
    {dialog?.kind === "interactiveRebase" && (
      <InteractiveRebaseDialog
        branch={branchLabel}
        onto={dialog.onto}
        commits={dialog.commits}
        loadDetails={loadDetails}
        onCancel={() => onClose()}
        onStart={(steps) => {
          onClose();
          run({ kind: "interactiveRebase", onto: dialog.onto.id, steps });
        }}
      />
    )}
    {dialog?.kind === "prune" && (
      <PruneDialog
        repoPath={snapshot.path}
        fetchFirst={snapshot.remotes.length > 0}
        pinned={pins}
        protectedNames={protectedBranches}
        onCancel={() => onClose()}
        onDelete={(branches) => {
          onClose();
          run({ kind: "deleteBranches", branches });
        }}
      />
    )}
    {dialog?.kind === "restore" && (
      <RestoreDialog
        repoPath={snapshot.path}
        onCancel={() => onClose()}
        onRestore={(backup) => {
          onClose();
          run({ kind: "restoreBackup", reference: backup.reference }, "other", { quiet: false });
        }}
      />
    )}
    {dialog?.kind === "protectedAction" && (
      <ProtectedActionDialog
        branch={dialog.branch}
        title={`Rewrite ${dialog.branch}?`}
        explanation={`${dialog.action.kind === "interactiveRebase" ? "This interactive rebase" : "Rebasing"} rewrites ${dialog.branch}'s history: its commits get new ids, so anyone who already has them will have to reconcile. Tributary keeps a backup of where it was.`}
        confirmLabel={dialog.action.kind === "interactiveRebase" ? "Start rebase" : `Rebase ${dialog.branch}`}
        onCancel={() => onClose()}
        onConfirm={() => {
          onClose();
          run(dialog.action, "other", { confirmed: true });
        }}
      />
    )}
    {dialog?.kind === "forcePush" && (
      <ForcePushDialog
        snapshot={snapshot}
        protectedName={protectedHead}
        onCancel={() => onClose()}
        onDone={(message) => onFinish(message)}
      />
    )}
    {dialog?.kind === "stash" && snapshot.worktree && (
      <StashDialog
        repoPath={snapshot.path}
        status={snapshot.worktree}
        paths={dialog.paths}
        onCancel={() => onClose()}
        onDone={(message) => onFinish(message)}
      />
    )}
    {dialog?.kind === "rename" && (
      <RenameBranchDialog
        repoPath={snapshot.path}
        branch={dialog.branch}
        onCancel={() => onClose()}
        onDone={(message, newName) =>
          onFinish(message, { kind: "renameBranch", name: newName, newName: dialog.branch })
        }
      />
    )}
    {dialog?.kind === "deleteBranch" && (
      <DeleteBranchDialog
        repoPath={snapshot.path}
        branch={dialog.branch}
        retryFor={deleteAnyway(dialog.branch)}
        onCancel={() => onClose()}
        onDone={(message) => {
          // Undo puts it back as it was, tracking the same remote branch.
          const label = byId.get(dialog.commitId)?.refs.find((ref) => ref.kind === "branch" && ref.name === dialog.branch);
          const upstream = label?.upstream ? splitRemoteBranch(label.upstream, snapshot.remotes) : null;
          onFinish(message, {
            kind: "restoreBranches",
            branches: [
              {
                name: dialog.branch,
                id: dialog.commitId,
                remote: upstream?.remote ?? null,
                merge: upstream ? `refs/heads/${upstream.branch}` : null,
              },
            ],
          });
        }}
      />
    )}
    {dialog?.kind === "deleteRemoteBranch" && (
      <DeleteRemoteBranchDialog
        repoPath={snapshot.path}
        name={dialog.name}
        remote={splitRemoteBranch(dialog.name, snapshot.remotes).remote}
        branch={splitRemoteBranch(dialog.name, snapshot.remotes).branch}
        onCancel={() => onClose()}
        onDone={(message) => {
          const commit = snapshot.commits.find((c) => c.refs.some((ref) => ref.kind === "remote" && ref.name === dialog.name));
          onFinish(message, commit ? { kind: "restoreRemoteBranch", name: dialog.name, id: commit.id } : undefined);
        }}
      />
    )}
    {dialog?.kind === "deleteTag" && (
      <ConfirmDialog
        repoPath={snapshot.path}
        title={`Delete tag ${dialog.name}?`}
        confirmLabel="Delete tag"
        busyLabel="Deleting…"
        danger
        action={{ kind: "deleteTag", name: dialog.name }}
        onCancel={() => onClose()}
        onDone={(message) => onFinish(message, { kind: "restoreTag", name: dialog.name, id: dialog.restoreId })}
      >
        <p>The tag is removed from this repository. Copies of it on remotes are kept.</p>
      </ConfirmDialog>
    )}
    {dialog?.kind === "deleteRemoteTag" && (
      <ConfirmDialog
        repoPath={snapshot.path}
        title={`Delete ${dialog.name} from ${dialog.remote}?`}
        confirmLabel="Delete from remote"
        busyLabel="Deleting…"
        danger
        action={{ kind: "deleteRemoteTag", name: dialog.name, remote: dialog.remote }}
        onCancel={() => onClose()}
        onDone={(message) => onFinish(message)}
      >
        <p>
          The tag will be removed from <strong>{dialog.remote}</strong>, for everyone who uses it. The tag in this
          repository is kept.
        </p>
      </ConfirmDialog>
    )}
    {dialog?.kind === "forceUnlock" && (
      <ConfirmDialog
        repoPath={snapshot.path}
        title={`Unlock ${baseName(dialog.lock.path)}?`}
        confirmLabel="Force unlock"
        busyLabel="Unlocking…"
        danger
        action={{ kind: "unlockFiles", locks: [{ id: dialog.lock.id, path: dialog.lock.path }], force: true }}
        onCancel={() => onClose()}
        onDone={(message) => {
          onFinish(message);
          onLocksChanged();
        }}
      >
        <p>
          <strong>{dialog.lock.owner || "Someone else"}</strong> locked <strong>{dialog.lock.path}</strong>. If they're still
          working on it, their changes and yours will clash, and one of you will lose work. Check with them first.
        </p>
      </ConfirmDialog>
    )}
    {dialog?.kind === "recover" && (
      <RecoverDialog
        repoPath={snapshot.path}
        isLoaded={(id) => byId.has(id)}
        truncated={snapshot.truncated}
        onCancel={() => onClose()}
        onShow={(id) => {
          onClose();
          select(id);
        }}
        onCreateBranch={(entry) =>
          open({
            kind: "newBranch",
            target: { id: entry.id, summary: entry.summary, kind: "commit", refs: [], parents: [] } as unknown as CommitRow,
          })
        }
      />
    )}
    {dialog?.kind === "pruneLfs" && (
      <PruneLfsDialog repoPath={snapshot.path} onCancel={() => onClose()} onDone={(message) => onFinish(message)} />
    )}
    {dialog?.kind === "dropStash" && (
      <ConfirmDialog
        repoPath={snapshot.path}
        title={`Drop ${dialog.label}?`}
        confirmLabel="Drop stash"
        busyLabel="Dropping…"
        danger
        action={{ kind: "stashDrop", index: dialog.index, id: dialog.id }}
        onCancel={() => onClose()}
        onDone={(message) => onFinish(message)}
      >
        <p>The changes saved in this stash will be gone.</p>
      </ConfirmDialog>
    )}
    </>
  );
}
