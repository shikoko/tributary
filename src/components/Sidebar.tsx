import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import type { CommitRow } from "../api";
import { collectRefs, type RefEntry } from "../lib/refs";
import { useStoredState } from "../lib/settings";
import { BranchIcon, CheckIcon, ChevronDownIcon, CloudIcon, SearchIcon, StashIcon, TagIcon } from "./Icons";

interface Props {
  commits: CommitRow[];
  selectedId: string | null;
  width: number;
  onSelect: (commitId: string) => void;
  /** Double-click: check the branch out. */
  onActivate: (entry: RefEntry) => void;
  onContextMenu: (entry: RefEntry, x: number, y: number) => void;
}

/** Every branch, remote branch, tag and stash; click one to jump to its commit. */
export function Sidebar({ commits, selectedId, width, onSelect, onActivate, onContextMenu }: Props) {
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useStoredState<Record<string, boolean>>("sidebar.collapsed", { tags: true });
  const lists = useMemo(() => collectRefs(commits), [commits]);

  const needle = filter.trim().toLowerCase();
  const matches = (entry: RefEntry) => !needle || entry.name.toLowerCase().includes(needle);
  const toggle = (key: string) => setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  // While filtering, every section is open so nothing that matches is hidden.
  const isOpen = (key: string) => Boolean(needle) || !collapsed[key];

  const item = (entry: RefEntry, label: string, icon: ReactNode) => (
    <li key={`${entry.kind}:${entry.name}`}>
      <button
        className={`sidebar-item${entry.commitId === selectedId ? " selected" : ""}${entry.current ? " current" : ""}`}
        onClick={() => onSelect(entry.commitId)}
        onDoubleClick={() => onActivate(entry)}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          onSelect(entry.commitId);
          onContextMenu(entry, event.clientX, event.clientY);
        }}
        title={entry.kind === "stash" ? `${entry.name}: ${entry.summary}` : entry.name}
      >
        <span className="sidebar-icon">{entry.current ? <CheckIcon size={13} /> : icon}</span>
        <span className="sidebar-name">{label}</span>
      </button>
    </li>
  );

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
      <div className="sidebar-scroll">
        {section("branches", "Branches", branches.length, <ul>{branches.map((e) => item(e, e.name, <BranchIcon size={13} />))}</ul>)}
        {section(
          "remotes",
          "Remotes",
          remoteCount,
          remotes.map(
            ([remote, entries]) =>
              entries.length > 0 && (
                <div key={remote} className="sidebar-group">
                  <div className="sidebar-group-name">{remote}</div>
                  <ul>{entries.map((e) => item(e, e.name.slice(remote.length + 1), <CloudIcon size={13} />))}</ul>
                </div>
              ),
          ),
        )}
        {section("tags", "Tags", tags.length, <ul>{tags.map((e) => item(e, e.name, <TagIcon size={13} />))}</ul>)}
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
