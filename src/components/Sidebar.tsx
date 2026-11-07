import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { fullRefName, type CommitRow, type HiddenRef, type Visibility } from "../api";
import { pressLabel } from "../lib/drag";
import { collectRefs, type RefEntry } from "../lib/refs";
import { useStoredState } from "../lib/settings";
import {
  BranchIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  PinIcon,
  SearchIcon,
  StashIcon,
  TagIcon,
} from "./Icons";

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
  /** For local branches that track a remote branch: commits to push and to pull. */
  aheadBehind: Map<string, { ahead: number; behind: number }>;
}

/** An entry, or a folder of entries that share a prefix like "feature/". */
type Node = { kind: "entry"; entry: RefEntry; label: string } | { kind: "folder"; path: string; name: string; children: Node[]; count: number };

/** Group names that share a prefix ("feature/a", "feature/b") into folders. Lone names stay as they are. */
function group(entries: { entry: RefEntry; label: string }[], prefix = ""): Node[] {
  const folders = new Map<string, { entry: RefEntry; label: string }[]>();
  for (const item of entries) {
    const slash = item.label.indexOf("/");
    if (slash <= 0) continue;
    const name = item.label.slice(0, slash);
    folders.set(name, [...(folders.get(name) ?? []), item]);
  }
  const nodes: Node[] = [];
  const placed = new Set<string>();
  for (const item of entries) {
    const slash = item.label.indexOf("/");
    const name = slash > 0 ? item.label.slice(0, slash) : null;
    const members = name ? folders.get(name) : undefined;
    if (!name || !members || members.length < 2) {
      nodes.push({ kind: "entry", ...item });
    } else if (!placed.has(name)) {
      placed.add(name);
      const path = `${prefix}${name}/`;
      const children = group(
        members.map((member) => ({ entry: member.entry, label: member.label.slice(name.length + 1) })),
        path,
      );
      nodes.push({ kind: "folder", path, name, children, count: members.length });
    }
  }
  return nodes;
}

