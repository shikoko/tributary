import { EyeOffIcon, SearchIcon } from "../Icons";
import { Button } from "../ui/Button";

/** The box that narrows the sidebar to what matches. Esc empties it. */
export function SidebarFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="sidebar-filter">
      <SearchIcon size={13} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onChange("");
          }
        }}
        placeholder="Filter branches and tags"
        spellCheck={false}
        aria-label="Filter branches and tags"
      />
    </div>
  );
}

/** How many branches are hidden from the graph, or shown alone, with a way to show them all. */
export function VisibilityBar({ count, soloing, onShowAll }: { count: number; soloing: boolean; onShowAll: () => void }) {
  return (
    <div className="sidebar-visibility">
      <EyeOffIcon size={13} />
      <span>{soloing ? `Showing only ${count === 1 ? "one branch" : `${count} branches`}` : `${count} hidden`}</span>
      <Button kind="link" onClick={onShowAll}>
        Show all
      </Button>
    </div>
  );
}
