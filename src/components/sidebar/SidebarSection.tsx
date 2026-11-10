import type { ReactNode } from "react";
import type { RefEntry } from "../../lib/refs";
import { ChevronDownIcon, FolderIcon } from "../Icons";
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
  /** A button next to the heading, like Prune. */
  action?: ReactNode;
  children: ReactNode;
}

/** A foldable section of the sidebar, like Branches or Tags. */
export function SidebarSection({ id, title, count, filtering, folding, action, children }: SectionProps) {
  if (count === 0 && filtering) return null;
  const open = folding.isOpen(id);
  return (
    <section className="sidebar-section" data-tour={`section-${id}`}>
      <div className="sidebar-heading-row">
        <button className="sidebar-heading" onClick={() => folding.toggle(id)} aria-expanded={open}>
          <ChevronDownIcon size={12} className={open ? undefined : "collapsed"} />
          <span>{title}</span>
          <span className="sidebar-count">{count}</span>
        </button>
        {action}
      </div>
      {open && (count > 0 ? children : <div className="sidebar-empty">None</div>)}
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
}

/** A list of entries, with shared prefixes ("feature/…") grouped into folders. → opens a folder, ← closes it. */
export function RefTree({ id, entries, labelOf, folding, renderItem }: TreeProps) {
  const render = (nodes: Node[], depth: number): ReactNode[] =>
    nodes.map((node) => {
      if (node.kind === "entry") return renderItem(node.entry, node.label, depth);
      const key = `folder:${id}:${node.path}`;
      const open = folding.isOpen(key);
      return (
        <li key={key}>
          <button
            className="sidebar-item sidebar-folder"
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() => folding.toggle(key)}
            onKeyDown={(event) => {
              if ((event.key === "ArrowRight" && !open) || (event.key === "ArrowLeft" && open)) {
                event.preventDefault();
                folding.toggle(key);
              }
            }}
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
}
