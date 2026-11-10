import { open, save } from "@tauri-apps/plugin-dialog";
import { readSettingsFile, saveSettingsFile } from "../api";
import { plural } from "../lib/format";
import { loadRecent } from "../lib/recent";
import { applySettings, collectSettings } from "../lib/settingsTransfer";
import type { SettingRow } from "./SettingsDialog";

/** Settings: exporting every setting to a file, and importing them back (on another computer, say). */
export function settingsTransferRows(notify: (text: string) => void): SettingRow[] {
  const exportSettings = async () => {
    const file = await save({ title: "Export Tributary's settings", defaultPath: "tributary-settings.json", filters: [{ name: "Settings", extensions: ["json"] }] });
    if (!file) return;
    const settings = collectSettings(localStorage);
    try {
      await saveSettingsFile(file, JSON.stringify(settings, null, 2));
      notify(`Exported ${plural(Object.keys(settings.settings).length, "setting")}`);
    } catch (e) {
      notify(String(e));
    }
  };
  const importSettings = async () => {
    const file = await open({ title: "Import Tributary's settings", multiple: false, directory: false, filters: [{ name: "Settings", extensions: ["json"] }] });
    if (typeof file !== "string") return;
    try {
      const result = applySettings(JSON.parse(await readSettingsFile(file)), localStorage, loadRecent().map((repo) => repo.path));
      notify(`Imported ${plural(result.settings, "setting")}${result.repositories ? `, for ${plural(result.repositories, "repository", "repositories")} here too` : ""}: starting again with them`);
      // Everything reads its settings when it starts.
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };
  return [
    {
      kind: "custom",
      label: "Export your settings",
      hint: "Every setting, in a file to import on another computer: appearance, columns, notices, and each repository's pinned, hidden and protected branches (matched by folder name). No passwords or tokens: git's credential helper keeps those.",
      content: (
        <button className="outline-button" onClick={() => void exportSettings()}>
          <span className="button-label">Export to a file…</span>
        </button>
      ),
    },
    {
      kind: "custom",
      label: "Import settings",
      hint: "From a file exported here or on another computer. Tributary starts again with them.",
      content: (
        <button className="outline-button" onClick={() => void importSettings()}>
          <span className="button-label">Import from a file…</span>
        </button>
      ),
    },
  ];
}
