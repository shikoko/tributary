import { CreatePullRequestDialog } from "../components/CreatePullRequestDialog";
import { BisectDialog } from "../components/BisectDialog";
import { ancestors, countMissing, goodChoices } from "../lib/graph";
import { shortId } from "../lib/format";
import { openInBrowser, webRemote } from "../lib/weblinks";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DeleteBranchDialog, DeleteRemoteBranchDialog } from "../components/DeleteBranchDialogs";
import { ForcePushDialog } from "../components/ForcePushDialog";
import { ChooseUpstreamDialog } from "../components/ChooseUpstreamDialog";
import { InteractiveRebaseDialog } from "../components/InteractiveRebaseDialog";
import { PruneLfsDialog } from "../components/LfsCleanup";
import { NewBranchDialog } from "../components/NewBranchDialog";
import { NewWorktreeDialog } from "../components/NewWorktreeDialog";
import { PruneDialog } from "../components/PruneDialog";
import { ApplyPatchDialog } from "../components/ApplyPatchDialog";
import { RecoverDialog } from "../components/RecoverDialog";
import { RenameBranchDialog } from "../components/RenameBranchDialog";
import { ResetDialog } from "../components/ResetDialog";
import { RestoreDialog } from "../components/RestoreDialog";
import { ProtectedActionDialog } from "../components/Safety";
import { IgnoreReasonDialog } from "../components/IgnoreReasonDialog";
import { ReleaseNotesDialog } from "../components/ReleaseNotesDialog";
import { RepoSizeDialog } from "../components/RepoSizeDialog";
import { ProjectSetupDialog } from "../components/ProjectSetupDialog";
import { SplitCommitDialog } from "../components/SplitCommitDialog";
import { StashDialog } from "../components/StashDialog";
import { ShelvesDialog } from "../components/ShelvesDialog";
import { LocalHistoryDialog } from "../components/LocalHistoryDialog";
import { TagDialog } from "../components/TagDialog";
import { GoToCommitDialog } from "../components/GoToCommitDialog";
import { baseName } from "../lib/paths";
import { deleteAnyway, splitRemoteBranch, type OpenDialog } from "../menus";
import type { CommitRow } from "../api";
import { useOpenRepository } from "./OpenRepository";

/** The dialogs shown elsewhere: cloning on the start screen, and a repository's settings in RepositoryView. */
type Elsewhere = "clone" | "repoSettings";
type Kind = Exclude<NonNullable<OpenDialog>["kind"], Elsewhere>;
/** What a dialog over the repository is given: which it is, and what it was opened with. */
type Shown<K extends Kind> = { dialog: Extract<NonNullable<OpenDialog>, { kind: K }> };

function GoToCommit(_: Shown<"goToCommit">) {
  const { closeDialog, goTo, snapshot } = useOpenRepository();
  return (
    <GoToCommitDialog
      repoPath={snapshot.path}
      onCancel={() => closeDialog()}
      onFound={(id) => {
        closeDialog();
        goTo(id);
      }}
    />
  );
}

function Bisect({ dialog }: Shown<"bisect">) {
  const { act, byId, closeDialog, snapshot } = useOpenRepository();
  const head = snapshot.headCommit;
  if (!head) return null;
  const before = ancestors(head, byId);
  return (
    <BisectDialog
      good={dialog.good ?? goodChoices(head, byId)}
      bad={{ id: head, label: snapshot.headBranch ?? shortId(head), summary: byId.get(head)?.summary ?? "" }}
      between={(good) => countMissing(before, ancestors(good.id, byId))}
      onCancel={closeDialog}
      onStart={(good) => {
        closeDialog();
        act({ kind: "bisectStart", bad: head, good: good.id });
      }}
    />
  );
}

function CreatePullRequest({ dialog }: Shown<"createPullRequest">) {
  const { closeDialog, push, requestCreated, signIn, snapshot } = useOpenRepository();
  return (
    <CreatePullRequestDialog
      repoPath={snapshot.path}
      branch={dialog.branch}
      local={dialog.local}
      checkedOut={dialog.local !== null && dialog.local === snapshot.headBranch}
      browserUrl={dialog.url}
      onCancel={closeDialog}
      onCreated={requestCreated}
      openUrl={openInBrowser}
      push={push}
      signIn={signIn}
    />
  );
}

