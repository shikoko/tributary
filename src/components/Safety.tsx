import { useEffect, useState } from "react";
import { lostCommits, type LostCommits } from "../api";
import { compactTime, shortId } from "../lib/format";
import { Dialog } from "./Dialog";

/** The branches protected by default, until you change them for a repository. */
export const DEFAULT_PROTECTED = ["main", "master", "develop"];

/**
 * For changes to a protected branch: type its name to go ahead.
 * Returns whether what's typed matches (always true when `name` is null).
 */
export function TypeToConfirm({ name, value, onChange }: { name: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="type-to-confirm">
      <span>
        <strong>{name}</strong> is protected. Type its name to go ahead.
      </span>
      <input
        className="text-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={name}
        spellCheck={false}
        autoComplete="off"
        autoFocus
        aria-label={`Type ${name} to confirm`}
      />
    </label>
  );
}

/**
 * What deleting a branch would lose: its commits that are on no other branch, remote branch
 * or tag. Calls `onChecked` once it knows.
 */
export function LostCommitsNote({
  repoPath,
  reference,
  name,
  onChecked,
}: {
  repoPath: string;
  /** "refs/heads/…" or "refs/remotes/…". */
  reference: string;
  name: string;
  onChecked?: (lost: LostCommits | null) => void;
}) {
  const [lost, setLost] = useState<LostCommits | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    lostCommits(repoPath, reference)
      .then((result) => live && setLost(result))
      .catch(() => live && setLost(null));
    return () => {
      live = false;
    };
  }, [repoPath, reference]);
  useEffect(() => {
    if (lost !== undefined) onChecked?.(lost);
    // Only when the answer arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lost]);

  const restore = <p className="hint">Tributary keeps a backup for 30 days: Repository → Branches → Restore Branch… puts it back.</p>;
  if (lost === undefined) return <p className="hint">Checking what would be lost…</p>;
  if (lost === null) return restore;
  if (lost.count === 0) {
    return (
      <>
        <p className="safe-note">Nothing is lost: every commit on {name} is also on another branch, remote branch or tag.</p>
        {restore}
      </>
    );
  }
  return (
    <>
      <div className="dialog-warning lost-commits">
        <p>
          {lost.count === 1 ? "1 commit" : `${lost.count} commits`} on {name} {lost.count === 1 ? "isn't" : "aren't"} on any other
          branch, remote branch or tag:
        </p>
        <ul>
          {lost.commits.map((commit) => (
            <li key={commit.id}>
              <span className="mono">{shortId(commit.id)}</span> {commit.summary}
              <span className="muted"> · {compactTime(commit.time)}</span>
            </li>
          ))}
        </ul>
        {lost.count > lost.commits.length && <p className="muted">…and {lost.count - lost.commits.length} more.</p>}
      </div>
      {restore}
    </>
  );
}

/** A change to a protected branch (like rebasing it): type its name to go ahead. */
export function ProtectedActionDialog({
  branch,
  title,
  explanation,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  branch: string;
  title: string;
  explanation: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim() === branch;
  return (
    <Dialog
      title={title}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-button" disabled={!confirmed} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{explanation}</p>
      <TypeToConfirm name={branch} value={typed} onChange={setTyped} />
    </Dialog>
  );
}
