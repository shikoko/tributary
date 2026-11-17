import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BranchSync } from "../lib/branchSync";
import type { Stacked } from "../api";
import { fullRefName, type CommitRow, type HiddenRef, type Lock, type Submodule, type Visibility, type Worktree } from "../api";
import { stepFocus } from "../lib/inputMode";
import type { LaneLabel } from "../lib/lanes";
import type { RefEntry } from "../lib/refs";
import { useStoredState } from "../lib/settings";
import { BranchIcon, BroomIcon, CloudIcon, GearIcon, PinIcon, PlusIcon, StashIcon, TagIcon, UnlockIcon, ViewIcon } from "./Icons";
import { LockedFileList, SubmoduleList, WorktreeList } from "./sidebar/OtherLists";
import { RefItem, type RefHandlers } from "./sidebar/RefItem";
import { branchCount, branchGroups, shortName, sidebarLists, stashLabel } from "./sidebar/refTree";
import { HeadingAction, RefTree, SidebarGroup, SidebarSection, type Folding } from "./sidebar/SidebarSection";
import { SidebarFilter, VisibilityBar } from "./sidebar/SidebarTop";
import { IssueList, RequestList, SIDEBAR_SECTIONS, useMyIssues, useRequests } from "./sidebar/WorkLists";
import { ContextMenu } from "./ContextMenu";
import { Button } from "./ui/Button";

