// The toolbar's Open menu: the repository on its website, its folder, and the editor and
// terminal chosen in Settings.
import type { InstalledApp, RepoSnapshot } from "../api";
import type { MenuItem } from "../components/ContextMenu";
import { CodeIcon, CopyIcon, ExternalLinkIcon, FolderIcon, TerminalIcon } from "../components/Icons";
import { copyText } from "../lib/clipboard";
import { isMac } from "../lib/platform";
import { openInBrowser, siteName, webRemote } from "../lib/weblinks";

export function openMenuItems(options: {
  snapshot: RepoSnapshot;
  editor: InstalledApp | null;
  terminal: InstalledApp | null;
  reveal: () => void;
  openIn: (app: InstalledApp) => void;
  notify: (text: string) => void;
}): MenuItem[] {
  const { snapshot, editor, terminal, reveal, openIn, notify } = options;
  const remote = webRemote(snapshot);
  const items: MenuItem[] = [];
  if (remote) items.push({ label: `Open on ${siteName(remote)}`, icon: <ExternalLinkIcon />, url: remote.url, onSelect: () => openInBrowser(remote.url) });
  items.push({ label: isMac ? "Show in Finder" : "Show in Explorer", icon: <FolderIcon />, onSelect: reveal });
  if (editor) items.push({ label: `Open in ${editor.name}`, icon: <CodeIcon />, separated: true, onSelect: () => openIn(editor) });
  if (terminal) items.push({ label: `Open in ${terminal.name}`, icon: <TerminalIcon />, separated: !editor, onSelect: () => openIn(terminal) });
  items.push({
    label: "Copy the folder's path",
    icon: <CopyIcon />,
    separated: true,
    onSelect: () => {
      void copyText(snapshot.path);
      notify("Copied the folder's path");
    },
  });
  return items;
}
