import { useCallback, useEffect, useState } from "react";
import { projectSetup, type Action, type ProjectSetup, type SetupCheck } from "../api";
import { openInBrowser } from "../lib/weblinks";
import { Dialog } from "./Dialog";
import { CheckIcon, CloseIcon, WarningIcon } from "./Icons";

const STATUS_ICON = { good: <CheckIcon size={14} />, warning: <WarningIcon size={14} />, problem: <CloseIcon size={14} /> };

/**
 * Whether the repository is set up the way a game project needs: the engine's folders
 * ignored, art in Git LFS and lockable, line endings, long paths, names that clash. A fix
 * for what can be fixed here; what to do about the rest.
 */
export function ProjectSetupDialog({
  repoPath,
  canChange,
  run,
  onOpenSize,
  onClose,
}: {
  repoPath: string;
  canChange: boolean;
  /** Runs a git action; resolves to whether it worked. */
  run: (action: Action) => Promise<unknown>;
  /** Open Repository size (to move big files into Git LFS). */
  onOpenSize: () => void;
  onClose: () => void;
}) {
  const [setup, setSetup] = useState<ProjectSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const load = useCallback(() => {
    projectSetup(repoPath)
      .then((found) => {
        setSetup(found);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [repoPath]);
  useEffect(load, [load]);

  const fix = async (checks: SetupCheck[]) => {
    for (const check of checks) {
      if (!check.fix) continue;
      setFixing(check.id);
      await run({ kind: "fixSetup", fix: check.fix });
    }
    setFixing(null);
    load();
  };
  const fixable = (setup?.checks ?? []).filter((check) => check.fix && check.status !== "good");
  const count = (status: SetupCheck["status"]) => (setup?.checks ?? []).filter((check) => check.status === status).length;
  const where = setup?.project ? ` in ${setup.project}/` : "";

  return (
    <Dialog
      title="Project setup"
      wide
      error={error}
      onCancel={onClose}
      busy={fixing !== null}
      buttons={
        <>
          <button className="secondary-button" onClick={onClose} disabled={fixing !== null}>
            Close
          </button>
          <span className="spacer" />
          {fixable.length > 1 && (
            <button className="primary-small-button" onClick={() => fix(fixable)} disabled={!canChange || fixing !== null}>
              Fix all {fixable.length}
            </button>
          )}
        </>
      }
    >
      {!setup ? (
        !error && <p className="muted">Checking…</p>
      ) : (
        <div className="setup-check">
          <p className="setup-summary">
            {setup.engine === "unreal" ? `An Unreal project${where}.` : setup.engine === "unity" ? `A Unity project${where}.` : "No Unreal or Unity project found: the checks any game project needs."}{" "}
            <span className="muted">
              {[count("problem") && `${count("problem")} to fix`, count("warning") && `${count("warning")} to look at`, count("good") && `${count("good")} fine`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
          <ul className="setup-checks">
            {setup.checks.map((check) => (
              <li key={check.id} className={`setup-item ${check.status}`}>
                <span className="setup-status" aria-label={check.status}>
                  {STATUS_ICON[check.status]}
                </span>
                <div className="setup-text">
                  <strong>{check.title}</strong>
                  {check.status !== "good" && <span>{check.detail}</span>}
                  {check.status !== "good" && check.examples.length > 0 && (
                    <ul className="setup-examples">
                      {check.examples.map((example) => (
                        <li key={example} className="mono">
                          {example}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="setup-action">
                  {check.fix && check.status !== "good" && (
                    <button className="outline-button" onClick={() => fix([check])} disabled={!canChange || fixing !== null}>
                      <span className="button-label">{fixing === check.id ? "Fixing…" : check.fixLabel}</span>
                    </button>
                  )}
                  {check.id === "big" && (
                    <button className="outline-button" onClick={onOpenSize}>
                      <span className="button-label">Repository size…</span>
                    </button>
                  )}
                  {check.id === "lfs-installed" && !check.fix && (
                    <button className="outline-button" onClick={() => openInBrowser("https://git-lfs.com")} data-url="https://git-lfs.com">
                      <span className="button-label">Get Git LFS</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="dialog-note-line">Changes to .gitignore and .gitattributes are yours to commit, so everyone gets them.</p>
        </div>
      )}
    </Dialog>
  );
}
