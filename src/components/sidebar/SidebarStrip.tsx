import type { ReactNode } from "react";

/** A section of the sidebar, as the strip shows it. */
export interface StripSection {
  /** The section's id in the sidebar (SidebarSection's `id`). */
  id: string;
  label: string;
  icon: ReactNode;
  /** A count worth noticing, like stashes kept: shown on the icon when there are any. */
  count?: number;
}

/**
 * The sidebar in a narrow window: a strip of icons, one for each of its sections. Clicking
 * one opens the whole sidebar over the commit list, at that section; clicking it again, or
 * Esc, or a click outside it, closes it.
 */
export function SidebarStrip({ sections, open, onOpen }: { sections: StripSection[]; open: string | null; onOpen: (id: string) => void }) {
  return (
    <nav className="sidebar-strip" aria-label="Sidebar">
      {sections.map((section) => (
        <button
          key={section.id}
          className={`sidebar-strip-button${open === section.id ? " open" : ""}`}
          data-section={section.id}
          title={section.label}
          aria-expanded={open === section.id}
          onClick={() => onOpen(section.id)}
        >
          {section.icon}
          {/* Its name is its words, the count it shows among them: "Stashes 2". */}
          <span className="sidebar-strip-label">{section.label}</span>
          {section.count ? (
            <span className="sidebar-strip-count">
              <span>{section.count}</span>
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