interface Props {
  /** Open Settings → Sidebar. */
  onSidebarSettings?: () => void;
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
  /** A section to open and show, its heading focused: the one chosen in the strip, in a narrow window. */
  reveal?: string | null;
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
  const aside = useRef<HTMLElement>(null);
  // The section chosen in the strip: opened, scrolled to and focused, once it's drawn open.
  const { reveal } = props;
  useEffect(() => {
    if (!reveal) return;
    setCollapsed((current) => (current[reveal] ? { ...current, [reveal]: false } : current));
    const frame = requestAnimationFrame(() => {
      const heading = aside.current?.querySelector<HTMLElement>(`[data-tour="section-${reveal}"] .sidebar-heading`);
      heading?.scrollIntoView({ block: "start" });
      heading?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, setCollapsed]);
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
  // A lane lit from one of these labels goes out with the sidebar (the strip's panel closed
  // with Esc, or the window made narrow): no pointer leaves the label then.
  const litHere = useRef(false);
  const { onLaneHover } = props;
  useEffect(
    () => () => {
      if (litHere.current) onLaneHover(null);
    },
    [onLaneHover],
  );
  const handlers: RefHandlers = {
    ...props,
    onLaneHover: (label) => {
      litHere.current = label !== null;
      onLaneHover(label);
    },
  };
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
  const hiddenCount = branchCount(soloing ? visibility.solo : visibility.hidden, [...lists.remotes.keys()]);
  const section = { filtering, folding };
  // The sections shown: all but those switched off (Sections menu, or Settings → Sidebar).
  const [hiddenSections, setHiddenSections] = useStoredState<string[]>("sidebar.hiddenSections", []);
  const shows = (id: string) => !hiddenSections.includes(id);
  const toggleSection = (id: string) => setHiddenSections((hidden) => (hidden.includes(id) ? hidden.filter((other) => other !== id) : [...hidden, id]));
  const [sectionsMenu, setSectionsMenu] = useState<{ x: number; y: number } | null>(null);
  const requests = useRequests()?.list ?? [];
  const { issues, error: issuesError } = useMyIssues(props.repoPath, shows("issues"));

  return (
    <aside
      ref={aside}
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
      <div className="sidebar-top">
        <SidebarFilter value={filter} onChange={setFilter} />
        <Button
          kind="icon"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setSectionsMenu({ x: box.left, y: box.bottom + 4 });
          }}
          title="Choose what the sidebar shows"
          aria-label="Sidebar sections"
          aria-haspopup="menu"
        >
          <ViewIcon size={15} />
        </Button>
      </div>
      {/* On the page, not in the sidebar's frame, which clips and animates what's in it. */}
      {sectionsMenu &&
        createPortal(
        <ContextMenu
          x={sectionsMenu.x}
          y={sectionsMenu.y}
          onClose={() => setSectionsMenu(null)}
          items={[
            ...SIDEBAR_SECTIONS.map((entry) => ({ label: entry.title, checked: shows(entry.id), onSelect: () => toggleSection(entry.id) })),
            ...(props.onSidebarSettings ? [{ label: "Sidebar settings…", separated: true, onSelect: props.onSidebarSettings }] : []),
          ]}
        />,
          document.body,
        )}
      {hiddenCount > 0 && <VisibilityBar count={hiddenCount} soloing={soloing} onShowAll={props.onShowAll} />}
      <div className="sidebar-scroll">
        {pinned.length > 0 && (
          <SidebarSection id="pinned" title="Pinned" count={pinned.length} {...section}>
            <ul>{pinned.map((entry) => item(entry, entry.name, <PinIcon size={13} />, 0, `pin:${entry.kind}:${entry.name}`))}</ul>
          </SidebarSection>
        )}
        {/* Each branch once: a local branch and its copy on the remote are one row (with what
            there is to push and pull). The checked-out one and the protected ones are at the
            top; branches only on a remote are folded away under "Only on origin". */}
        {shows("branches") && (
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
                  <HeadingAction label="Manage remotes" title="Add, rename or remove remotes" onClick={props.onManageRemotes}>
                    <GearIcon size={13} />
                  </HeadingAction>
                )}
                {props.onPrune && (
                  <HeadingAction label="Prune branches" title="Prune branches: clean up merged ones and ones gone from the remote" onClick={props.onPrune}>
                    <BroomIcon size={13} />
                  </HeadingAction>
                )}
              </>
            )
          }
        >
          <ul>
            {/* Out of their folders, by their last part: the whole name is on hover. */}
            {top.map((entry) => item(entry, shortName(entry, lists.branches), branchIcon))}
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
        )}
        {shows("pullRequests") && requests.length > 0 && (
          <SidebarSection id="pullRequests" title="Pull requests" count={requests.length} {...section}>
            <RequestList filter={needle} />
          </SidebarSection>
        )}
        {shows("issues") && (issues?.length || issuesError) ? (
          <SidebarSection id="issues" title="Issues" count={issues?.length ?? 0} {...section}>
            <IssueList issues={issues ?? []} error={issuesError} filter={needle} />
          </SidebarSection>
        ) : null}
        {shows("tags") && (
          <SidebarSection id="tags" title="Tags" count={tags.length} {...section}>
            {tree("tags", tags, (e) => e.name, <TagIcon size={13} />)}
          </SidebarSection>
        )}
        {shows("stashes") && (
          <SidebarSection id="stashes" title="Stashes" count={stashes.length} {...section}>
            <ul>{stashes.map((e) => item(e, stashLabel(e), <StashIcon size={13} />))}</ul>
          </SidebarSection>
        )}
        {shows("worktrees") && props.worktrees.length > 1 && (
          <SidebarSection id="worktrees" title="Worktrees" count={props.worktrees.length} {...section}>
            <WorktreeList worktrees={props.worktrees} onSelect={props.onSelect} onOpen={props.onOpenWorktree} onMenu={props.onWorktreeMenu} />
          </SidebarSection>
        )}
        {shows("submodules") && submodules.length > 0 && (
          <SidebarSection id="submodules" title="Submodules" count={submodules.length} {...section}>
            <SubmoduleList submodules={submodules} onOpen={props.onOpenSubmodule} onMenu={props.onSubmoduleMenu} />
          </SidebarSection>
        )}
        {shows("locks") && locks && (
          <SidebarSection
            id="locks"
            title="Locked files"
            count={locks.length}
            {...section}
            action={
              <>
                {props.onReleaseMine && (
                  <HeadingAction label="Release all my locks" onClick={props.onReleaseMine}>
                    <UnlockIcon size={13} />
                  </HeadingAction>
                )}
                {props.onLockFiles && (
                  <HeadingAction label="Lock files" title="Lock files…" onClick={props.onLockFiles}>
                    <PlusIcon size={13} />
                  </HeadingAction>
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
