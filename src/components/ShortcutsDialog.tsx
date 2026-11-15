import { useState } from "react";
import { isMac } from "../lib/platform";
import { Dialog } from "./Dialog";

/** Keys pressed together, as keycaps, like ["Ctrl", "Shift", "R"]; or a word for the mouse, like "Double-click". */
type Keys = string[];
interface Shortcut {
  /** Any of these (alternatives), each a set of keys pressed together. */
  keys: Keys[];
  /** What the mouse does it on, after the keys: "a branch label". */
  on?: string;
  /** Between the alternatives: "or" for two, nothing for more, unless it says ("…" for a range). */
  join?: string;
  what: string;
}
interface Group {
  name: string;
  items: Shortcut[];
}

const MOD = isMac ? "⌘" : "Ctrl";
const SHIFT = isMac ? "⇧" : "Shift";
const ALT = isMac ? "⌥" : "Alt";
const CTRL = isMac ? "⌃" : "Ctrl";
/** Shift with the main modifier, in the platform's order: ⇧⌘R on a Mac, Ctrl+Shift+R elsewhere. */
const shifted = (key: string): Keys => (isMac ? [SHIFT, MOD, key] : [MOD, SHIFT, key]);

/** The shortcuts, in groups of what they're for. */
const GROUPS: Group[] = [
  {
    name: "Anywhere",
    items: [
      { keys: [[MOD, "K"]], what: "Command palette" },
      { keys: [[MOD, "F"]], what: "Search commits (Enter, Shift+Enter: the next or previous match)" },
      { keys: [[MOD, "G"]], what: "Go to a commit by its id, a branch, a tag or a day" },
      { keys: [[MOD, "O"]], what: "Open a repository" },
      { keys: [[MOD, ","]], what: "Settings" },
      { keys: [[MOD, "R"], ["F5"]], what: "Refresh" },
      { keys: [[MOD, "+"], [MOD, "−"], [MOD, "0"]], what: "Zoom in, zoom out, actual size" },
      { keys: [["?"]], what: "This list" },
    ],
  },
  {
    name: "Tabs",
    items: [
      { keys: [[MOD, "T"]], what: "New tab: open, clone or create a repository" },
      { keys: [[MOD, "W"]], what: "Close the tab" },
      { keys: [shifted("R")], what: "Reopen the tab closed last, in its place" },
      { keys: [[MOD, "1"], [MOD, "9"]], join: "…", what: "Switch to a tab (the first to the ninth)" },
      { keys: [[CTRL, SHIFT, "PgUp"], [CTRL, SHIFT, "PgDn"]], what: "Move the tab left or right" },
    ],
  },
  {
    name: "Panels",
    items: [
      { keys: [[MOD, "B"]], what: "The branch sidebar" },
      { keys: [shifted("L")], what: "The activity log: the git commands Tributary ran" },
      { keys: [shifted("T")], what: "Team activity: who's been working on what" },
      { keys: [shifted("O")], what: "View options: theme, graph, columns, rows" },
      { keys: [["Esc"]], what: "Stop highlighting, clear the selection, close the details" },
    ],
  },
  {
    name: "Commits and changes",
    items: [
      { keys: [["↑"], ["↓"], ["PgUp"], ["PgDn"], ["Home"], ["End"]], what: "Move through commits" },
      { keys: [[SHIFT, "↑"], [SHIFT, "↓"]], what: "Select a range of commits (or Shift+click)" },
      { keys: [[MOD, "click"]], what: "Add a commit to the selection, or take it out" },
      { keys: [[MOD, "Enter"]], what: "Commit, in the commit message box" },
      { keys: [["Enter"]], what: "Show a changed file's changes" },
      { keys: [["["], ["]"]], what: "The previous or next file's changes" },
    ],
  },
  {
    name: "With the mouse",
    items: [
      { keys: [["Double-click"]], on: "a branch label", what: "Check out the branch" },
      { keys: [[ALT, "click"]], on: "a branch label", what: "Highlight the branch's history" },
      { keys: [["Drag"]], on: "a branch label onto a commit", what: "Merge or rebase" },
      { keys: [["Drag"]], on: "a commit onto a branch label", what: "Cherry-pick it onto that branch" },
      { keys: [["Click"]], on: "a commit's CI dot", what: "Its checks, each run as a graph" },
      { keys: [["Right-click"]], on: "the column headings", what: "Choose the columns, and how dates show" },
    ],
  },
  {
    name: "Menus and lists",
    items: [
      ...(isMac ? [] : [{ keys: [["F10"]], what: "The menu bar (← → move between its menus)" }]),
      { keys: [["↑"], ["↓"], ["Home"], ["End"]], what: "Move through a menu, or press a letter (Enter picks, Esc closes)" },
      { keys: [["←"], ["→"]], what: "Move between tabs, on a tab (Enter switches, Delete closes)" },
      { keys: [["↑"], ["↓"]], what: "Move through the sidebar (← → fold and unfold folders)" },
    ],
  },
];

