import { useMemo, useState, type ReactNode } from "react";
import type { BranchSync } from "../lib/branchSync";
import type { Stacked } from "../api";
import { fullRefName, type CommitRow, type HiddenRef, type Lock, type Submodule, type Visibility, type Worktree } from "../api";
import { stepFocus } from "../lib/inputMode";
import type { LaneLabel } from "../lib/lanes";
import type { RefEntry } from "../lib/refs";
import { useStoredState } from "../lib/settings";
import { BranchIcon, BroomIcon, CloudIcon, EyeOffIcon, GearIcon, PinIcon, PlusIcon, SearchIcon, StashIcon, TagIcon, UnlockIcon } from "./Icons";
import { LockedFileList, SubmoduleList, WorktreeList } from "./sidebar/OtherLists";
import { RefItem, type RefHandlers } from "./sidebar/RefItem";
import { branchGroups, sidebarLists, stashLabel } from "./sidebar/refTree";
import { RefTree, SidebarGroup, SidebarSection, type Folding } from "./sidebar/SidebarSection";
import { Button } from "./ui/Button";

interface Props {
  /** The repository's folder. */
  repoPath: string;
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
  /** The pointer is on a branch or tag, or has left it (null): its lanes light up. */
  onLaneHover: (label: LaneLabel | null) => void;
  /** Show every branch again. */
  onShowAll: () => void;
  /** Open the prune branches dialog (null while that can't be done). */
  onPrune: (() => void) | null;
  /** Open the repository's settings at its remotes. */
  onManageRemotes: (() => void) | null;
  /** Protected branch names, shown with a padlock. */
  protectedBranches: string[];
  /** For local branches that track a remote branch: commits to push and to pull. */
  aheadBehind: Map<string, BranchSync>;
  /** Local branches built on other unmerged branches. */
  stacks: Map<string, Stacked>;
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
  /** The repository's submodules, if it has any. */
  submodules: Submodule[];
  onOpenSubmodule: (submodule: Submodule) => void;
  onSubmoduleMenu: (submodule: Submodule, x: number, y: number) => void;
}

/**
 * Every branch (once: with its copies on remotes), the remote branches that aren't on this
 * computer, tags and stashes (click one to jump to its commit), pinned ones first, and the
 * repository's worktrees, submodules and Git LFS locks. A filter narrows them all.
 */
