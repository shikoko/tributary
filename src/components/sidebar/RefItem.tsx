import { useContext, type MouseEvent, type ReactNode } from "react";
import { fullRefName, type Stacked, type Visibility } from "../../api";
import { describeSync, type BranchSync } from "../../lib/branchSync";
import { pressLabel } from "../../lib/drag";
import { PullRequestsContext } from "../../lib/pullRequests";
import type { RefEntry } from "../../lib/refs";
import { CheckIcon, EyeIcon, EyeOffIcon, LaptopIcon, LockIcon } from "../Icons";
import { PullRequestBadge } from "../RefPills";

/**
 * How far in a row starts, at this depth in folders. Every row starts with a chevron's
 * width (a folder's chevron, or nothing), so a folder's icon and name line up with its
 * neighbours', and its branches' are one step in.
 */
export const rowIndent = (depth: number) => 6 + depth * 16;

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
  /** The pointer is on the entry (its commit), or has left it (null): its lane lights up. */
  onLaneHover: (commitId: string | null) => void;
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
  counts?: BranchSync;
  /** For a branch built on another unmerged branch: which, and whether that was rewritten since. */
  stack?: Stacked;
  isProtected: boolean;
  handlers: RefHandlers;
  /** A local branch that isn't on any remote. */
  localOnly?: boolean;
}

/** A branch, remote branch, tag or stash in the sidebar. Branches can be dragged onto commits to merge or rebase. */
export function RefItem({ entry, label, icon, depth = 0, selected, visibility, counts, stack, isProtected, handlers, localOnly = false }: Props) {
  const pullRequests = useContext(PullRequestsContext);
  const lights = entry.kind !== "stash" && !entry.hidden;
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
        style={{ paddingLeft: rowIndent(depth) }}
        role="button"
        tabIndex={0}
        // Its lane lights up in the graph.
        onPointerEnter={() => lights && handlers.onLaneHover(entry.commitId)}
        onPointerLeave={() => lights && handlers.onLaneHover(null)}
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
        <span className="sidebar-chevron" />
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
        {localOnly && (
          <span className="sidebar-local" title={`${entry.name} is only on this computer: it hasn't been pushed`}>
            <LaptopIcon size={12} />
          </span>
        )}
        {pr && <PullRequestBadge pr={pr} onOpen={pullRequests!.open} />}
        {counts && (counts.ahead > 0 || counts.behind > 0) && (
          <span className="sidebar-counts" title={describeSync({ ...counts, upstream: entry.upstream ?? counts.upstream }) ?? undefined}>
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
