import type { ReactNode } from "react";
import type { RefEntry } from "../../lib/refs";
import { ChevronDownIcon, FolderIcon } from "../Icons";
import { rowIndent } from "./RefItem";
import { group, type Node } from "./refTree";

/** Which sections and folders are open. */
export interface Folding {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
}

interface SectionProps {
  /** Remembers whether it's folded. */
  id: string;
  title: string;
  count: number;
  /** While filtering, sections with nothing that matches are left out. */
  filtering: boolean;
  folding: Folding;
  /** Buttons next to the heading, like Prune. */
  action?: ReactNode;
  /** Whether there's nothing in it (when that's not what `count` says). */
  empty?: boolean;
  children: ReactNode;
}

/** A foldable section of the sidebar, like Branches or Tags. */
export function SidebarSection({ id, title, count, filtering, folding, action, empty = count === 0, children }: SectionProps) {
  if (empty && filtering) return null;
  const open = folding.isOpen(id);
  return (
    <section className="sidebar-section" data-tour={`section-${id}`}>
      <div className="sidebar-heading-row">
        <button className="sidebar-heading" onClick={() => folding.toggle(id)} aria-expanded={open}>
          <ChevronDownIcon size={12} className={open ? undefined : "collapsed"} />
          <span>{title}</span>
          <span className="sidebar-count">{count}</span>
        </button>
        {action && <span className="sidebar-heading-actions">{action}</span>}
      </div>
      {open && (empty ? <div className="sidebar-empty">None</div> : children)}
    </section>
  );
}

interface TreeProps {
  /** Keeps folders of different sections apart. */
  id: string;
  entries: RefEntry[];
  labelOf: (entry: RefEntry) => string;
  folding: Folding;
  renderItem: (entry: RefEntry, label: string, depth: number) => ReactNode;
  /** How deep the list itself is: inside a group like "Only on origin". */
  baseDepth?: number;
}

/** A list of entries, with shared prefixes ("feature/…") grouped into folders. → opens a folder, ← closes it. */
export function RefTree({ id, entries, labelOf, folding, renderItem, baseDepth = 0 }: TreeProps) {
  const render = (nodes: Node[], depth: number): ReactNode[] =>
    nodes.map((node) => {
      if (node.kind === "entry") return renderItem(node.entry, node.label, depth);
      const key = `folder:${id}:${node.path}`;
      const open = folding.isOpen(key);
      return (
        <li key={key}>
          <button
            className="sidebar-item sidebar-folder"
            style={{ paddingLeft: rowIndent(depth) }}
            onClick={() => folding.toggle(key)}
            onKeyDown={(event) => {
              if ((event.key === "ArrowRight" && !open) || (event.key === "ArrowLeft" && open)) {
                event.preventDefault();
                folding.toggle(key);
              }
            }}
            aria-expanded={open}
          >
            <span className="sidebar-chevron">
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
  return <ul>{render(group(entries.map((entry) => ({ entry, label: labelOf(entry) }))), baseDepth)}</ul>;
}

interface GroupProps {
  /** Remembers whether it's open. */
  id: string;
  icon: ReactNode;
  label: string;
  count: number;
  folding: Folding;
  /** What's in it, on hover. */
  title?: string;
  children: ReactNode;
}

/** A foldable group in a section, like "Only on origin". */
export function SidebarGroup({ id, icon, label, count, folding, title, children }: GroupProps) {
  const open = folding.isOpen(id);
  return (
    <li>
      <button
        className="sidebar-item sidebar-folder"
        style={{ paddingLeft: rowIndent(0) }}
        title={title}
        onClick={() => folding.toggle(id)}
        onKeyDown={(event) => {
          if ((event.key === "ArrowRight" && !open) || (event.key === "ArrowLeft" && open)) {
            event.preventDefault();
            folding.toggle(id);
          }
        }}
        aria-expanded={open}
      >
        <span className="sidebar-chevron">
          <ChevronDownIcon size={11} className={open ? undefined : "collapsed"} />
        </span>
        <span className="sidebar-group-icon">{icon}</span>
        <span className="sidebar-name">{label}</span>
        <span className="sidebar-count">{count}</span>
      </button>
      {open && children}
    </li>
  );
}