/** Every branch, remote branch, tag and stash; click one to jump to its commit. */
export function Sidebar(props: Props) {
  const { commits, hiddenRefs, visibility, pins, selectedId, width, onSelect, onActivate, onContextMenu } = props;
  const { onFocus, onToggleVisible, aheadBehind } = props;
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useStoredState<Record<string, boolean>>("sidebar.collapsed", { tags: true });
  const lists = useMemo(() => {
    const lists = collectRefs(commits);
    // Hidden branches and tags are listed too, so they can be shown again.
    const byName = (a: RefEntry, b: RefEntry) => a.name.localeCompare(b.name, undefined, { numeric: true });
    for (const ref of hiddenRefs) {
      const entry: RefEntry = { kind: ref.kind === "head" ? "branch" : ref.kind, name: ref.name, commitId: ref.commit, current: false, summary: "", upstream: ref.upstream, hidden: true };
      if (ref.kind === "branch") lists.branches.push(entry);
      else if (ref.kind === "tag") lists.tags.push(entry);
      else if (ref.kind === "remote") {
        const remote = ref.name.slice(0, Math.max(0, ref.name.indexOf("/"))) || ref.name;
        if (!lists.remotes.has(remote)) lists.remotes.set(remote, []);
        lists.remotes.get(remote)!.push(entry);
      }
    }
    lists.branches.sort((a, b) => Number(b.current) - Number(a.current) || byName(a, b));
    lists.tags.sort(byName);
    for (const entries of lists.remotes.values()) entries.sort(byName);
    return lists;
  }, [commits, hiddenRefs]);

  const needle = filter.trim().toLowerCase();
  const matches = (entry: RefEntry) => !needle || entry.name.toLowerCase().includes(needle);
  const toggle = (key: string) => setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  // While filtering, every section is open so nothing that matches is hidden.
  const isOpen = (key: string) => Boolean(needle) || !collapsed[key];
  const soloing = visibility.solo.length > 0;

  const item = (entry: RefEntry, label: string, icon: ReactNode, depth = 0, key = `${entry.kind}:${entry.name}`) => {
    const counts = entry.kind === "branch" ? aheadBehind.get(entry.name) : undefined;
    const fullName = fullRefName(entry);
    const soloed = soloing && fullName !== null && visibility.solo.includes(fullName);
    const canHide = fullName !== null && !entry.current;
    return (
      <li key={key}>
        <div
          className={`sidebar-item${entry.commitId === selectedId && !entry.hidden ? " selected" : ""}${entry.current ? " current" : ""}${entry.hidden ? " hidden-ref" : ""}`}
          style={depth ? { paddingLeft: 12 + depth * 14 } : undefined}
          role="button"
          tabIndex={0}
          onPointerDown={(event) => {
            if (entry.kind !== "stash" && !entry.hidden && !event.altKey) pressLabel(event, entry.name);
          }}
          onClick={(event) => (event.altKey && entry.kind !== "stash" ? onFocus(entry) : onSelect(entry.commitId))}
          onKeyDown={(event) => event.key === "Enter" && onSelect(entry.commitId)}
          onDoubleClick={() => !entry.hidden && onActivate(entry)}
          onContextMenu={(event: MouseEvent) => {
            event.preventDefault();
            onSelect(entry.commitId);
            onContextMenu(entry, event.clientX, event.clientY);
          }}
          title={entry.kind === "stash" ? `${entry.name}: ${entry.summary}` : entry.hidden ? `${entry.name} (hidden)` : entry.name}
        >
          <span className="sidebar-icon">{entry.current ? <CheckIcon size={13} /> : icon}</span>
          <span className="sidebar-name">{label}</span>
          {counts && (counts.ahead > 0 || counts.behind > 0) && (
            <span
              className="sidebar-counts"
              title={`${counts.ahead} to push, ${counts.behind} to pull (${entry.upstream ?? "upstream"})`}
            >
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
                onToggleVisible(entry);
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
  };

  /** A list of entries, with shared prefixes grouped into folders. */
  const tree = (sectionKey: string, entries: RefEntry[], labelOf: (entry: RefEntry) => string, icon: ReactNode) => {
    const render = (nodes: Node[], depth: number): ReactNode[] =>
      nodes.map((node) => {
        if (node.kind === "entry") return item(node.entry, node.label, icon, depth);
        const key = `folder:${sectionKey}:${node.path}`;
        const open = isOpen(key);
        return (
          <li key={key}>
            <button
              className="sidebar-item sidebar-folder"
              style={{ paddingLeft: 12 + depth * 14 }}
              onClick={() => toggle(key)}
              aria-expanded={open}
            >
              <span className="sidebar-icon">
                <ChevronDownIcon size={11} className={open ? undefined : "collapsed"} />
              </span>
              <FolderIcon size={13} />
              <span className="sidebar-name">{node.name}</span>
              <span className="sidebar-count">{node.count}</span>
            </button>
            {open && <ul>{render(node.children, depth + 1)}</ul>}
          </li>
        );
      });
    return <ul>{render(group(entries.map((entry) => ({ entry, label: labelOf(entry) }))), 0)}</ul>;
  };

  const section = (key: string, title: string, count: number, children: ReactNode) =>
    (count > 0 || !needle) && (
      <section className="sidebar-section" key={key}>
        <button className="sidebar-heading" onClick={() => toggle(key)} aria-expanded={isOpen(key)}>
          <ChevronDownIcon size={12} className={isOpen(key) ? undefined : "collapsed"} />
          <span>{title}</span>
          <span className="sidebar-count">{count}</span>
        </button>
        {isOpen(key) && (count > 0 ? children : <div className="sidebar-empty">None</div>)}
      </section>
    );

  const branches = lists.branches.filter(matches);
  const tags = lists.tags.filter(matches);
  const stashes = lists.stashes.filter(matches);
  const remotes = [...lists.remotes.entries()].map(([remote, entries]) => [remote, entries.filter(matches)] as const);
  const remoteCount = remotes.reduce((sum, [, entries]) => sum + entries.length, 0);
  const everything = [...lists.branches, ...[...lists.remotes.values()].flat(), ...lists.tags];
  const pinned = pins
    .map((name) => everything.find((entry) => fullRefName(entry) === name))
    .filter((entry): entry is RefEntry => entry !== undefined && matches(entry));
  const hiddenCount = soloing ? visibility.solo.length : visibility.hidden.length;

  return (
    <aside className="sidebar" style={{ width }} aria-label="Branches and tags">
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
        {pinned.length > 0 &&
          section(
            "pinned",
            "Pinned",
            pinned.length,
            <ul>
              {pinned.map((entry) => item(entry, entry.name, <PinIcon size={13} />, 0, `pin:${entry.kind}:${entry.name}`))}
            </ul>,
          )}
        {section("branches", "Branches", branches.length, tree("branches", branches, (e) => e.name, <BranchIcon size={13} />))}
        {section(
          "remotes",
          "Remotes",
          remoteCount,
          remotes.map(
            ([remote, entries]) =>
              entries.length > 0 && (
                <div key={remote} className="sidebar-group">
                  <div className="sidebar-group-name">{remote}</div>
                  {tree(`remote:${remote}`, entries, (e) => e.name.slice(remote.length + 1), <CloudIcon size={13} />)}
                </div>
              ),
          ),
        )}
        {section("tags", "Tags", tags.length, tree("tags", tags, (e) => e.name, <TagIcon size={13} />))}
        {section(
          "stashes",
          "Stashes",
          stashes.length,
          <ul>{stashes.map((e) => item(e, stashLabel(e), <StashIcon size={13} />))}</ul>,
        )}
      </div>
    </aside>
  );
}

/** "Try a collapsible sidebar" for a stash made with the message "On main: Try a collapsible sidebar". */
function stashLabel(entry: RefEntry): string {
  return entry.summary.replace(/^(WIP )?on [^:]+: /i, "") || entry.name;
}
