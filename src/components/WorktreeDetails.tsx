import { useEffect, useState } from "react";
import { commitDetails, type Action, type FileChange, type FileChecks, type Lock, type RepoSnapshot } from "../api";
import { formatBytes } from "../lib/format";
import { baseName } from "../lib/paths";
import { plural } from "../lib/format";
import { modKey } from "../lib/platform";
import { FileLine } from "./CommitDetails";
import { CloseIcon, LockIcon, MinusIcon, PlusIcon, StashIcon, TrashIcon, WarningIcon } from "./Icons";

export interface CommitDraft {
  summary: string;
  description: string;
  amend: boolean;
}

export const EMPTY_DRAFT: CommitDraft = { summary: "", description: "", amend: false };

interface Props {
  snapshot: RepoSnapshot;
  /** Runs a git action; resolves to true when it worked. */
  run: (action: Action, options?: { quiet?: boolean }) => Promise<boolean>;
  /** Something is already running. */
  busy: boolean;
  draft: CommitDraft;
  onDraft: (draft: CommitDraft) => void;
  onStash: () => void;
  onDiscard: () => void;
  onClose: () => void;
  /** A file's Git LFS lock. */
  lockOf: (path: string) => Lock | undefined;
  /** Right-click on a file. */
  onFileMenu: (file: FileChange, x: number, y: number) => void;
  /** Big files outside Git LFS and lockable files among the changes. */
  checks: FileChecks | null;
  /** The repository's server supports locking. */
  canLock: boolean;
  /** Help writing the commit message: recent messages and co-authors. */
  messageTools?: React.ReactNode;
}

/** "*.umap" for "Content/Maps/Level.umap"; the path itself for a file without an extension. */
export function lfsPattern(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `*${name.slice(dot)}` : path;
}

