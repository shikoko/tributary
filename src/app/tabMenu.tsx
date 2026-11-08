import type { MenuItem } from "../components/ContextMenu";
import { CloseIcon, CopyIcon, FolderIcon, GearIcon } from "../components/Icons";
import { copyText } from "../lib/clipboard";
import { isMac } from "../lib/platform";

interface Options {
  path: string;
  /** How many tabs are open. */
  count: number;
  /** The repository's own settings (switching to its tab first). */
  settings: () => void;
  reveal: () => void;
  close: () => void;
  closeOthers: () => void;
}

/** Right-click on a repository's tab. */
export function tabMenuItems({ path, count, settings, reveal, close, closeOthers }: Options): MenuItem[] {
  return [
    { label: "Repository Settings…", icon: <GearIcon />, onSelect: settings },
    { label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, separated: true, onSelect: reveal },
    { label: "Copy path", icon: <CopyIcon />, onSelect: () => copyText(path) },
    { label: "Close tab", icon: <CloseIcon />, separated: true, onSelect: close },
    { label: "Close other tabs", icon: <CloseIcon />, disabled: count < 2, onSelect: closeOthers },
  ];
}