function Reset({ dialog }: Shown<"reset">) {
  const { act, closeDialog, finished, protectedHead, select, snapshot } = useOpenRepository();
  return (
    <ResetDialog
      snapshot={snapshot}
      target={dialog.target}
      protectedName={dialog.target.id === snapshot.headCommit ? null : protectedHead}
      onCancel={() => closeDialog()}
      onDiscardAll={() => {
        closeDialog();
        act({ kind: "discardAll" });
      }}
      onDone={(message) => {
        const before = snapshot.headCommit;
        if (dialog.target.id !== before) select(dialog.target.id);
        finished(message, before && dialog.target.id !== before ? { kind: "resetHard", id: before } : undefined);
      }}
    />
  );
}

function NewBranch({ dialog }: Shown<"newBranch">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <NewBranchDialog
      repoPath={snapshot.path}
      target={dialog.target}
      canCheckout={!snapshot.bare}
      onCancel={() => closeDialog()}
      onDone={(message) => finished(message)}
    />
  );
}

function Tag({ dialog }: Shown<"tag">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <TagDialog
      repoPath={snapshot.path}
      target={dialog.target}
      remote={snapshot.remotes.includes("origin") ? "origin" : (snapshot.remotes[0] ?? null)}
      onCancel={() => closeDialog()}
      onDone={(message, name) => finished(message, { kind: "deleteTag", name })}
    />
  );
}

function InteractiveRebase({ dialog }: Shown<"interactiveRebase">) {
  const { act, branchLabel, closeDialog, loadDetails } = useOpenRepository();
  return (
    <InteractiveRebaseDialog
      branch={branchLabel}
      onto={dialog.onto}
      commits={dialog.commits}
      loadDetails={loadDetails}
      onCancel={() => closeDialog()}
      onStart={(steps) => {
        closeDialog();
        act({ kind: "interactiveRebase", onto: dialog.onto.id, steps });
      }}
    />
  );
}

function IgnoreReason({ dialog }: Shown<"ignoreReason">) {
  const { act, closeDialog, snapshot } = useOpenRepository();
  return (
    <IgnoreReasonDialog repoPath={snapshot.path} file={dialog.file} canChange={!snapshot.bare} onClose={() => closeDialog()} run={(action) => act(action)} />
  );
}

function LocalHistory({ dialog }: Shown<"localHistory">) {
  const { act, closeDialog, openSettings, snapshot } = useOpenRepository();
  return (
    <LocalHistoryDialog
      repoPath={snapshot.path}
      file={dialog.file}
      canChange={!snapshot.bare}
      run={(action) => act(action)}
      onOpenSettings={() => openSettings("Local history")}
      onClose={() => closeDialog()}
    />
  );
}

function Shelves({ dialog }: Shown<"shelves">) {
  const { act, closeDialog, snapshot } = useOpenRepository();
  return (
    <ShelvesDialog
      repoPath={snapshot.path}
      status={snapshot.bare ? null : snapshot.worktree}
      paths={dialog.paths}
      head={snapshot.headCommit}
      canChange={!snapshot.bare}
      run={async (action) => Boolean(await act(action))}
      onClose={() => closeDialog()}
    />
  );
}

function ProjectSetup(_: Shown<"projectSetup">) {
  const { act, closeDialog, openDialog, snapshot } = useOpenRepository();
  return (
    <ProjectSetupDialog
      repoPath={snapshot.path}
      canChange={!snapshot.bare}
      run={async (action) => act(action, { quiet: true })}
      onOpenSize={() => openDialog({ kind: "repoSize" })}
      onClose={() => closeDialog()}
    />
  );
}

function RepoSize(_: Shown<"repoSize">) {
  const { act, closeDialog, snapshot } = useOpenRepository();
  return (
    <RepoSizeDialog
      repoPath={snapshot.path}
      canChange={!snapshot.bare}
      branch={snapshot.headBranch}
      onClose={() => closeDialog()}
      run={(action) => act(action)}
    />
  );
}

