import { useContext, type MouseEvent, type ReactNode } from "react";
import { fullRefName, type Stacked, type Visibility } from "../../api";
import { pressLabel } from "../../lib/drag";
import { PullRequestsContext } from "../../lib/pullRequests";
import type { RefEntry } from "../../lib/refs";
import { CheckIcon, EyeIcon, EyeOffIcon, LockIcon } from "../Icons";
import { PullRequestBadge } from "../RefPills";

/** What clicking, double-clicking and right-clicking an entry does. */
export interface RefHandlers {
  onSelect: (commitId: string) => void;
  /** Double-click: check the branch out. */
  onActivate: (entry: RefEntry) => void;
  onContextMenu: (entry: RefEntry, x: number, y: number) => void;
  /** Alt+click: highlight the entry's history. */
  onFocus: (entry: RefEntry) => void;
  /** The eye button: hide or show the entry in the graph. */
  onToggleVisible: (entry: RefEntry) => void;
}

interface Props {
  entry: RefEntry;
  label: string;
  icon: ReactNode;
  /** How deep in folders it is. */
  depth?: number;
  selected: boolean;
  visibility: Visibility;
  /** Commits to push and to pull, for a branch with an upstream. */
  counts?: { ahead: number; behind: number };
  /** For a branch built on another unmerged branch: which, and whether that was rewritten since. */
  stack?: Stacked;
  isProtected: boolean;
  handlers: RefHandlers;
}

/** A branch, remote branch, tag or stash in the sidebar. Branches can be dragged onto commits to merge or rebase. */
export function RefItem({ entry, label, icon, depth = 0, selected, visibility, counts, stack, isProtected, handlers }: Props) {
  const pullRequests = useContext(PullRequestsContext);
  // The branch below, without the folder both are in ("on export" for feature/export).
  const folder = label && entry.name.endsWith(label) ? entry.name.slice(0, entry.name.length - label.length) : "";
  const below = stack && folder && stack.on.startsWith(folder) ? stack.on.slice(folder.length) : stack?.on;
  const fullName = fullRefName(entry);
  const soloing = visibility.solo.length > 0;
  const soloed = soloing && fullName !== null && visibility.solo.includes(fullName);
  const canHide = fullName !== null && !entry.current;
  const pr =
    entry.kind === "branch"
      ? pullRequests?.find(entry.name, true, [], entry.upstream)
      : entry.kind === "remote"
        ? pullRequests?.find(entry.name, false, [])
        : undefined;
  return (
    <li>
      <div
        className={`sidebar-item${selected && !entry.hidden ? " selected" : ""}${entry.current ? " current" : ""}${entry.hidden ? " hidden-ref" : ""}`}
        style={depth ? { paddingLeft: 12 + depth * 14 } : undefined}
        role="button"
        tabIndex={0}
        onPointerDown={(event) => {
          if (entry.kind !== "stash" && !entry.hidden && !event.altKey) pressLabel(event, entry.name);
        }}
        onClick={(event) => (event.altKey && entry.kind !== "stash" ? handlers.onFocus(entry) : handlers.onSelect(entry.commitId))}
        onKeyDown={(event) => event.key === "Enter" && handlers.onSelect(entry.commitId)}
        onDoubleClick={() => !entry.hidden && handlers.onActivate(entry)}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          handlers.onSelect(entry.commitId);
          handlers.onContextMenu(entry, event.clientX, event.clientY);
        }}
        title={entry.kind === "stash" ? `${entry.name}: ${entry.summary}` : entry.hidden ? `${entry.name} (hidden)` : entry.name}
      >
        <span className="sidebar-icon">{entry.current ? <CheckIcon size={13} /> : icon}</span>
        <span className="sidebar-name">{label}</span>
        {stack && (
          <span
            className={`sidebar-stack${stack.moved ? " moved" : ""}`}
            title={
              stack.moved
                ? `Built on an earlier version of ${stack.on}, which was rewritten since: check ${entry.name} out, then move it onto the new one from its menu`
                : `Built on ${stack.on}: rebasing ${entry.name} moves ${stack.on} along`
            }
          >
            {stack.moved ? `${below} moved` : `on ${below}`}
          </span>
        )}
        {isProtected && (
          <span className="sidebar-lock" title={`${entry.name} is protected: it can't be deleted, and rewriting it needs its name typed`}>
            <LockIcon size={11} />
          </span>
        )}
        {pr && <PullRequestBadge pr={pr} onOpen={pullRequests!.open} />}
        {counts && (counts.ahead > 0 || counts.behind > 0) && (
          <span className="sidebar-counts" title={`${counts.ahead} to push, ${counts.behind} to pull (${entry.upstream ?? "upstream"})`}>
            {counts.ahead > 0 && <span>↑{counts.ahead}</span>}
            {counts.behind > 0 && <span>↓{counts.behind}</span>}
          </span>
        )}
        {canHide && (
          <button
            className={`sidebar-eye${entry.hidden ? " off" : ""}${soloed ? " solo" : ""}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              handlers.onToggleVisible(entry);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            title={
              soloing
                ? soloed
                  ? `Stop showing only ${entry.name}`
                  : `Also show ${entry.name}`
                : entry.hidden
                  ? `Show ${entry.name} in the graph`
                  : `Hide ${entry.name} from the graph`
            }
            aria-label={entry.hidden ? `Show ${entry.name}` : `Hide ${entry.name}`}
          >
            {entry.hidden ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
          </button>
        )}
      </div>
    </li>
  );
}
