import { isMac, modKey } from "../lib/platform";
import { Dialog } from "./Dialog";

const SHORTCUTS: [string, string][] = [
  [`${modKey}K`, "Command palette"],
  [`${modKey}F`, "Search commits (Enter / Shift+Enter: next / previous match)"],
  [`${modKey}O`, "Open a repository"],
  [`${modKey},`, "Settings"],
  [`${modKey}T`, "New tab: open, clone or create a repository, or pick a recent one"],
  [`${modKey}W`, "Close the tab"],
  [`${modKey}1 … ${modKey}9`, "Switch to a tab"],
  [`${modKey}R or F5`, "Refresh"],
  [`${modKey}B`, "Show or hide the branch sidebar"],
  [isMac ? "⇧⌘L" : "Ctrl+Shift+L", "Show or hide the activity log (the git commands Tributary ran)"],
  [`${modKey}Enter`, "Commit, in the commit message box"],
  [`${modKey}+ / ${modKey}− / ${modKey}0`, "Zoom in, zoom out, actual size"],
  ["↑ ↓ Page Up/Down Home End", "Move through commits"],
  ["Shift+click, Shift+↑ ↓", "Select a range of commits"],
  [`${modKey.replace("+", "")}+click`, "Add a commit to the selection, or take it out"],
  ["Double-click a branch label", "Check out the branch"],
  ["Alt+click a branch label", "Highlight the branch's history"],
  ["Drag a branch label onto a commit", "Merge or rebase"],
  ["Right-click the column headings", "Choose columns and how dates are shown"],
  ["Esc", "Stop highlighting, clear the selection, close the details panel"],
  ["?", "This list"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="Keyboard shortcuts"
      onCancel={onClose}
      buttons={
        <button className="secondary-button" onClick={onClose} autoFocus>
          Close
        </button>
      }
    >
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([keys, action]) => (
            <tr key={action}>
              <td>
                <kbd>{keys}</kbd>
              </td>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