function ReleaseNotes({ dialog }: Shown<"releaseNotes">) {
  const { closeDialog, notify, snapshot } = useOpenRepository();
  return (
    <ReleaseNotesDialog
      repoPath={snapshot.path}
      tag={dialog.tag}
      site={(() => {
        const remote = webRemote(snapshot);
        return remote?.host === "github" ? "GitHub" : remote?.host === "gitlab" ? "GitLab" : null;
      })()}
      onClose={() => closeDialog()}
      notify={notify}
      openUrl={openInBrowser}
    />
  );
}

function SplitCommit({ dialog }: Shown<"splitCommit">) {
  const { act, closeDialog, loadDetails } = useOpenRepository();
  return (
    <SplitCommitDialog
      commit={dialog.commit}
      later={dialog.later}
      loadDetails={loadDetails}
      onCancel={() => closeDialog()}
      onSplit={(paths, first, second) => {
        closeDialog();
        act({ kind: "splitCommit", id: dialog.commit.id, paths, first, second });
      }}
    />
  );
}

function Prune(_: Shown<"prune">) {
  const { act, closeDialog, pins, protectedBranches, snapshot } = useOpenRepository();
  return (
    <PruneDialog
      repoPath={snapshot.path}
      fetchFirst={snapshot.remotes.length > 0}
      pinned={pins}
      protectedNames={protectedBranches}
      onCancel={() => closeDialog()}
      onDelete={(branches) => {
        closeDialog();
        act({ kind: "deleteBranches", branches });
      }}
    />
  );
}

function Restore(_: Shown<"restore">) {
  const { act, closeDialog, snapshot } = useOpenRepository();
  return (
    <RestoreDialog
      repoPath={snapshot.path}
      onCancel={() => closeDialog()}
      onRestore={(backup) => {
        closeDialog();
        act({ kind: "restoreBackup", reference: backup.reference }, { quiet: false });
      }}
    />
  );
}

function ProtectedAction({ dialog }: Shown<"protectedAction">) {
  const { act, closeDialog } = useOpenRepository();
  return (
    <ProtectedActionDialog
      branch={dialog.branch}
      title={`Rewrite ${dialog.branch}?`}
      explanation={`${dialog.rewrite.what} rewrites ${dialog.branch}'s history: its commits get new ids, so anyone who already has them will have to reconcile. Tributary keeps a backup of where it was.`}
      confirmLabel={dialog.rewrite.confirm}
      onCancel={() => closeDialog()}
      onConfirm={() => {
        closeDialog();
        act(dialog.action, { confirmed: true });
      }}
    />
  );
}

function ChooseUpstream({ dialog }: Shown<"chooseUpstream">) {
  const { act, closeDialog, localBranches, snapshot } = useOpenRepository();
  return (
    <ChooseUpstreamDialog
      repoPath={snapshot.path}
      branch={dialog.branch}
      localBranches={localBranches}
      onCancel={() => closeDialog()}
      onChoose={(action) => {
        closeDialog();
        act(action);
      }}
    />
  );
}

function ForcePush({ dialog }: Shown<"forcePush">) {
  const { act, closeDialog, protectedHead, snapshot } = useOpenRepository();
  return (
    <ForcePushDialog
      snapshot={snapshot}
      reason={dialog.reason}
      overwrite={dialog.overwrite}
      protectedName={protectedHead}
      onCancel={() => closeDialog()}
      onPush={(overwrite) => {
        closeDialog();
        act({ kind: "push", force: true, overwrite });
      }}
    />
  );
}

function Stash({ dialog }: Shown<"stash">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  if (!(snapshot.worktree)) return null;
  return (
    <StashDialog
      repoPath={snapshot.path}
      status={snapshot.worktree}
      paths={dialog.paths}
      onCancel={() => closeDialog()}
      onDone={(message) => finished(message)}
    />
  );
}

function Rename({ dialog }: Shown<"rename">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <RenameBranchDialog
      repoPath={snapshot.path}
      branch={dialog.branch}
      onCancel={() => closeDialog()}
      onDone={(message, newName) =>
        finished(message, { kind: "renameBranch", name: newName, newName: dialog.branch })
      }
    />
  );
}

