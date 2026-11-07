import type { ReactNode } from "react";
import type { MenuItem } from "../components/ContextMenu";
import { isMac } from "../lib/platform";

/** A command for the menu bar, the menus and the command palette. */
export interface AppCommand {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A keyboard shortcut, like "CmdOrCtrl+K". */
  keys?: string;
  enabled?: boolean;
  /** For on/off settings. */
  checked?: boolean;
  danger?: boolean;
  run: () => void;
}

/** A command, or a divider. */
export type MenuEntry = AppCommand | "-";

/** "CmdOrCtrl+Shift+L" as it's written on this platform: "⇧⌘L" or "Ctrl+Shift+L". */
export function shortcutLabel(keys: string): string {
  const parts = keys.split("+").filter(Boolean);
  const key = keys.endsWith("++") ? "+" : (parts.pop() ?? "");
  const shown = key === "=" ? "+" : key;
  if (isMac) {
    const symbols: Record<string, string> = { CmdOrCtrl: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" };
    const order = ["Ctrl", "Alt", "Shift", "CmdOrCtrl"];
    return parts.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((part) => symbols[part] ?? part).join("") + shown;
  }
  return [...parts.map((part) => (part === "CmdOrCtrl" ? "Ctrl" : part)), shown].join("+");
}

/** Menu entries as context menu items: dividers become a line above the next item. */
export function menuItems(entries: MenuEntry[]): MenuItem[] {
  const items: MenuItem[] = [];
  let separated = false;
  for (const entry of entries) {
    if (entry === "-") {
      separated = items.length > 0;
      continue;
    }
    items.push({
      label: entry.label,
      icon: entry.icon,
      checked: entry.checked,
      danger: entry.danger,
      disabled: entry.enabled === false,
      shortcut: entry.keys ? shortcutLabel(entry.keys) : undefined,
      separated,
      onSelect: entry.run,
    });
    separated = false;
  }
  return items;
}
