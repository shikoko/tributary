import type { Action, CommitDetails, CommitRow, PullRequest, RepoSnapshot, Worktree } from "../api";
import { CreatePullRequestDialog } from "../components/CreatePullRequestDialog";
import { BisectDialog } from "../components/BisectDialog";
import { ancestors, countMissing } from "../lib/graph";
import { shortId } from "../lib/format";
import { openInBrowser, webRemote } from "../lib/weblinks";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DeleteBranchDialog, DeleteRemoteBranchDialog } from "../components/DeleteBranchDialogs";
import { ForcePushDialog } from "../components/ForcePushDialog";
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
  worktrees: Worktree[];
  /** Local branch names. */
  localBranches: string[];
  /** Open a working tree in a tab. */
  openWorktree: (path: string) => void;
  /** Push the checked-out branch: resolves to whether it worked. */
  push: () => Promise<boolean>;
  onRequestCreated: (pr: PullRequest) => void;
  /** Sign in to GitHub, in Settings. */
  signIn: () => void;
  /** Open Settings, at a section. */
  openSettings: (section: string) => void;
  /** Say something briefly, like "Copied the release notes". */
  notify: (text: string) => void;
}

/** The dialog that's open over a repository, if any. */
export function RepositoryDialogs(props: Props) {
  const { dialog, snapshot, byId, branchLabel, protectedHead, protectedBranches, pins, loadDetails, run, select, open, onClose, onFinish, onLocksChanged } = props;
  const { worktrees, localBranches, openWorktree } = props;
  return (
    <>
    {dialog?.kind === "bisect" && snapshot.headCommit && (
      <BisectDialog
        good={dialog.good}
        bad={{
          id: snapshot.headCommit,
          label: snapshot.headBranch ?? shortId(snapshot.headCommit),
          summary: byId.get(snapshot.headCommit)?.summary ?? "",
        }}
        between={countMissing(ancestors(snapshot.headCommit, byId), ancestors(dialog.good.id, byId))}
        onCancel={onClose}
        onStart={() => {
          onClose();
          run({ kind: "bisectStart", bad: snapshot.headCommit!, good: dialog.good.id });
        }}
      />
    )}
    {dialog?.kind === "createPullRequest" && (
      <CreatePullRequestDialog
        repoPath={snapshot.path}
        branch={dialog.branch}
        local={dialog.local}
        checkedOut={dialog.local !== null && dialog.local === snapshot.headBranch}
        browserUrl={dialog.url}
        onCancel={onClose}
        onCreated={props.onRequestCreated}
        openUrl={openInBrowser}
        push={props.push}
        signIn={props.signIn}
      />
    )}
    {dialog?.kind === "reset" && (
      <ResetDialog
        snapshot={snapshot}
        target={dialog.target}
        protectedName={dialog.target.id === snapshot.headCommit ? null : protectedHead}
        onCancel={() => onClose()}
        onDiscardAll={() => {
          onClose();
          run({ kind: "discardAll" });
        }}
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
    {dialog?.kind === "ignoreReason" && (
      <IgnoreReasonDialog repoPath={snapshot.path} file={dialog.file} canChange={!snapshot.bare} onClose={() => onClose()} run={(action) => run(action)} />
    )}
    {dialog?.kind === "localHistory" && (
      <LocalHistoryDialog
        repoPath={snapshot.path}
        file={dialog.file}
        canChange={!snapshot.bare}
        run={(action) => run(action)}
        onOpenSettings={() => props.openSettings("Local history")}
        onClose={() => onClose()}
      />
    )}
    {dialog?.kind === "shelves" && (
      <ShelvesDialog
        repoPath={snapshot.path}
        status={snapshot.bare ? null : snapshot.worktree}
        paths={dialog.paths}
        head={snapshot.headCommit}
        canChange={!snapshot.bare}
        run={async (action, kind) => Boolean(await run(action, kind))}
        onClose={() => onClose()}
      />
    )}
    {dialog?.kind === "projectSetup" && (
      <ProjectSetupDialog
        repoPath={snapshot.path}
        canChange={!snapshot.bare}
        run={async (action) => run(action, "other", { quiet: true })}
        onOpenSize={() => open({ kind: "repoSize" })}
        onClose={() => onClose()}
      />
    )}
    {dialog?.kind === "repoSize" && (
      <RepoSizeDialog
        repoPath={snapshot.path}
        canChange={!snapshot.bare}
        branch={snapshot.headBranch}
        onClose={() => onClose()}
        run={(action) => run(action)}
      />
    )}
    {dialog?.kind === "releaseNotes" && (
      <ReleaseNotesDialog
        repoPath={snapshot.path}
        tag={dialog.tag}
        site={(() => {
          const remote = webRemote(snapshot);
          return remote?.host === "github" ? "GitHub" : remote?.host === "gitlab" ? "GitLab" : null;
        })()}
        onClose={() => onClose()}
        notify={props.notify}
        openUrl={openInBrowser}
      />
    )}
    {dialog?.kind === "splitCommit" && (
      <SplitCommitDialog
        commit={dialog.commit}
        later={dialog.later}
        loadDetails={loadDetails}
        onCancel={() => onClose()}
        onSplit={(paths, first, second) => {
          onClose();
          run({ kind: "splitCommit", id: dialog.commit.id, paths, first, second });
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
        explanation={`${dialog.action.kind === "interactiveRebase" ? "This interactive rebase" : dialog.action.kind === "fixupInto" ? "Fixing up an earlier commit" : dialog.action.kind === "splitCommit" ? "Splitting a commit" : dialog.action.kind === "restack" ? "Moving it onto the new branch below" : dialog.action.kind === "migrateToLfs" ? "Moving files into Git LFS" : "Rebasing"} rewrites ${dialog.branch}'s history: its commits get new ids, so anyone who already has them will have to reconcile. Tributary keeps a backup of where it was.`}
        confirmLabel={
          dialog.action.kind === "interactiveRebase"
            ? "Start rebase"
            : dialog.action.kind === "fixupInto"
              ? "Fix it up"
              : dialog.action.kind === "splitCommit"
                ? "Split it"
                : dialog.action.kind === "restack"
                  ? "Move it"
                  : dialog.action.kind === "migrateToLfs"
                    ? "Rewrite it"
                    : `Rebase ${dialog.branch}`
        }
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
    {dialog?.kind === "applyPatch" && (
      <ApplyPatchDialog repoPath={snapshot.path} file={dialog.file} branch={snapshot.headBranch} onCancel={() => onClose()} onDone={(message) => onFinish(message)} />
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
    {dialog?.kind === "newWorktree" && (
      <NewWorktreeDialog
        repoPath={snapshot.path}
        repoName={snapshot.name}
        branches={localBranches}
        worktrees={worktrees}
        branch={dialog.branch}
        start={dialog.start}
        onCancel={onClose}
        onDone={(message, path, openIt) => {
          onFinish(message);
          if (openIt) openWorktree(path);
        }}
      />
    )}
    {dialog?.kind === "removeWorktree" && (
      <ConfirmDialog
        repoPath={snapshot.path}
        title={`Remove the worktree of ${dialog.worktree.branch ?? "a detached HEAD"}?`}
        confirmLabel="Remove worktree"
        busyLabel="Removing…"
        danger
        action={{ kind: "removeWorktree", path: dialog.worktree.path }}
        retryFor={(error) =>
          error.includes("uncommitted changes")
            ? { label: "Remove anyway", action: { kind: "removeWorktree", path: dialog.worktree.path, force: true } }
            : null
        }
        onCancel={onClose}
        onDone={(message) => onFinish(message)}
      >
        <p>
          This deletes the folder <strong>{dialog.worktree.path}</strong>.
          {dialog.worktree.branch ? <> The branch {dialog.worktree.branch} and its commits stay.</> : null}
        </p>
      </ConfirmDialog>
    )}
    </>
  );
}
