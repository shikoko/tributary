import { useEffect, useState } from "react";
import { ignoreReason, type Action, type IgnoreReason } from "../api";
import { baseName } from "../lib/paths";
import { Dialog } from "./Dialog";

/** Why a file doesn't show in the changes: the ignore rule that leaves it out, and staging it anyway. */
export function IgnoreReasonDialog({
  repoPath,
  file,
  canChange,
  onClose,
  run,
}: {
  repoPath: string;
  file: string;
  canChange: boolean;
  onClose: () => void;
  run: (action: Action) => void;
}) {
  const [reason, setReason] = useState<IgnoreReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    ignoreReason(repoPath, file)
      .then((found) => current && setReason(found))
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  }, [repoPath, file]);
  const name = baseName(reason?.path ?? file);
  const rule = reason?.rule;
  return (
    <Dialog
      title={`Why ${name} is left out`}
      error={error}
      onCancel={onClose}
      buttons={
        <>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
          {rule && !reason?.tracked && (
            <button
              className="primary-small-button"
              disabled={!canChange}
              onClick={() => {
                onClose();
                run({ kind: "stageIgnored", paths: [reason.path] });
              }}
            >
              Stage it anyway
            </button>
          )}
        </>
      }
    >
      {!reason ? (
        !error && <p className="muted">Looking…</p>
      ) : !rule ? (
        <p>
          <strong>{reason.path}</strong> isn't ignored.{" "}
          {reason.tracked ? "It's committed, and its changes show like any other file's." : "When it changes, it shows in the uncommitted changes."}
        </p>
      ) : (
        <div className="dialog-form">
          <p>
            <strong>{reason.path}</strong> is ignored by line {rule.line} of <span className="mono">{rule.source}</span>:
          </p>
          <pre className="ignore-rule mono">{rule.pattern}</pre>
          <p className="dialog-note-line">
            {reason.tracked
              ? "It's committed already, so the rule doesn't apply to it: its changes still show."
              : "Staging it anyway commits it despite the rule, and from then on its changes show (the rule stays for everything else)."}
          </p>
        </div>
      )}
    </Dialog>
  );
}
