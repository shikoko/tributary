import type { ReactNode } from "react";
import type { FileChange, Lock, Overlap } from "../api";
import { overlapTitle } from "../lib/elsewhere";
import { withAlpha } from "../lib/colors";
import { lockOwner } from "../lib/locks";
import { relativeTime } from "../lib/format";
import { FileKindIcon } from "./FileKindIcon";
import { BranchIcon, LockIcon } from "./Icons";

const STATUS: Record<FileChange["status"], { letter: string; color: string; label: string }> = {
  added: { letter: "A", color: "#36e07c", label: "Added" },
  modified: { letter: "M", color: "#ffad1f", label: "Modified" },
  deleted: { letter: "D", color: "#ff5c6c", label: "Deleted" },
  renamed: { letter: "R", color: "#1fb5ff", label: "Renamed" },
  copied: { letter: "C", color: "#a77bff", label: "Copied" },
  untracked: { letter: "?", color: "#19d7b4", label: "Untracked" },
  conflicted: { letter: "!", color: "#ff5c6c", label: "Conflicted" },
};

interface FileLineProps {
  file: FileChange;
  /** A button shown on hover, like "Stage". */
  action?: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean };
  /** Buttons that are always shown, like "Mine" and "Theirs" for a conflicted file. */
  choices?: { label: string; title: string; onClick: () => void; disabled?: boolean }[];
  /** Its Git LFS lock. */
  lock?: Lock;
  /** Stands out, like the file whose history is highlighted. */
  highlighted?: boolean;
  /** Another branch also changed it since yours split off. */
  elsewhere?: Overlap;
  onContextMenu?: (file: FileChange, x: number, y: number) => void;
  /** Show its changes (on click, Enter or Space). */
  onOpen?: (file: FileChange) => void;
  /** Its changes are the ones shown. */
  shown?: boolean;
}

/** "Locked by you" or "Locked by rosa 2 days ago". */
export function lockTitle(lock: Lock): string {
  const when = lock.lockedAt ? Date.parse(lock.lockedAt) : NaN;
  return `Locked by ${lockOwner(lock)}${Number.isNaN(when) ? "" : ` ${relativeTime(when / 1000)}`}`;
}

export function FileLine({ file, action, choices, lock, highlighted, onContextMenu, elsewhere, onOpen, shown }: FileLineProps) {
  const status = STATUS[file.status];
  // Untracked folders are listed as "dir/" when everything inside them is new.
  const isFolder = file.path.endsWith("/");
  const path = isFolder ? file.path.slice(0, -1) : file.path;
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1) + (isFolder ? "/" : "");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const title = file.oldPath ? `${status.label}: ${file.oldPath} → ${file.path}` : `${status.label}: ${file.path}`;
  const open = onOpen && !isFolder ? () => onOpen(file) : undefined;
  return (
    <li
      className={`file${highlighted ? " highlighted" : ""}${choices ? " with-choices" : ""}${open ? " openable" : ""}${shown ? " shown" : ""}`}
      title={lock ? `${title}\n${lockTitle(lock)}` : title}
      tabIndex={open ? 0 : undefined}
      aria-current={shown || undefined}
      onClick={open && ((event) => !(event.target as HTMLElement).closest("button") && open())}
      onKeyDown={
        open &&
        ((event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          open();
        })
      }
      onContextMenu={
        onContextMenu &&
        ((event) => {
          event.preventDefault();
          onContextMenu(file, event.clientX, event.clientY);
        })
      }
    >
      <span className="file-status" style={{ color: status.color, background: withAlpha(status.color, 0.14) }}>
        {status.letter}
      </span>
      <FileKindIcon path={file.path} />
      <span className="file-name">{name}</span>
      {lock && (
        <span className={`file-lock ${lock.mine ? "mine" : "theirs"}`}>
          <LockIcon size={11} />
          {!lock.mine && <span className="file-lock-owner">{lock.owner}</span>}
        </span>
      )}
      {elsewhere && (
        <span className={`file-elsewhere${elsewhere.unmergeable ? " assets" : ""}`} title={overlapTitle(elsewhere)}>
          <BranchIcon size={11} />
        </span>
      )}
      {dir && <span className="file-dir">{dir}</span>}
      {choices && (
        <span className="file-choices">
          {choices.map((choice) => (
            <button
              key={choice.label}
              className="file-choice"
              onClick={choice.onClick}
              disabled={choice.disabled}
              title={choice.title}
            >
              {choice.label}
            </button>
          ))}
        </span>
      )}
      {action && (
        <button
          className="file-action"
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.label}
          aria-label={`${action.label} ${file.path}`}
        >
          {action.icon}
        </button>
      )}
    </li>
  );
}
