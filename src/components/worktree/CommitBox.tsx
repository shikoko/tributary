import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { commitDetails, type Action, type LargeFile, type RepoSnapshot } from "../../api";
import { plural } from "../../lib/format";
import { baseName } from "../../lib/paths";
import { modKey } from "../../lib/platform";

export interface CommitDraft {
  summary: string;
  description: string;
  amend: boolean;
}

export const EMPTY_DRAFT: CommitDraft = { summary: "", description: "", amend: false };

interface Props {
  snapshot: RepoSnapshot;
  draft: CommitDraft;
  onDraft: (draft: CommitDraft) => void;
  /** How many files are staged. */
  stagedCount: number;
  /** Big staged files outside Git LFS: committing them asks first. */
  largeStaged: LargeFile[];
  busy: boolean;
  /** Runs a git action; resolves to true when it worked. */
  run: (action: Action) => Promise<boolean>;
  /** Help writing the message: recent messages and co-authors. */
  messageTools?: ReactNode;
}

/**
 * The commit message (with the summary's length) and the Commit button. During a merge,
 * cherry-pick or revert, or after a squash merge, it starts from the message git
 * prepared; amending starts from the last commit's.
 */
export function CommitBox({ snapshot, draft, onDraft, stagedCount, largeStaged, busy, run, messageTools }: Props) {
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
    !busy && !committing && draft.summary.trim() !== "" && (stagedCount > 0 || draft.amend) && !snapshot.bare;
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
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  return (
    <div className="commit-box">
      {messageTools}
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
            stagedCount === 0 && !draft.amend
              ? "Stage the files you want to commit first"
              : `Commit (${modKey}Enter)`
          }
        >
          {committing
            ? "Committing…"
            : draft.amend
              ? "Amend commit"
              : `Commit ${stagedCount > 0 ? plural(stagedCount, "file") : ""}`.trim()}
        </button>
      </div>
    </div>
  );
}