/** The "Uncommitted changes" panel: stage and unstage files, then commit. */
export function WorktreeDetailsPanel(props: Props) {
  const { snapshot, run, busy, draft, onDraft, onStash, onDiscard, onClose, lockOf, onFileMenu, checks, canLock } = props;
  const status = snapshot.worktree ?? { staged: [], unstaged: [] };
  const conflicted = status.unstaged.filter((file) => file.status === "conflicted");
  const unstaged = status.unstaged.filter((file) => file.status !== "conflicted");
  const { mine, theirs } = conflictSides(snapshot);
  const resolve = (paths: string[], keep: "mine" | "theirs") => run({ kind: "resolveConflicts", paths, keep });
  // Changed files someone else has locked: pushing them will be refused.
  const lockedByOthers = [...status.staged, ...status.unstaged].filter((file) => {
    const lock = lockOf(file.path);
    return lock && !lock.mine;
  });
  const lockHolders = [...new Set(lockedByOthers.map((file) => lockOf(file.path)!.owner || "someone else"))];
  // Big files that would go into git itself, grouped by the LFS pattern that would catch them.
  const large = checks?.large ?? [];
  const stagedPaths = new Set(status.staged.map((file) => file.path));
  const largeStaged = large.filter((file) => stagedPaths.has(file.path));
  const patterns = [...new Set(large.map((file) => lfsPattern(file.path)))];
  // Lockable files you've changed that nobody holds a lock on yet.
  const unlocked = canLock ? (checks?.lockable ?? []).filter((path) => !lockOf(path)) : [];
  const [confirmLarge, setConfirmLarge] = useState(false);
  useEffect(() => {
    if (largeStaged.length === 0) setConfirmLarge(false);
  }, [largeStaged.length]);
  const [committing, setCommitting] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  // During a merge, cherry-pick or revert, or after a squash merge, start from the message git prepared.
  const prepared = snapshot.operation?.message ?? snapshot.squashMessage ?? null;
  useEffect(() => {
    if (!prepared || draft.summary || draft.description) return;
    const [summary, ...rest] = prepared.split("\n");
    onDraft({ summary, description: rest.join("\n").trim(), amend: false });
  }, [prepared]);

  // Amending starts from the last commit's message.
  useEffect(() => {
    if (!draft.amend || draft.summary || !snapshot.headCommit) return;
    let cancelled = false;
    commitDetails(snapshot.path, snapshot.headCommit).then(
      (details) => {
        if (cancelled) return;
        setLastMessage(details.summary);
        onDraft({ ...draft, summary: details.summary, description: details.body });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [draft.amend]);

  const canCommit =
    !busy && !committing && draft.summary.trim() !== "" && (status.staged.length > 0 || draft.amend) && !snapshot.bare;
  const commit = async (anyway = false) => {
    if (!canCommit) return;
    // Big files committed outside Git LFS stay in every clone forever: ask first.
    if (largeStaged.length > 0 && !anyway) {
      setConfirmLarge(true);
      return;
    }
    setConfirmLarge(false);
    setCommitting(true);
    const message = draft.description.trim()
      ? `${draft.summary.trim()}\n\n${draft.description.trim()}`
      : draft.summary.trim();
    const done = await run({ kind: "commit", message, amend: draft.amend });
    setCommitting(false);
    if (done) onDraft({ summary: "", description: "", amend: false });
  };
  const toggleAmend = (amend: boolean) => {
    // Turning amend off again clears the message it filled in.
    if (!amend && draft.summary === lastMessage) onDraft({ summary: "", description: "", amend });
    else onDraft({ ...draft, amend });
  };
  const paths = (file: FileChange) => (file.oldPath ? [file.oldPath, file.path] : [file.path]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  return (
    <aside className="details" aria-label="Uncommitted changes">
      <header className="details-header">
        <span className="details-label">Working tree</span>
        <span className="spacer" />
        <button className="icon-button" onClick={onStash} disabled={busy} title="Stash changes…" aria-label="Stash changes">
          <StashIcon />
        </button>
        <button
          className="icon-button"
          onClick={onDiscard}
          disabled={busy || !snapshot.headCommit}
          title="Discard all changes…"
          aria-label="Discard all changes"
        >
          <TrashIcon />
        </button>
        <button className="icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close details">
          <CloseIcon />
        </button>
      </header>

      <div className="details-scroll worktree">
        {lockedByOthers.length > 0 && (
          <div className="lock-warning" role="status">
            <LockIcon size={13} />
            <span>
              {lockedByOthers.length === 1 ? (
                <>
                  <strong>{lockedByOthers[0].path.split("/").pop()}</strong> is locked by {lockHolders[0]}
                </>
              ) : (
                <>
                  {plural(lockedByOthers.length, "changed file")} are locked by {lockHolders.join(", ")}
                </>
              )}
              . You won't be able to push {lockedByOthers.length === 1 ? "your changes to it" : "them"} until{" "}
              {lockedByOthers.length === 1 ? "it's" : "they're"} unlocked.
            </span>
          </div>
        )}
        {large.length > 0 && (
          <div className="file-warning large" role="status">
            <WarningIcon size={14} />
            <div>
              <div>
                {large.length === 1 ? (
                  <>
                    <strong>{baseName(large[0].path)}</strong> ({formatBytes(large[0].size)}) isn't stored with Git LFS.
                  </>
                ) : (
                  <>
                    {large.length} big files ({formatBytes(large.reduce((sum, file) => sum + file.size, 0))}) aren't stored with
                    Git LFS.
                  </>
                )}{" "}
                Committed like this, everyone who clones the repository downloads {large.length === 1 ? "it" : "them"} forever.
              </div>
              <div className="file-warning-actions">
                {patterns.map((pattern) => (
                  <button
                    key={pattern}
                    className="outline-button small"
                    disabled={busy}
                    onClick={() =>
                      run({
                        kind: "trackWithLfs",
                        patterns: [pattern],
                        paths: large.filter((file) => lfsPattern(file.path) === pattern && stagedPaths.has(file.path)).map((file) => file.path),
                      })
                    }
                  >
                    Track {pattern} with LFS
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {unlocked.length > 0 && (
          <div className="file-warning lockable" role="status">
            <LockIcon size={14} />
            <div>
              <div>
                {unlocked.length === 1 ? <strong>{baseName(unlocked[0])}</strong> : `${unlocked.length} files you changed`} can be
                locked, and nobody has. Lock {unlocked.length === 1 ? "it" : "them"} before someone else starts on{" "}
                {unlocked.length === 1 ? "it" : "them"}.
              </div>
              <div className="file-warning-actions">
                <button className="outline-button small" disabled={busy} onClick={() => run({ kind: "lockFiles", paths: unlocked })}>
                  {unlocked.length === 1 ? "Lock it" : `Lock ${unlocked.length} files`}
                </button>
              </div>
            </div>
          </div>
        )}
        {conflicted.length > 0 && (
          <section className="files conflicts">
            <h3>
              Conflicts
              <span className="hint">{plural(conflicted.length, "file")}</span>
              <span className="spacer" />
              <button className="link-button" onClick={() => resolve(conflicted.map((file) => file.path), "mine")} disabled={busy} title={`Keep ${mine}'s version of every conflicted file`}>
                All mine
              </button>
              <button className="link-button" onClick={() => resolve(conflicted.map((file) => file.path), "theirs")} disabled={busy} title={`Take ${theirs}'s version of every conflicted file`}>
                All theirs
              </button>
            </h3>
            <div className="conflict-help">
              Pick a whole version of each file (best for files that can't be merged, like assets), or fix the file and stage it.
            </div>
            <ul className="file-list">
              {conflicted.map((file) => (
                <FileLine
                  key={file.path}
                  file={file}
                  lock={lockOf(file.path)}
                  onContextMenu={onFileMenu}
                  choices={[
                    { label: "Mine", title: `Keep ${mine}'s version`, onClick: () => resolve([file.path], "mine"), disabled: busy },
                    { label: "Theirs", title: `Take ${theirs}'s version`, onClick: () => resolve([file.path], "theirs"), disabled: busy },
                  ]}
                  action={{
                    label: "Stage (mark as resolved)",
                    icon: <PlusIcon size={13} />,
                    onClick: () => run({ kind: "stage", paths: [file.path] }, { quiet: true }),
                    disabled: busy,
                  }}
                />
              ))}
            </ul>
          </section>
        )}
        <FileSection
          title="Staged"
          files={status.staged}
          empty="Nothing staged yet. Stage the files you want to commit."
          bulk={{ label: "Unstage all", onClick: () => run({ kind: "unstageAll" }, { quiet: true }) }}
          lockOf={lockOf}
          onFileMenu={onFileMenu}
          fileAction={(file) => ({
            label: "Unstage",
            icon: <MinusIcon size={13} />,
            onClick: () => run({ kind: "unstage", paths: paths(file) }, { quiet: true }),
          })}
          busy={busy}
        />
        <FileSection
          title="Unstaged"
          files={unstaged}
          empty="No other changes."
          bulk={{ label: "Stage all", onClick: () => run({ kind: "stageAll" }, { quiet: true }) }}
          lockOf={lockOf}
          onFileMenu={onFileMenu}
          fileAction={(file) => ({
            label: "Stage",
            icon: <PlusIcon size={13} />,
            onClick: () => run({ kind: "stage", paths: paths(file) }, { quiet: true }),
          })}
          busy={busy}
        />
      </div>

      <div className="commit-box">
        {props.messageTools}
        <div className="summary-field">
          <input
            className="text-input"
            value={draft.summary}
            onChange={(event) => onDraft({ ...draft, summary: event.target.value })}
            onKeyDown={onKeyDown}
            placeholder="Commit summary"
            aria-label="Commit summary"
          />
          {draft.summary.length > 0 && (
            <span
              className={`summary-count${draft.summary.length > 72 ? " over" : draft.summary.length > 50 ? " long" : ""}`}
              title="Summaries up to 50 characters (72 at most) show in full in most places"
            >
              {draft.summary.length}
            </span>
          )}
        </div>
        <textarea
          className="text-input"
          value={draft.description}
          onChange={(event) => onDraft({ ...draft, description: event.target.value })}
          onKeyDown={onKeyDown}
          placeholder="Description (optional)"
          aria-label="Commit description"
          rows={3}
        />
        {confirmLarge && (
          <div className="commit-warning" role="alert">
            <span>
              {largeStaged.length === 1 ? `${baseName(largeStaged[0].path)} is` : `${largeStaged.length} staged files are`} big and
              not in Git LFS.
            </span>
            <button className="link-button" onClick={() => setConfirmLarge(false)}>
              Cancel
            </button>
            <button className="danger-outline-button small" onClick={() => commit(true)}>
              Commit anyway
            </button>
          </div>
        )}
        <div className="commit-row-controls">
          <label className="checkbox" title="Replace the last commit with these changes and this message">
            <input
              type="checkbox"
              checked={draft.amend}
              disabled={!snapshot.headCommit}
              onChange={(event) => toggleAmend(event.target.checked)}
            />
            Amend last commit
          </label>
          <button
            className="primary-small-button"
            onClick={() => commit()}
            disabled={!canCommit}
            title={
              status.staged.length === 0 && !draft.amend
                ? "Stage the files you want to commit first"
                : `Commit (${modKey}Enter)`
            }
          >
            {committing
              ? "Committing…"
              : draft.amend
                ? "Amend commit"
                : `Commit ${status.staged.length > 0 ? plural(status.staged.length, "file") : ""}`.trim()}
          </button>
        </div>
      </div>
    </aside>
  );
}

interface FileSectionProps {
  title: string;
  files: FileChange[];
  empty: string;
  bulk: { label: string; onClick: () => void };
  fileAction: (file: FileChange) => { label: string; icon: React.ReactNode; onClick: () => void };
  busy: boolean;
  lockOf: (path: string) => Lock | undefined;
  onFileMenu: (file: FileChange, x: number, y: number) => void;
}

function FileSection({ title, files, empty, bulk, fileAction, busy, lockOf, onFileMenu }: FileSectionProps) {
  return (
    <section className="files">
      <h3>
        {title}
        <span className="hint">{plural(files.length, "file")}</span>
        <span className="spacer" />
        {files.length > 0 && (
          <button className="link-button" onClick={bulk.onClick} disabled={busy}>
            {bulk.label}
          </button>
        )}
      </h3>
      {files.length === 0 ? (
        <div className="muted">{empty}</div>
      ) : (
        <ul className="file-list">
          {files.map((file) => (
            <FileLine
              key={`${file.status}:${file.oldPath ?? ""}:${file.path}`}
              file={file}
              action={{ ...fileAction(file), disabled: busy }}
              lock={lockOf(file.path)}
              onContextMenu={onFileMenu}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** What the two sides of a conflict are called, for buttons like "Keep main's version". */
export function conflictSides(snapshot: RepoSnapshot): { mine: string; theirs: string } {
  const operation = snapshot.operation;
  return {
    mine: operation?.mine ?? snapshot.headBranch ?? "your branch",
    theirs: operation?.theirs ?? "the other side",
  };
}
