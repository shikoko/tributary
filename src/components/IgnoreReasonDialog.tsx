import { useEffect, useRef, useState } from "react";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { ignoreReason, type Action, type IgnoreReason } from "../api";
import { baseName } from "../lib/paths";
import { useStoredState } from "../lib/settings";
import { Dialog } from "./Dialog";
import { CheckIcon, FolderIcon } from "./Icons";
import { Button } from "./ui/Button";

/** Skip the introduction and go straight to choosing a file (Settings → General turns it back on). */
export const SKIP_INTRO_KEY = "ignoreReason.skipIntro";

const STEPS = [
  { title: "Choose the file", text: "One that doesn't show in your changes, or one you aren't sure about." },
  { title: "See the rule", text: "The exact line that leaves it out, and the file it's in: a .gitignore, .git/info/exclude or your own ignore file." },
  { title: "Stage it anyway", text: "If it should be committed after all, without changing the rule for anything else." },
];

/**
 * Why a file doesn't show in the changes: an introduction first (unless it's been turned
 * off), then the ignore rule that leaves the chosen file out, and staging it anyway.
 */
export function IgnoreReasonDialog({
  repoPath,
  file: given,
  canChange,
  onClose,
  run,
}: {
  repoPath: string;
  /** The file to look at; null to choose one (after the introduction). */
  file: string | null;
  canChange: boolean;
  onClose: () => void;
  run: (action: Action) => void;
}) {
  const [skipIntro, setSkipIntro] = useStoredState<boolean>(SKIP_INTRO_KEY, false);
  // Whether this time starts with the introduction: decided when it opens, so ticking
  // "Don't show this again" doesn't make it disappear.
  const [intro] = useState(!given && !skipIntro);
  const [file, setFile] = useState<string | null>(given);
  const [choosing, setChoosing] = useState(false);
  const [reason, setReason] = useState<IgnoreReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setChoosing(true);
    const picked = await openFile({ multiple: false, directory: false, title: "Which file is left out?", defaultPath: repoPath }).catch(() => null);
    setChoosing(false);
    if (typeof picked === "string") {
      setReason(null);
      setError(null);
      setFile(picked);
    } else if (!file && !intro) {
      // Straight to choosing, and nothing chosen: there's nothing to show.
      onClose();
    }
  };
  // Without the introduction, choosing starts at once.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || given || intro) return;
    started.current = true;
    void choose();
    // Once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!file) return;
    let current = true;
    ignoreReason(repoPath, file)
      .then((found) => current && setReason(found))
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  }, [repoPath, file]);

  if (!file) {
    // Straight to choosing: nothing to show until a file is chosen.
    if (!intro) return null;
    return (
      <Dialog
        title="Why is a file ignored?"
        className="ignore-window"
        closable
        onCancel={onClose}
        buttons={
          <>
            <label className="checkbox ignore-skip">
              <input type="checkbox" checked={skipIntro} onChange={(event) => setSkipIntro(event.target.checked)} />
              Don't show this again
            </label>
            <span className="spacer" />
            <Button kind="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="primary" onClick={() => void choose()} disabled={choosing} autoFocus>
              {choosing ? "Choosing…" : "Choose a file…"}
            </Button>
          </>
        }
      >
        <p className="ignore-lead">
          Git leaves out files that match an <strong>ignore rule</strong>, so they never show in your changes and can't be committed by
          accident. Pick one, and Tributary finds the rule that's responsible.
        </p>
        <ol className="ignore-steps">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="ignore-step-number">{index + 1}</span>
              <strong>{step.title}</strong>
              <span>{step.text}</span>
            </li>
          ))}
        </ol>
      </Dialog>
    );
  }

  const name = baseName(reason?.path ?? file);
  const rule = reason?.rule;
  return (
    <Dialog
      title={!reason ? "Why is a file ignored?" : rule ? `Why ${name} is left out` : `${name} isn't ignored`}
      className="ignore-window"
      closable
      error={error}
      onCancel={onClose}
      buttons={
        <>
          <Button kind="secondary" onClick={() => void choose()} disabled={choosing}>
            Choose another file…
          </Button>
          <span className="spacer" />
          <Button kind="secondary" onClick={onClose}>
            Close
          </Button>
          {rule && !reason?.tracked && (
            <Button
              kind="primary"
              disabled={!canChange}
              onClick={() => {
                onClose();
                run({ kind: "stageIgnored", paths: [reason.path] });
              }}
            >
              Stage it anyway
            </Button>
          )}
        </>
      }
    >
      {!reason ? (
        !error && <p className="muted">Looking…</p>
      ) : (
        <div className="ignore-answer">
          <p className="ignore-file">
            <FolderIcon size={13} />
            <span className="mono">{reason.path}</span>
          </p>
          {rule ? (
            <>
              <figure className="ignore-rule-card">
                <figcaption>
                  <span className="mono">{rule.source}</span>
                  <span className="ignore-rule-line">line {rule.line}</span>
                </figcaption>
                <pre className="mono">
                  <span className="ignore-gutter">{rule.line}</span>
                  {rule.pattern}
                </pre>
              </figure>
              <p className="ignore-note">
                {reason.tracked
                  ? "It's committed already, so the rule doesn't apply to it: its changes still show."
                  : "This rule leaves it out. Staging it anyway commits it despite the rule, and from then on its changes show; the rule stays for everything else."}
              </p>
            </>
          ) : (
            <div className="ignore-clear">
              <CheckIcon size={16} />
              <span>
                No rule leaves it out.{" "}
                {reason.tracked ? "It's committed, and its changes show like any other file's." : "When it changes, it shows in your uncommitted changes."}
              </span>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