/** A shortcut's keys, as keycaps: each set together joined by nothing (on a Mac) or "+", sets apart by a slash. */
function KeyCaps({ shortcut }: { shortcut: Shortcut }) {
  return (
    <span className="key-caps">
      {shortcut.keys.map((set, index) => (
        <span key={index} className="key-set">
          {index > 0 && (shortcut.join ?? (shortcut.keys.length === 2 ? "or" : "")) && <span className="key-or">{shortcut.join ?? "or"}</span>}
          {set.map((key, at) => (
            <kbd key={at} className={key.length > 3 && /[a-z]/.test(key) ? "word" : undefined}>
              <span className="chip-text">{key}</span>
            </kbd>
          ))}
        </span>
      ))}
      {shortcut.on && <span className="key-on">{shortcut.on}</span>}
    </span>
  );
}

/** Whether a shortcut has every word typed, in what it does, what it's done on, or its keys. */
function matches(shortcut: Shortcut, words: string[]): boolean {
  const text = `${shortcut.what} ${shortcut.on ?? ""} ${shortcut.keys.flat().join(" ")}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * The keyboard shortcuts, in groups, each with its keys as keycaps. A search at the top
 * narrows them to what has the words typed, in every group; the groups down the side show
 * one at a time, or all. The window is never taller than the app's: its list scrolls inside.
 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<string | null>(null);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Typing searches every group, whichever is chosen.
  const shown = GROUPS.map((group) => ({ ...group, items: group.items.filter((shortcut) => matches(shortcut, words)) })).filter(
    (group) => group.items.length > 0 && (words.length > 0 || !only || group.name === only),
  );
  return (
    <Dialog title="Keyboard shortcuts" className="shortcuts-window" closable onCancel={onClose} buttons={null}>
      <input
        className="text-input shortcuts-find"
        placeholder="Find a shortcut, like “tab” or “Ctrl+G”"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
        aria-label="Find a shortcut"
      />
      <div className="shortcuts-split">
        <nav className="shortcuts-nav" aria-label="Groups of shortcuts">
          {[null, ...GROUPS.map((group) => group.name)].map((name) => (
            <button key={name ?? "all"} className={!words.length && only === name ? "on" : undefined} aria-pressed={!words.length && only === name} onClick={() => setOnly(name)}>
              <span className="button-label">{name ?? "All"}</span>
            </button>
          ))}
        </nav>
        {/* Focusable, so the list can be scrolled from the keyboard when it's taller than the window. */}
        <div className="shortcuts-body" tabIndex={0} role="region" aria-label="The shortcuts">
          {shown.map((group) => (
            <section key={group.name} className="shortcuts-group">
              <h3>{group.name}</h3>
              {group.items.map((shortcut) => (
                <div key={shortcut.what} className="shortcut-row">
                  <span className="shortcut-what">{shortcut.what}</span>
                  <KeyCaps shortcut={shortcut} />
                </div>
              ))}
            </section>
          ))}
          {shown.length === 0 && <p className="shortcuts-none">No shortcut has “{query.trim()}”.</p>}
        </div>
      </div>
    </Dialog>
  );
}