export function Sidebar(props: Props) {
  const { visibility, pins, selectedId, width, aheadBehind } = props;
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useStoredState<Record<string, boolean>>("sidebar.collapsed", { tags: true });
  const lists = useMemo(() => sidebarLists(props.commits, props.hiddenRefs), [props.commits, props.hiddenRefs]);
  const groups = useMemo(() => branchGroups(lists.branches, lists.remotes, props.protectedBranches), [lists, props.protectedBranches]);

  const needle = filter.trim().toLowerCase();
  const filtering = needle !== "";
  const matches = (entry: RefEntry) => !needle || entry.name.toLowerCase().includes(needle);
  // While filtering, every section is open so nothing that matches is hidden.
  const folding: Folding = {
    isOpen: (key) => filtering || !collapsed[key],
    toggle: (key) => setCollapsed((current) => ({ ...current, [key]: !current[key] })),
  };
  // Groups that start folded ("Only on origin"): open once they're opened.
  const foldedFirst: Folding = {
    isOpen: (key) => filtering || collapsed[key] === false,
    toggle: (key) => setCollapsed((current) => ({ ...current, [key]: current[key] === false })),
  };
  const handlers: RefHandlers = props;
  const branchIcon = <BranchIcon size={13} />;
  const item = (entry: RefEntry, label: string, icon: ReactNode, depth = 0, key = `${entry.kind}:${entry.name}`) => (
    <RefItem
      key={key}
      // A local branch stands for its copies on remotes too: its menu offers them.
      entry={entry.kind === "branch" ? { ...entry, remotes: groups.copies.get(entry.name) } : entry}
      label={label}
      icon={icon}
      depth={depth}
      selected={entry.commitId === selectedId}
      visibility={visibility}
      counts={entry.kind === "branch" ? aheadBehind.get(entry.name) : undefined}
      stack={entry.kind === "branch" ? props.stacks.get(entry.name) : undefined}
      isProtected={entry.kind === "branch" && props.protectedBranches.includes(entry.name)}
      handlers={handlers}
      localOnly={entry.kind === "branch" && !entry.hidden && groups.localOnly.has(entry.name)}
    />
  );
  const tree = (id: string, entries: RefEntry[], labelOf: (entry: RefEntry) => string, icon: ReactNode, baseDepth = 0) => (
    <RefTree id={id} entries={entries} labelOf={labelOf} folding={folding} baseDepth={baseDepth} renderItem={(entry, label, depth) => item(entry, label, icon, depth)} />
  );

  const branches = lists.branches.filter(matches);
  const top = groups.top.filter(matches);
  const rest = groups.rest.filter(matches);
  const remoteOnly = groups.remoteOnly.map(([remote, entries]) => [remote, entries.filter(matches)] as const).filter(([, entries]) => entries.length > 0);
  // The branches at the top are out of their folders: they go by their last part
  // ("world-build-tools"), unless another branch's ends the same way. The whole name is on hover.
  const last = (name: string) => name.slice(name.lastIndexOf("/") + 1);
  const shortName = (entry: RefEntry) => (lists.branches.filter((other) => last(other.name) === last(entry.name)).length === 1 ? last(entry.name) : entry.name);
  const tags = lists.tags.filter(matches);
  const stashes = lists.stashes.filter(matches);
  const locks = props.locks?.filter((lock) => !needle || lock.path.toLowerCase().includes(needle)) ?? null;
  const submodules = props.submodules.filter((submodule) => !needle || submodule.path.toLowerCase().includes(needle));
  const everything = [...lists.branches, ...[...lists.remotes.values()].flat(), ...lists.tags];
  const pinned = pins
    .map((name) => everything.find((entry) => fullRefName(entry) === name))
    .filter((entry): entry is RefEntry => entry !== undefined && matches(entry));
  const soloing = visibility.solo.length > 0;
  // A branch is hidden (or shown alone) with its copies on remotes: they count once.
  const branchOf = (name: string) => {
    if (name.startsWith("refs/heads/")) return name.slice("refs/heads/".length);
    const remote = [...lists.remotes.keys()].find((remote) => name.startsWith(`refs/remotes/${remote}/`));
    return remote ? name.slice(`refs/remotes/${remote}/`.length) : name;
  };
  const hiddenCount = new Set((soloing ? visibility.solo : visibility.hidden).map(branchOf)).size;
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
          <Button kind="link" onClick={props.onShowAll}>
            Show all
          </Button>
        </div>
      )}
      <div className="sidebar-scroll">
        {pinned.length > 0 && (
          <SidebarSection id="pinned" title="Pinned" count={pinned.length} {...section}>
            <ul>{pinned.map((entry) => item(entry, entry.name, <PinIcon size={13} />, 0, `pin:${entry.kind}:${entry.name}`))}</ul>
          </SidebarSection>
        )}
        {/* Each branch once: a local branch and its copy on the remote are one row (with what
            there is to push and pull). The checked-out one and the protected ones are at the
            top; branches only on a remote are folded away under "Only on origin". */}
        <SidebarSection
          id="branches"
          title="Branches"
          count={branches.length}
          empty={branches.length === 0 && remoteOnly.length === 0}
          {...section}
          action={
            (props.onManageRemotes || props.onPrune) && (
              <>
                {props.onManageRemotes && (
                  <button className="sidebar-heading-action" onClick={props.onManageRemotes} title="Add, rename or remove remotes" aria-label="Manage remotes">
                    <GearIcon size={13} />
                  </button>
                )}
                {props.onPrune && (
                  <button className="sidebar-heading-action" onClick={props.onPrune} title="Prune branches: clean up merged ones and ones gone from the remote" aria-label="Prune branches">
                    <BroomIcon size={13} />
                  </button>
                )}
              </>
            )
          }
        >
          <ul>
            {top.map((entry) => item(entry, shortName(entry), branchIcon))}
            {top.length > 0 && rest.length > 0 && <li className="sidebar-divider" aria-hidden />}
            <li>{tree("branches", rest, (e) => e.name, branchIcon)}</li>
            {remoteOnly.map(([remote, entries]) => (
              <SidebarGroup
                key={remote}
                id={`only:${remote}`}
                icon={<CloudIcon size={13} />}
                label={`Only on ${remote}`}
                count={entries.length}
                folding={foldedFirst}
                title={`Branches on ${remote} that aren't on this computer: double-click one to check it out`}
              >
                {tree(`only:${remote}`, entries, (e) => e.name.slice(remote.length + 1), <CloudIcon size={13} />, 1)}
              </SidebarGroup>
            ))}
          </ul>
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
        {submodules.length > 0 && (
          <SidebarSection id="submodules" title="Submodules" count={submodules.length} {...section}>
            <SubmoduleList submodules={submodules} onOpen={props.onOpenSubmodule} onMenu={props.onSubmoduleMenu} />
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
            <LockedFileList repoPath={props.repoPath} locks={locks} error={props.locksError} onMenu={props.onLockMenu} />
          </SidebarSection>
        )}
      </div>
    </aside>
  );
}
