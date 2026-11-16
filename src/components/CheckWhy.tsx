import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { checkLog, rerunJob } from "../api";
import type { CheckLog, CheckState } from "../api/generated";
import { copyText } from "../lib/clipboard";
import { checkName, formatElapsed } from "../lib/pullRequests";
import type { RunState } from "../lib/runGraph";
import { Dialog } from "./Dialog";
import { Loader } from "./Loader";
import { RunStateIcon } from "./RunStateIcon";
import { Button } from "./ui/Button";

/** A failed check to say why of: its name, its page, and what it's part of. */
export interface WhyCheck {
  name: string;
  url: string;
  /** Its workflow (or GitLab stage), and what started it, like "on push to main". */
  workflow?: string | null;
  trigger?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

/**
 * Opens the window saying why a check failed, where one can: its rows in a commit's details,
 * a pull request's view and the checks view open it for a failed check instead of its page.
 */
export const CheckWhyContext = createContext<((check: WhyCheck) => void) | null>(null);

export function useCheckWhy() {
  return useContext(CheckWhyContext);
}

/** The site a check's page is on, by its address. */
function siteOf(url: string) {
  return url.startsWith("https://github.com/") ? "GitHub" : "GitLab";
}

function stepState(state: CheckState | null): RunState {
  return state === null ? "skipped" : state === "pending" ? "running" : state;
}

/** How long it ran, from its times, in words. */
function took(check: WhyCheck): string | null {
  if (!check.startedAt || !check.finishedAt) return null;
  const ms = Date.parse(check.finishedAt) - Date.parse(check.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? formatElapsed(ms) : null;
}

/**
 * Why a check failed: its job's steps, the failed one marked, and the end of that step's
 * log, scrolled to its end, with its errors in red. Copy the lines, open the job's page, or
 * run the job again.
 */
export function CheckWhy({ repoPath, check, openUrl, notify, onClose }: { repoPath: string; check: WhyCheck; openUrl: (url: string) => void; notify: (text: string) => void; onClose: () => void }) {
  const [log, setLog] = useState<CheckLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = useRef<HTMLDivElement>(null);
  const site = siteOf(check.url);
  const name = checkName(check.name);

  useEffect(() => {
    let current = true;
    checkLog(repoPath, check.url).then(
      (found) => current && setLog(found),
      (reason) => current && setError(String(reason)),
    );
    return () => {
      current = false;
    };
  }, [repoPath, check.url]);

  // Where it failed is at the end: start there.
  useLayoutEffect(() => {
    if (lines.current) lines.current.scrollTop = lines.current.scrollHeight;
  }, [log]);

  const rerun = async () => {
    setBusy(true);
    try {
      notify(`${await rerunJob(repoPath, check.url)}: ${name}`);
      onClose();
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  };

  const failedAt = log?.step ? log.steps.findIndex((step) => step.name === log.step) : -1;
  const said = [[check.workflow, check.trigger].filter(Boolean).join(", "), took(check) && `after ${took(check)}`, failedAt >= 0 && `at step ${failedAt + 1} of ${log!.steps.length}`].filter(Boolean).join(" · ");

  return (
    <Dialog
      title={`${name} failed`}
      className="check-why"
      wide
      closable
      error={error}
      busy={busy}
      onCancel={onClose}
      buttons={
        <>
          <Button kind="secondary" disabled={!log || log.lines.length === 0} onClick={() => log && copyText(log.lines.map((line) => line.text).join("\n")).then(() => notify("Copied the log"))}>
            Copy log
          </Button>
          <Button kind="secondary" onClick={() => openUrl(check.url)} data-url={check.url}>
            Open on {site}
          </Button>
          <Button kind="primary" disabled={busy || !log?.canRerun} onClick={rerun} title={log && !log.canRerun ? `Sign in to ${site} to run it again` : undefined}>
            {busy ? "Asking…" : "Re-run job"}
          </Button>
        </>
      }
    >
      {said && <p className="check-why-said">{said}</p>}
      {!log && !error ? (
        <Loader title="Getting the log" size={64} inline />
      ) : log ? (
        <>
          {log.steps.length > 0 && (
            <ol className="check-why-steps" aria-label="Its steps">
              {log.steps.map((step, index) => (
                <li key={`${step.name}-${index}`} className={`${stepState(step.state)}${index === failedAt ? " failed-here" : ""}`}>
                  <RunStateIcon state={stepState(step.state)} size={13} />
                  <span className="chip-text">{step.name}</span>
                </li>
              ))}
            </ol>
          )}
          {log.lines.length > 0 && (
            <div ref={lines} className="check-why-log" role="log" tabIndex={0} aria-label={log.step ? `The end of the log of ${log.step}` : "The end of the log"}>
              {log.cut && <div className="check-why-cut">The lines before these are on its page on {site}.</div>}
              {log.lines.map((line, index) => (
                <div key={index} className={`check-why-line ${line.kind}`}>
                  {line.text || " "}
                </div>
              ))}
            </div>
          )}
          {log.missing && <p className="check-why-missing">{log.missing}</p>}
        </>
      ) : null}
    </Dialog>
  );
}

/** "Why?", on a failed check's row: the row opens the window saying why (CheckWhy). */
export function WhyChip() {
  return (
    <span className="check-why-chip" aria-hidden>
      <span className="chip-text">Why?</span>
    </span>
  );
}
