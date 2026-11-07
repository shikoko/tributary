import { modKey } from "../lib/platform";
import { Dialog } from "./Dialog";

const SHORTCUTS: [string, string][] = [
  [`${modKey}K`, "Command palette"],
  [`${modKey}F`, "Search commits (Enter / Shift+Enter: next / previous match)"],
  [`${modKey}O`, "Open a repository"],
  [`${modKey}T`, "Open a repository in a new tab"],
  [`${modKey}W`, "Close the tab"],
  [`${modKey}1 … ${modKey}9`, "Switch to a tab"],
  [`${modKey}R or F5`, "Refresh"],
  [`${modKey}B`, "Show or hide the branch sidebar"],
  [`${modKey}Enter`, "Commit, in the commit message box"],
  [`${modKey}+ / ${modKey}− / ${modKey}0`, "Zoom in, zoom out, actual size"],
  ["↑ ↓ Page Up/Down Home End", "Move through commits"],
  ["Double-click a branch label", "Check out the branch"],
  ["Alt+click a branch label", "Highlight the branch's history"],
  ["Esc", "Close the details panel, stop highlighting"],
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
