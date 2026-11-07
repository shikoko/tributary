import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../api";
import { copyText } from "../lib/clipboard";
import { CheckIcon, CloseIcon, CopyIcon } from "./Icons";

interface Props {
  entries: LogEntry[];
  /** The open repository, so its commands can be told apart from other tabs'. */
  folder: string;
  onClear: () => void;
  onClose: () => void;
}

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** An argument as it would be typed in a terminal. */
function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function commandLine(entry: LogEntry): string {
  return ["git", ...entry.args.map(quote)].join(" ");
}

function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The git commands Tributary ran, newest at the bottom, with what git printed. */
export function ActivityPanel({ entries, folder, onClear, onClose }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const [onlyHere, setOnlyHere] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const shown = onlyHere ? entries.filter((entry) => entry.folder === folder) : entries;

  // Follow new commands as they come in.
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [shown.length]);

  return (
    <section className="activity-panel" aria-label="Activity">
      <header className="activity-header">
        <strong>Activity</strong>
        <span className="muted">Every git command Tributary runs, and what git said.</span>
        <span className="spacer" />
        <label className="checkbox small">
          <input type="checkbox" checked={onlyHere} onChange={(event) => setOnlyHere(event.target.checked)} />
          This repository only
        </label>
        <button className="secondary-button small" onClick={onClear} disabled={shown.length === 0}>
          Clear
        </button>
        <button className="icon-button" onClick={onClose} aria-label="Close activity" title="Close">
          <CloseIcon size={14} />
        </button>
      </header>
      <div className="activity-list" ref={list}>
        {shown.length === 0 && <div className="activity-empty">No git commands yet.</div>}
        {shown.map((entry) => (
          <div key={entry.id} className={`activity-entry${entry.success ? "" : " failed"}`}>
            <button
              className="activity-line"
              onClick={() => setOpen(open === entry.id ? null : entry.id)}
              aria-expanded={open === entry.id}
              title={entry.folder}
            >
              <span className="activity-time">{time.format(new Date(entry.started))}</span>
              <span className={`activity-status${entry.success ? " ok" : ""}`}>
                {entry.success ? <CheckIcon size={12} /> : <CloseIcon size={12} />}
              </span>
              <code className="activity-command">{commandLine(entry)}</code>
              {entry.background && <span className="activity-badge">background</span>}
              {!onlyHere && <span className="activity-folder">{entry.folder.split(/[\\/]/).pop()}</span>}
              <span className="activity-duration">{duration(entry.durationMs)}</span>
            </button>
            {open === entry.id && (
              <div className="activity-output">
                <button
                  className="icon-button small"
                  onClick={() => copyText(commandLine(entry))}
                  title="Copy the command"
                  aria-label="Copy the command"
                >
                  <CopyIcon size={13} />
                </button>
                <pre>{entry.output || "(no output)"}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
