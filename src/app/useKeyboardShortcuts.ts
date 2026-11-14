import { useEffect, useRef } from "react";

/** What the app-wide keyboard shortcuts do. */
export interface ShortcutHandlers {
  togglePalette: () => void;
  openSettings: () => void;
  open: () => void;
  newTab: () => void;
  closeTab: () => void;
  /** ⌘1…⌘9: the nth tab (0-based). */
  showTab: (index: number) => void;
  /** Ctrl+Tab and Ctrl+Shift+Tab. */
  cycleTab: (backwards: boolean) => void;
  /** Ctrl+Shift+Page Up and Page Down: the open repository's tab one place left or right. */
  moveTab: (step: -1 | 1) => void;
  refresh: () => void;
  focusSearch: () => void;
  toggleSidebar: () => void;
  toggleActivity: () => void;
  toggleTeam: () => void;
  /** The View panel: the theme, the graph, the columns and the rows. */
  toggleView: () => void;
  zoom: (step: 1 | -1 | 0) => void;
  showShortcuts: () => void;
  /** F10: the menu bar's first menu. */
  openMenuBar: () => void;
  /** Esc, outside text fields. */
  escape: () => void;
}

/** The app-wide shortcuts (see ShortcutsDialog for the list people see). */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  // The latest handlers, so the listener is added once.
  const current = useRef(handlers);
  current.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const on = current.current;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const typing = (event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
      const run = (handler: () => void) => {
        event.preventDefault();
        handler();
      };
      if (event.key === "F10" && !event.shiftKey && !mod) run(on.openMenuBar);
      if (mod && key === "k") run(on.togglePalette);
      else if (mod && key === ",") run(on.openSettings);
      else if (mod && key === "o" && !event.shiftKey) run(on.open);
      else if (mod && key === "t" && !event.shiftKey) run(on.newTab);
      else if (mod && key === "w") run(on.closeTab);
      else if (mod && /^[1-9]$/.test(key)) run(() => on.showTab(Number(key) - 1));
      else if (event.ctrlKey && event.key === "Tab") run(() => on.cycleTab(event.shiftKey));
      else if (event.ctrlKey && event.shiftKey && (event.key === "PageUp" || event.key === "PageDown")) run(() => on.moveTab(event.key === "PageUp" ? -1 : 1));
      else if ((mod && key === "r") || event.key === "F5") run(on.refresh);
      else if (mod && key === "f") run(on.focusSearch);
      else if (mod && key === "b") run(on.toggleSidebar);
      else if (mod && event.shiftKey && key === "l") run(on.toggleActivity);
      else if (mod && event.shiftKey && key === "t") run(on.toggleTeam);
      else if (mod && event.shiftKey && key === "o") run(on.toggleView);
      else if (mod && (key === "=" || key === "+")) run(() => on.zoom(1));
      else if (mod && key === "-") run(() => on.zoom(-1));
      else if (mod && key === "0") run(() => on.zoom(0));
      else if (event.key === "?" && !typing) run(on.showShortcuts);
      else if (event.key === "Escape" && !typing) on.escape();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
