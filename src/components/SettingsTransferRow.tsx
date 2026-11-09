import { open, save } from "@tauri-apps/plugin-dialog";
import { readSettingsFile, saveSettingsFile } from "../api";
import { plural } from "../lib/format";
import { loadRecent } from "../lib/recent";
import { applySettings, collectSettings } from "../lib/settingsTransfer";
import type { SettingRow } from "./SettingsDialog";

/** Settings: saving every setting to a file, and reading them back (on another computer, say). */
export function settingsTransferRow(notify: (text: string) => void): SettingRow {
  const exportSettings = async () => {
    const file = await save({ title: "Save Tributary's settings", defaultPath: "tributary-settings.json", filters: [{ name: "Settings", extensions: ["json"] }] });
    if (!file) return;
    const settings = collectSettings(localStorage);
    try {
      await saveSettingsFile(file, JSON.stringify(settings, null, 2));
      notify(`Saved ${plural(Object.keys(settings.settings).length, "setting")}`);
    } catch (e) {
      notify(String(e));
    }
  };
  const importSettings = async () => {
    const file = await open({ title: "Read Tributary's settings", multiple: false, directory: false, filters: [{ name: "Settings", extensions: ["json"] }] });
    if (typeof file !== "string") return;
    try {
      const result = applySettings(JSON.parse(await readSettingsFile(file)), localStorage, loadRecent().map((repo) => repo.path));
      notify(`Read ${plural(result.settings, "setting")}${result.repositories ? `, for ${plural(result.repositories, "repository", "repositories")} here too` : ""}: starting again with them`);
      // Everything reads its settings when it starts.
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };
  return {
    kind: "custom",
    label: "Move your settings",
    hint: "Save every setting to a file, to read on another computer: appearance, columns, notices, and each repository's pinned, hidden and protected branches (matched by folder name). No passwords or tokens: git's credential helper keeps those.",
    content: (
      <div className="settings-buttons">
        <button className="outline-button" onClick={() => void exportSettings()}>
          <span className="button-label">Save to a file…</span>
        </button>
        <button className="outline-button" onClick={() => void importSettings()}>
          <span className="button-label">Read from a file…</span>
        </button>
      </div>
    ),
  };
}
