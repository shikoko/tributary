import { useMemo, useRef, useState, type ReactNode } from "react";
import { SearchIcon } from "./Icons";

export interface Command {
  id: string;
  label: string;
  /** Like "Branch" or "View", shown on the right. */
  group?: string;
  icon?: ReactNode;
  shortcut?: string;
  /** Other words it's found by. */
  keywords?: string;
  run: () => void;
}

/** How well `label` matches the typed words: lower is better, null for no match. */
function score(label: string, words: string[]): number | null {
  const text = label.toLowerCase();
  if (!words.every((word) => text.includes(word))) return null;
  if (text.startsWith(words.join(" "))) return 0;
  return words.every((word) => text.split(/[\s/]+/).some((part) => part.startsWith(word))) ? 1 : 2;
}

/** Type to find and run any command. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands
      .map((command, order) => ({ command, order, score: score(`${command.label} ${command.group ?? ""} ${command.keywords ?? ""}`, words) }))
      .filter((result) => result.score !== null)
      .sort((a, b) => a.score! - b.score! || a.order - b.order)
      .slice(0, 60)
      .map((result) => result.command);
  }, [commands, query]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };
  const move = (step: number) => {
    const next = Math.max(0, Math.min(results.length - 1, active + step));
    setActive(next);
    list.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Commands" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <SearchIcon size={15} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") move(1);
              else if (event.key === "ArrowUp") move(-1);
              else if (event.key === "Enter") run(results[active]);
              else if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
              } else return;
              event.preventDefault();
            }}
            placeholder="Type a command, a branch name, …"
            spellCheck={false}
            autoFocus
          />
        </div>
        <ul ref={list} className="palette-list" role="listbox">
          {results.length === 0 && <li className="palette-empty">No matching commands</li>}
          {results.map((command, index) => (
            <li
              key={command.id}
              role="option"
              aria-selected={index === active}
              className={`palette-item${index === active ? " active" : ""}`}
              onMouseMove={() => setActive(index)}
              onClick={() => run(command)}
            >
              <span className="palette-icon">{command.icon}</span>
              <span className="palette-label">{command.label}</span>
              {command.group && <span className="palette-group">{command.group}</span>}
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
