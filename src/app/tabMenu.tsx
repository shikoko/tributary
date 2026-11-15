import type { MenuItem } from "../components/ContextMenu";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, CopyIcon, FolderIcon, GearIcon, HistoryIcon } from "../components/Icons";
import { copyText } from "../lib/clipboard";
import { shortcutLabel } from "./appCommand";
import { isMac } from "../lib/platform";

interface Options {
  path: string;
  /** How many tabs are open. */
  count: number;
  /** Where this one is among them. */
  index: number;
  /** The repository's own settings (switching to its tab first). */
  settings: () => void;
  reveal: () => void;
  close: () => void;
  closeOthers: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  /** The tab closed last, open again; `null` when none was closed lately. */
  reopen: (() => void) | null;
}

/** The keys that move the open repository's tab, as each system writes them. */
export const MOVE_TAB_KEYS = isMac ? ["⌃⇧PgUp", "⌃⇧PgDn"] : ["Ctrl+Shift+PgUp", "Ctrl+Shift+PgDn"];
/** The keys that open the tab closed last again (not Ctrl+Shift+T, a browser's: that's Team Activity). */
export const REOPEN_TAB_KEYS = "CmdOrCtrl+Shift+R";

/** Right-click on a repository's tab. */
export function tabMenuItems({ path, count, index, settings, reveal, close, closeOthers, moveLeft, moveRight, reopen }: Options): MenuItem[] {
  return [
    { label: "Repository Settings…", icon: <GearIcon />, onSelect: settings },
    { label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, separated: true, onSelect: reveal },
    { label: "Copy path", icon: <CopyIcon />, onSelect: () => copyText(path) },
    // Or drag the tab there.
    { label: "Move Tab Left", icon: <ChevronLeftIcon />, separated: true, disabled: index <= 0, shortcut: MOVE_TAB_KEYS[0], onSelect: moveLeft },
    { label: "Move Tab Right", icon: <ChevronRightIcon />, disabled: index < 0 || index >= count - 1, shortcut: MOVE_TAB_KEYS[1], onSelect: moveRight },
    { label: "Close tab", icon: <CloseIcon />, separated: true, onSelect: close },
    { label: "Close other tabs", icon: <CloseIcon />, disabled: count < 2, onSelect: closeOthers },
    { label: "Reopen closed tab", icon: <HistoryIcon />, disabled: !reopen, shortcut: shortcutLabel(REOPEN_TAB_KEYS), onSelect: () => reopen?.() },
  ];
}
