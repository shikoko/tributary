import { useMemo, useState, type ReactNode } from "react";
import { fullRefName, type CommitRow, type HiddenRef, type Lock, type Visibility, type Worktree } from "../api";
import { stepFocus } from "../lib/inputMode";
import type { RefEntry } from "../lib/refs";
import { useStoredState } from "../lib/settings";
import { BranchIcon, BroomIcon, CloudIcon, EyeOffIcon, PinIcon, PlusIcon, SearchIcon, StashIcon, TagIcon, UnlockIcon } from "./Icons";
import { LockedFileList, WorktreeList } from "./sidebar/OtherLists";
import { RefItem, type RefHandlers } from "./sidebar/RefItem";
import { sidebarLists, stashLabel } from "./sidebar/refTree";
import { RefTree, SidebarSection, type Folding } from "./sidebar/SidebarSection";

interface Props {
  commits: CommitRow[];
  /** Branches and tags left out of the graph. */
  hiddenRefs: HiddenRef[];
  visibility: Visibility;
  /** Full names of pinned branches and tags, in order. */
  pins: string[];
  selectedId: string | null;
  width: number;
  onSelect: (commitId: string) => void;
  /** Double-click: check the branch out. */
  onActivate: (entry: RefEntry) => void;
  onContextMenu: (entry: RefEntry, x: number, y: number) => void;
  /** Alt+click: highlight the entry's history. */
  onFocus: (entry: RefEntry) => void;
  /** The eye button: hide or show the entry in the graph. */
  onToggleVisible: (entry: RefEntry) => void;
  /** Show every branch again. */
  onShowAll: () => void;
  /** Open the prune branches dialog (null while that can't be done). */
  onPrune: (() => void) | null;
  /** Protected branch names, shown with a padlock. */
  protectedBranches: string[];
  /** For local branches that track a remote branch: commits to push and to pull. */
  aheadBehind: Map<string, { ahead: number; behind: number }>;
  /** Files locked with Git LFS, or null when the repository doesn't use locking. */
  locks: Lock[] | null;
  /** Why the locks couldn't be refreshed. */
  locksError: string | null;
  onLockMenu: (lock: Lock, x: number, y: number) => void;
  /** Lock files you choose (null while that can't be done). */
  onLockFiles: (() => void) | null;
  /** Release every lock you hold (null when you hold none, or that can't be done). */
  onReleaseMine: (() => void) | null;
  /** The repository's working trees: shown when there's more than the main one. */
  worktrees: Worktree[];
  onOpenWorktree: (worktree: Worktree) => void;
  onWorktreeMenu: (worktree: Worktree, x: number, y: number) => void;
}

/**
 * Every branch, remote branch, tag and stash (click one to jump to its commit), pinned
 * ones first, and the repository's worktrees and Git LFS locks. A filter narrows them all.
 */
