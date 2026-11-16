import { useState } from "react";
import type { RepoSnapshot } from "../api";
import { Dialog } from "./Dialog";
import { TypeToConfirm } from "./Safety";
import { Button } from "./ui/Button";

interface Props {
  snapshot: RepoSnapshot;
  /** The checked-out branch, when it's protected: its name must be typed to go ahead. */
  protectedName?: string | null;
  /** Why it's asked for, when something stopped for it (a sync, into a rewritten branch). */
  reason?: string;
  /** Start with "even if someone else pushed" ticked (a safe force push stopped for that). */
  overwrite?: boolean;
  onCancel: () => void;
  /**
   * Go ahead: the dialog closes, and the push runs with its progress bar, like any push.
   * `overwrite`: replace commits someone else pushed since the last fetch too.
   */
  onPush: (overwrite: boolean) => void;
}

/** Asks for confirmation before `git push --force-with-lease`. */
export function ForcePushDialog({ snapshot, protectedName, reason, onCancel, onPush, ...props }: Props) {
  const [typed, setTyped] = useState("");
  const [overwrite, setOverwrite] = useState(Boolean(props.overwrite));
  const confirmed = !protectedName || typed.trim() === protectedName;
  const branch = snapshot.headBranch ?? "HEAD";
  const target = snapshot.upstream?.name ?? `${snapshot.remotes.includes("origin") ? "origin" : (snapshot.remotes[0] ?? "the remote")}/${branch}`;

  return (
    <Dialog
      title={`Force push ${branch}?`}
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="secondary" onClick={onCancel} autoFocus={!protectedName}>
            Cancel
          </Button>
          <Button kind="danger" onClick={() => onPush(overwrite)} disabled={!confirmed}>
            {overwrite ? "Force push anyway" : "Force push"}
          </Button>
        </>
      }
    >
      {/* Why it's asked for (Sync stopped for it), above what it does. */}
      {reason && <div className="dialog-warning force-push-reason">{reason}</div>}
      <p>
        <strong>{target}</strong> will be replaced with your local <strong>{branch}</strong>.
      </p>
      <ul className="dialog-consequences">
        <li className="danger">Commits on {target} that aren't in your {branch} will be removed from it.</li>
      </ul>
      <label className={`force-push-anyway${overwrite ? " on" : ""}`}>
        <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
        <span className="force-push-anyway-text">
          <strong>Also remove commits others pushed since you last fetched</strong>
          <span>
            {overwrite
              ? "Their commits are removed too. A copy is kept in Repository\u00a0→\u00a0Restore."
              : "If someone did, the force push stops instead, so their work isn't lost by mistake."}
          </span>
        </span>
      </label>
      {protectedName && <TypeToConfirm name={protectedName} value={typed} onChange={setTyped} />}
    </Dialog>
  );
}
