import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../api";
import { copyText } from "../lib/clipboard";
import { relativeTime } from "../lib/format";
import type { HistoryEntry } from "../lib/history";
import { CheckIcon, CloseIcon, CopyIcon, RevertIcon } from "./Icons";

interface Props {
  entries: LogEntry[];
  /** The open repository, so its commands can be told apart from other tabs'. */
  folder: string;
  onClear: () => void;
  onClose: () => void;
  /** What you did here with Tributary, newest first, and undoing it. */
  history: HistoryEntry[];
  canUndo: (entry: HistoryEntry) => { ok: boolean; why?: string };
  onUndo: (entry: HistoryEntry) => void;
  onClearHistory: () => void;
}

/** What you did, newest first, each with Undo while it's still safe. */
function YourActions({ history, canUndo, onUndo }: Pick<Props, "history" | "canUndo" | "onUndo">) {
  if (history.length === 0) {
    return <div className="activity-empty">Nothing yet: what you do here (commits, pulls, checkouts, merges…) is listed, with Undo where it can be undone.</div>;
  }
  return (
    <>
      {history.map((entry) => {
        const state = canUndo(entry);
        return (
          <div key={entry.id} className={`history-entry${entry.undone ? " undone" : ""}`}>
            <span className="activity-time" title={new Date(entry.time).toLocaleString()}>
              {relativeTime(entry.time / 1000)}
            </span>
            <span className="history-text">{entry.text}</span>
            {!entry.undone && entry.undo && !state.ok && state.why && (
              <span className="history-why" title={state.why}>
                {state.why.split(":")[0]}
              </span>
            )}
            {entry.undone ? (
              <span className="history-undone">Undone</span>
            ) : entry.undo ? (
              <button className="secondary-button small history-undo" disabled={!state.ok} title={state.ok ? `Undo: ${entry.text}` : state.why} onClick={() => onUndo(entry)}>
                <RevertIcon size={12} />
                Undo
              </button>
            ) : (
              <span className="history-none" title="This can't be undone from here">
                —
              </span>
            )}
          </div>
        );
      })}
    </>
  );
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
export function ActivityPanel({ entries, folder, onClear, onClose, history, canUndo, onUndo, onClearHistory }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const [onlyHere, setOnlyHere] = useState(true);
  const [tab, setTab] = useState<"actions" | "commands">("actions");
  const list = useRef<HTMLDivElement>(null);
  const shown = onlyHere ? entries.filter((entry) => entry.folder === folder) : entries;

  // Follow new commands as they come in (your actions are newest first).
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = tab === "commands" ? element.scrollHeight : 0;
  }, [shown.length, history.length, tab]);

  return (
    <section className="activity-panel" aria-label="Activity">
      <header className="activity-header">
        <strong>Activity</strong>
        <div className="diff-switch" role="tablist" aria-label="Show">
          <button role="tab" className={tab === "actions" ? "selected" : undefined} aria-selected={tab === "actions"} onClick={() => setTab("actions")}>
            Your actions
          </button>
          <button role="tab" className={tab === "commands" ? "selected" : undefined} aria-selected={tab === "commands"} onClick={() => setTab("commands")}>
            Git commands
          </button>
        </div>
        <span className="muted">{tab === "actions" ? "What you did here, with Undo while it's still safe." : "Every git command Tributary runs, and what git said."}</span>
        <span className="spacer" />
        {tab === "commands" && (
          <label className="checkbox small">
            <input type="checkbox" checked={onlyHere} onChange={(event) => setOnlyHere(event.target.checked)} />
            This repository only
          </label>
        )}
        <button
          className="secondary-button small"
          onClick={tab === "actions" ? onClearHistory : onClear}
          disabled={tab === "actions" ? history.length === 0 : shown.length === 0}
        >
          Clear
        </button>
        <button className="icon-button" onClick={onClose} aria-label="Close activity" title="Close">
          <CloseIcon size={14} />
        </button>
      </header>
      <div className="activity-list" ref={list}>
        {tab === "actions" && <YourActions history={history} canUndo={canUndo} onUndo={onUndo} />}
        {tab === "commands" && shown.length === 0 && <div className="activity-empty">No git commands yet.</div>}
        {tab === "commands" && shown.map((entry) => (
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