export function Sidebar(props: Props) {
  const { visibility, pins, selectedId, width, aheadBehind } = props;
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useStoredState<Record<string, boolean>>("sidebar.collapsed", { tags: true });
  const lists = useMemo(() => sidebarLists(props.commits, props.hiddenRefs), [props.commits, props.hiddenRefs]);

  const needle = filter.trim().toLowerCase();
  const filtering = needle !== "";
  const matches = (entry: RefEntry) => !needle || entry.name.toLowerCase().includes(needle);
  // While filtering, every section is open so nothing that matches is hidden.
  const folding: Folding = {
    isOpen: (key) => filtering || !collapsed[key],
    toggle: (key) => setCollapsed((current) => ({ ...current, [key]: !current[key] })),
  };
  const handlers: RefHandlers = props;
  const item = (entry: RefEntry, label: string, icon: ReactNode, depth = 0, key = `${entry.kind}:${entry.name}`) => (
    <RefItem
      key={key}
      entry={entry}
      label={label}
      icon={icon}
      depth={depth}
      selected={entry.commitId === selectedId}
      visibility={visibility}
      counts={entry.kind === "branch" ? aheadBehind.get(entry.name) : undefined}
      isProtected={entry.kind === "branch" && props.protectedBranches.includes(entry.name)}
      handlers={handlers}
    />
  );
  const tree = (id: string, entries: RefEntry[], labelOf: (entry: RefEntry) => string, icon: ReactNode) => (
    <RefTree id={id} entries={entries} labelOf={labelOf} folding={folding} renderItem={(entry, label, depth) => item(entry, label, icon, depth)} />
  );

  const branches = lists.branches.filter(matches);
  const tags = lists.tags.filter(matches);
  const stashes = lists.stashes.filter(matches);
  const locks = props.locks?.filter((lock) => !needle || lock.path.toLowerCase().includes(needle)) ?? null;
  const remotes = [...lists.remotes.entries()].map(([remote, entries]) => [remote, entries.filter(matches)] as const);
  const remoteCount = remotes.reduce((sum, [, entries]) => sum + entries.length, 0);
  const everything = [...lists.branches, ...[...lists.remotes.values()].flat(), ...lists.tags];
  const pinned = pins
    .map((name) => everything.find((entry) => fullRefName(entry) === name))
    .filter((entry): entry is RefEntry => entry !== undefined && matches(entry));
  const soloing = visibility.solo.length > 0;
  const hiddenCount = soloing ? visibility.solo.length : visibility.hidden.length;
  const section = { filtering, folding };

  return (
    <aside
      className="sidebar"
      style={{ width }}
      aria-label="Branches and tags"
      onKeyDown={(event) => {
        // ↑ ↓ Home End move between the entries, across sections.
        const target = event.target as HTMLElement;
        if (!target.classList.contains("sidebar-item") || event.key === "ArrowLeft" || event.key === "ArrowRight") return;
        const next = stepFocus([...event.currentTarget.querySelectorAll<HTMLElement>(".sidebar-item")], target, event.key);
        if (next) {
          event.preventDefault();
          next.focus();
          next.scrollIntoView({ block: "nearest" });
        }
      }}
    >
      <div className="sidebar-filter">
        <SearchIcon size={13} />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setFilter("");
            }
          }}
          placeholder="Filter branches and tags"
          spellCheck={false}
          aria-label="Filter branches and tags"
        />
      </div>
      {hiddenCount > 0 && (
        <div className="sidebar-visibility">
          <EyeOffIcon size={13} />
          <span>{soloing ? `Showing only ${hiddenCount === 1 ? "one branch" : `${hiddenCount} branches`}` : `${hiddenCount} hidden`}</span>
          <button className="link-button" onClick={props.onShowAll}>
            Show all
          </button>
        </div>
      )}
      <div className="sidebar-scroll">
        {pinned.length > 0 && (
          <SidebarSection id="pinned" title="Pinned" count={pinned.length} {...section}>
            <ul>{pinned.map((entry) => item(entry, entry.name, <PinIcon size={13} />, 0, `pin:${entry.kind}:${entry.name}`))}</ul>
          </SidebarSection>
        )}
        <SidebarSection
          id="branches"
          title="Branches"
          count={branches.length}
          {...section}
          action={
            props.onPrune && (
              <button className="sidebar-heading-action" onClick={props.onPrune} title="Prune branches: clean up merged ones and ones gone from the remote" aria-label="Prune branches">
                <BroomIcon size={13} />
              </button>
            )
          }
        >
          {tree("branches", branches, (e) => e.name, <BranchIcon size={13} />)}
        </SidebarSection>
        <SidebarSection id="remotes" title="Remotes" count={remoteCount} {...section}>
          {remotes.map(
            ([remote, entries]) =>
              entries.length > 0 && (
                <div key={remote} className="sidebar-group">
                  <div className="sidebar-group-name">{remote}</div>
                  {tree(`remote:${remote}`, entries, (e) => e.name.slice(remote.length + 1), <CloudIcon size={13} />)}
                </div>
              ),
          )}
        </SidebarSection>
        <SidebarSection id="tags" title="Tags" count={tags.length} {...section}>
          {tree("tags", tags, (e) => e.name, <TagIcon size={13} />)}
        </SidebarSection>
        <SidebarSection id="stashes" title="Stashes" count={stashes.length} {...section}>
          <ul>{stashes.map((e) => item(e, stashLabel(e), <StashIcon size={13} />))}</ul>
        </SidebarSection>
        {props.worktrees.length > 1 && (
          <SidebarSection id="worktrees" title="Worktrees" count={props.worktrees.length} {...section}>
            <WorktreeList worktrees={props.worktrees} onSelect={props.onSelect} onOpen={props.onOpenWorktree} onMenu={props.onWorktreeMenu} />
          </SidebarSection>
        )}
        {locks && (
          <SidebarSection
            id="locks"
            title="Locked files"
            count={locks.length}
            {...section}
            action={
              <>
                {props.onReleaseMine && (
                  <button className="sidebar-heading-action" onClick={props.onReleaseMine} title="Release all my locks" aria-label="Release all my locks">
                    <UnlockIcon size={13} />
                  </button>
                )}
                {props.onLockFiles && (
                  <button className="sidebar-heading-action" onClick={props.onLockFiles} title="Lock files…" aria-label="Lock files">
                    <PlusIcon size={13} />
                  </button>
                )}
              </>
            }
          >
            <LockedFileList locks={locks} error={props.locksError} onMenu={props.onLockMenu} />
          </SidebarSection>
        )}
      </div>
    </aside>
  );
}
