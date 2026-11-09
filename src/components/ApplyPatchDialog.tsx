import { useEffect, useState } from "react";
import { patchInfo, runAction, type PatchInfo } from "../api";
import { plural } from "../lib/format";
import { Dialog } from "./Dialog";

/**
 * Apply a patch file: what's in it (its commits and files) and whether it applies to your
 * files as they are, then as commits (with their authors and messages) or as changes to
 * commit yourself.
 */
export function ApplyPatchDialog({
  repoPath,
  file,
  branch,
  onCancel,
  onDone,
}: {
  repoPath: string;
  file: string;
  branch: string | null;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [info, setInfo] = useState<PatchInfo | null>(null);
  const [asCommits, setAsCommits] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1);
  useEffect(() => {
    let current = true;
    patchInfo(repoPath, file)
      .then((found) => {
        if (!current) return;
        setInfo(found);
        setAsCommits(found.commits.length > 0);
      })
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  }, [repoPath, file]);

  const apply = async () => {
    setRunning(true);
    setError(null);
    try {
      onDone(await runAction(repoPath, { kind: "applyPatch", file, asCommits }));
    } catch (e) {
      const message = String(e);
      // Stopped at a conflict: the bar at the top takes over from here.
      if (/conflict/i.test(message)) onDone(message);
      else {
        setError(message);
        setRunning(false);
      }
    }
  };
  const shown = info?.files.slice(0, 8) ?? [];
  return (
    <Dialog
      title={`Apply ${name}?`}
      error={error}
      busy={running}
      onCancel={onCancel}
      wide
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={running}>
            Cancel
          </button>
          <button className="primary-small-button" onClick={apply} disabled={running || !info}>
            {running ? "Applying…" : asCommits && info && info.commits.length > 0 ? `Apply ${plural(info.commits.length, "commit")}` : "Apply the changes"}
          </button>
        </>
      }
    >
      {!info ? (
        !error && <p className="muted">Reading the patch…</p>
      ) : (
        <>
          {info.commits.length > 0 ? (
            <ul className="patch-commits">
              {info.commits.map((commit, index) => (
                <li key={index}>
                  <span className="patch-commit-summary">{commit.summary}</span>
                  {commit.author && <span className="muted">{commit.author}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p>Changes to {plural(info.files.length, "file")}, without commits of their own.</p>
          )}
          <ul className="patch-files mono">
            {shown.map((each) => (
              <li key={each.path}>
                <span className="patch-file">{each.path}</span>
                {each.additions !== null && each.deletions !== null ? (
                  <span>
                    <span className="added">+{each.additions}</span> <span className="removed">−{each.deletions}</span>
                  </span>
                ) : (
                  <span className="muted">binary</span>
                )}
              </li>
            ))}
            {info.files.length > shown.length && <li className="muted">and {plural(info.files.length - shown.length, "more file")}</li>}
          </ul>
          <p className={`dialog-note-line${info.applies ? "" : " warning"}`}>
            {info.applies
              ? "It applies to your files as they are."
              : "It conflicts with your files: git will stop at the conflicts for you to resolve them, then continue."}
          </p>
          {info.commits.length > 0 && (
            <div className="merge-methods" role="radiogroup" aria-label="How to apply it">
              <label className={`merge-method${asCommits ? " selected" : ""}`}>
                <input type="radio" name="apply-as" checked={asCommits} onChange={() => setAsCommits(true)} />
                <span className="merge-method-label">As commits on {branch ?? "HEAD"}</span>
                <span className="merge-method-hint">Each with its author and message, as it was made (git am).</span>
              </label>
              <label className={`merge-method${!asCommits ? " selected" : ""}`}>
                <input type="radio" name="apply-as" checked={!asCommits} onChange={() => setAsCommits(false)} />
                <span className="merge-method-label">As changes to commit yourself</span>
                <span className="merge-method-hint">The files change; nothing is committed (git apply).</span>
              </label>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