function DeleteBranch({ dialog }: Shown<"deleteBranch">) {
  const { byId, closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <DeleteBranchDialog
      repoPath={snapshot.path}
      branch={dialog.branch}
      retryFor={deleteAnyway(dialog.branch)}
      onCancel={() => closeDialog()}
      onDone={(message) => {
        // Undo puts it back as it was, tracking the same remote branch.
        const label = byId.get(dialog.commitId)?.refs.find((ref) => ref.kind === "branch" && ref.name === dialog.branch);
        const upstream = label?.upstream ? splitRemoteBranch(label.upstream, snapshot.remotes) : null;
        finished(message, {
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
  );
}

function DeleteRemoteBranch({ dialog }: Shown<"deleteRemoteBranch">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <DeleteRemoteBranchDialog
      repoPath={snapshot.path}
      name={dialog.name}
      remote={splitRemoteBranch(dialog.name, snapshot.remotes).remote}
      branch={splitRemoteBranch(dialog.name, snapshot.remotes).branch}
      onCancel={() => closeDialog()}
      onDone={(message) => {
        const commit = snapshot.commits.find((c) => c.refs.some((ref) => ref.kind === "remote" && ref.name === dialog.name));
        finished(message, commit ? { kind: "restoreRemoteBranch", name: dialog.name, id: commit.id } : undefined);
      }}
    />
  );
}

function DeleteTag({ dialog }: Shown<"deleteTag">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <ConfirmDialog
      repoPath={snapshot.path}
      title={`Delete tag ${dialog.name}?`}
      confirmLabel="Delete tag"
      busyLabel="Deleting…"
      danger
      action={{ kind: "deleteTag", name: dialog.name }}
      onCancel={() => closeDialog()}
      onDone={(message) => finished(message, { kind: "restoreTag", name: dialog.name, id: dialog.restoreId })}
    >
      <p>The tag is removed from this repository. Copies of it on remotes are kept.</p>
    </ConfirmDialog>
  );
}

function DeleteRemoteTag({ dialog }: Shown<"deleteRemoteTag">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <ConfirmDialog
      repoPath={snapshot.path}
      title={`Delete ${dialog.name} from ${dialog.remote}?`}
      confirmLabel="Delete from remote"
      busyLabel="Deleting…"
      danger
      action={{ kind: "deleteRemoteTag", name: dialog.name, remote: dialog.remote }}
      onCancel={() => closeDialog()}
      onDone={(message) => finished(message)}
    >
      <p>
        The tag will be removed from <strong>{dialog.remote}</strong>, for everyone who uses it. The tag in this
        repository is kept.
      </p>
    </ConfirmDialog>
  );
}

function ForceUnlock({ dialog }: Shown<"forceUnlock">) {
  const { closeDialog, finished, locksChanged, snapshot } = useOpenRepository();
  return (
    <ConfirmDialog
      repoPath={snapshot.path}
      title={`Unlock ${baseName(dialog.lock.path)}?`}
      confirmLabel="Force unlock"
      busyLabel="Unlocking…"
      danger
      action={{ kind: "unlockFiles", locks: [{ id: dialog.lock.id, path: dialog.lock.path }], force: true }}
      onCancel={() => closeDialog()}
      onDone={(message) => {
        finished(message);
        locksChanged();
      }}
    >
      <p>
        <strong>{dialog.lock.owner || "Someone else"}</strong> locked <strong>{dialog.lock.path}</strong>. If they're still
        working on it, their changes and yours will clash, and one of you will lose work. Check with them first.
      </p>
    </ConfirmDialog>
  );
}

function ApplyPatch({ dialog }: Shown<"applyPatch">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <ApplyPatchDialog repoPath={snapshot.path} file={dialog.file} branch={snapshot.headBranch} onCancel={() => closeDialog()} onDone={(message) => finished(message)} />
  );
}

function Recover(_: Shown<"recover">) {
  const { byId, closeDialog, openDialog, select, snapshot } = useOpenRepository();
  return (
    <RecoverDialog
      repoPath={snapshot.path}
      isLoaded={(id) => byId.has(id)}
      truncated={snapshot.truncated}
      onCancel={() => closeDialog()}
      onShow={(id) => {
        closeDialog();
        select(id);
      }}
      onCreateBranch={(entry) =>
        openDialog({
          kind: "newBranch",
          target: { id: entry.id, summary: entry.summary, kind: "commit", refs: [], parents: [] } as unknown as CommitRow,
        })
      }
    />
  );
}

