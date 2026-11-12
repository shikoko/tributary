import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Overlap } from "../api";
import { byBranch, people } from "../lib/elsewhere";
import { plural, relativeTime } from "../lib/format";
import { baseName, folderOf } from "../lib/paths";
import { BranchIcon, ChevronDownIcon, CloseIcon, EyeIcon } from "./Icons";
import { Button } from "./ui/Button";

/** Files listed per branch before "and N more". */
const MAX_FILES = 50;
const WIDTH = 480;

interface Props {
  overlaps: Overlap[];
  /** The status bar's button, to open above and to give the focus back to. */
  anchor: HTMLElement;
  onClose: () => void;
  /** Select a commit (another branch's change to a file). */
  onShowCommit: (id: string) => void;
  /** Highlight a branch's history. */
  onShowBranch: (branch: string) => void;
}

/**
 * The branches where files you're changing are also being worked on, from the status
 * bar: who's working on each, when, and which of your files. Branches with assets that
 * can't be merged come first.
 */
export function ElsewherePanel({ overlaps, anchor, onClose, onShowCommit, onShowBranch }: Props) {
  const branches = useMemo(() => byBranch(overlaps), [overlaps]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(branches.slice(0, branches.length <= 3 ? 3 : 1).map((b) => b.branch)));
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: 8, bottom: 32 });

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 16);
    setPlace({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      bottom: window.innerHeight - rect.top + 6,
    });
  }, [anchor]);

  // Esc and clicks elsewhere close it, and the focus goes back to the status bar.
  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    // The panel as it is now: by the time this is cleaned up, it may be gone.
    const element = panel.current;
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      if (document.activeElement === document.body || element?.contains(document.activeElement)) anchor.focus();
    };
  }, [anchor, onClose]);

  const toggle = (branch: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(branch)) next.delete(branch);
      else next.add(branch);
      return next;
    });

  return (
    <div
      ref={panel}
      className="elsewhere-panel"
      role="dialog"
      aria-label="Also changed on other branches"
      tabIndex={-1}
      style={{ left: place.left, bottom: place.bottom, width: Math.min(WIDTH, window.innerWidth - 16) }}
    >
      <header className="elsewhere-panel-header">
        <div>
          <strong>Also changed on other branches</strong>
          <span>
            {plural(overlaps.length, "file")} you're changing, on {plural(branches.length, "branch", "branches")}, in the last 30 days
          </span>
        </div>
        <Button kind="icon" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <CloseIcon size={14} />
        </Button>
      </header>
      <ul className="elsewhere-branches">
        {branches.map((entry) => {
          const expanded = open.has(entry.branch);
          return (
            <li key={entry.branch} className={`elsewhere-branch-entry${entry.assets > 0 ? " assets" : ""}`}>
              <div className="elsewhere-branch-row">
                <button className="elsewhere-branch-toggle" onClick={() => toggle(entry.branch)} aria-expanded={expanded}>
                  <ChevronDownIcon size={12} className={`elsewhere-chevron${expanded ? " open" : ""}`} />
                  <BranchIcon size={13} />
                  <span className="elsewhere-branch-name">{entry.branch}</span>
                  <span className="elsewhere-branch-count">
                    {plural(entry.files.length, "file")}
                    {entry.assets > 0 && ` · ${entry.assets === entry.files.length ? (entry.assets === 1 ? "an asset" : "all assets") : plural(entry.assets, "asset")}`}
                  </span>
                </button>
                <Button kind="icon" onClick={() => onShowBranch(entry.branch)} title={`Highlight ${entry.branch}'s history`} aria-label={`Highlight ${entry.branch}`}>
                  <EyeIcon size={14} />
                </Button>
              </div>
              <div className="elsewhere-branch-who">
                {people(entry.authors)} · {relativeTime(entry.latest)}
              </div>
              {expanded && (
                <ul className="elsewhere-files">
                  {entry.files.slice(0, MAX_FILES).map(({ overlap, change }) => (
                    <li key={overlap.path}>
                      <button className="elsewhere-file-row" onClick={() => onShowCommit(change.commit)} title={`${overlap.path}\nShow "${change.summary}"`}>
                        <span className={`elsewhere-file-name${overlap.unmergeable ? " asset" : ""}`}>{baseName(overlap.path)}</span>
                        {folderOf(overlap.path) && <span className="elsewhere-file-dir">{folderOf(overlap.path)}</span>}
                        <span className="elsewhere-file-change">
                          {change.author}, {relativeTime(change.time)}
                        </span>
                      </button>
                    </li>
                  ))}
                  {entry.files.length > MAX_FILES && <li className="muted elsewhere-more">and {plural(entry.files.length - MAX_FILES, "more file")}</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