function PruneLfs(_: Shown<"pruneLfs">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <PruneLfsDialog repoPath={snapshot.path} onCancel={() => closeDialog()} onDone={(message) => finished(message)} />
  );
}

function DropStash({ dialog }: Shown<"dropStash">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <ConfirmDialog
      repoPath={snapshot.path}
      title={`Drop ${dialog.label}?`}
      confirmLabel="Drop stash"
      busyLabel="Dropping…"
      danger
      action={{ kind: "stashDrop", index: dialog.index, id: dialog.id }}
      onCancel={() => closeDialog()}
      onDone={(message) => finished(message)}
    >
      <p>The changes saved in this stash will be gone.</p>
    </ConfirmDialog>
  );
}

function NewWorktree({ dialog }: Shown<"newWorktree">) {
  const { closeDialog, finished, localBranches, openTab, snapshot, worktrees } = useOpenRepository();
  return (
    <NewWorktreeDialog
      repoPath={snapshot.path}
      repoName={snapshot.name}
      branches={localBranches}
      worktrees={worktrees}
      branch={dialog.branch}
      start={dialog.start}
      onCancel={closeDialog}
      onDone={(message, path, openIt) => {
        finished(message);
        if (openIt) openTab(path);
      }}
    />
  );
}

function RemoveWorktree({ dialog }: Shown<"removeWorktree">) {
  const { closeDialog, finished, snapshot } = useOpenRepository();
  return (
    <ConfirmDialog
      repoPath={snapshot.path}
      title={`Remove the worktree of ${dialog.worktree.branch ?? "a detached HEAD"}?`}
      confirmLabel="Remove worktree"
      busyLabel="Removing…"
      danger
      action={{ kind: "removeWorktree", path: dialog.worktree.path }}
      retryFor={(error) =>
        error.kind?.kind === "worktreeChanged"
          ? { label: "Remove anyway", action: { kind: "removeWorktree", path: dialog.worktree.path, force: true } }
          : null
      }
      onCancel={closeDialog}
      onDone={(message) => finished(message)}
    >
      <p>
        This deletes the folder <strong>{dialog.worktree.path}</strong>.
        {dialog.worktree.branch ? <> The branch {dialog.worktree.branch} and its commits stay.</> : null}
      </p>
    </ConfirmDialog>
  );
}

/** Each dialog over a repository, by its kind. Every kind has one, or is shown elsewhere. */
const DIALOGS: { [K in Kind]: (props: Shown<K>) => React.ReactNode } = {
  goToCommit: GoToCommit,
  bisect: Bisect,
  createPullRequest: CreatePullRequest,
  reset: Reset,
  newBranch: NewBranch,
  tag: Tag,
  interactiveRebase: InteractiveRebase,
  ignoreReason: IgnoreReason,
  localHistory: LocalHistory,
  shelves: Shelves,
  projectSetup: ProjectSetup,
  repoSize: RepoSize,
  releaseNotes: ReleaseNotes,
  splitCommit: SplitCommit,
  prune: Prune,
  restore: Restore,
  protectedAction: ProtectedAction,
  chooseUpstream: ChooseUpstream,
  forcePush: ForcePush,
  stash: Stash,
  rename: Rename,
  deleteBranch: DeleteBranch,
  deleteRemoteBranch: DeleteRemoteBranch,
  deleteTag: DeleteTag,
  deleteRemoteTag: DeleteRemoteTag,
  forceUnlock: ForceUnlock,
  applyPatch: ApplyPatch,
  recover: Recover,
  pruneLfs: PruneLfs,
  dropStash: DropStash,
  newWorktree: NewWorktree,
  removeWorktree: RemoveWorktree,
};

/** The dialog that's open over a repository, if any. */
export function RepositoryDialogs({ dialog }: { dialog: OpenDialog }) {
  if (!dialog || dialog.kind === "clone" || dialog.kind === "repoSettings") return null;
  const Dialog = DIALOGS[dialog.kind] as (props: { dialog: typeof dialog }) => React.ReactNode;
  return <Dialog dialog={dialog} />;
}
