import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readSettingsFile, saveSettingsFile } from "../api";
import { plural } from "../lib/format";
import { loadRecent } from "../lib/recent";
import { applySettings, collectSettings } from "../lib/settingsTransfer";
import type { SettingRow } from "./SettingsDialog";
import { SettingsRepositoryDialog } from "./SettingsRepositoryDialog";

/** Every setting, as the JSON text that's exported. */
const exportedText = () => JSON.stringify(collectSettings(localStorage), null, 2);

/** Apply imported settings (JSON text) and start again with them. */
function applyImported(text: string, notify: (text: string) => void) {
  const result = applySettings(JSON.parse(text), localStorage, loadRecent().map((repo) => repo.path));
  notify(`Imported ${plural(result.settings, "setting")}${result.repositories ? `, for ${plural(result.repositories, "repository", "repositories")} here too` : ""}: starting again with them`);
  // Everything reads its settings when it starts.
  window.setTimeout(() => window.location.reload(), 1200);
}

/** A button opening the window for exporting to, or importing from, a git repository. */
function RepositoryButton({ mode, notify }: { mode: "export" | "import"; notify: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="outline-button" onClick={() => setOpen(true)}>
        <span className="button-label">{mode === "export" ? "Export to a repository…" : "Import from a repository…"}</span>
      </button>
      {open && (
        <SettingsRepositoryDialog
          mode={mode}
          contents={exportedText}
          onImported={(text) => {
            setOpen(false);
            try {
              applyImported(text, notify);
            } catch (e) {
              notify(e instanceof Error ? e.message : String(e));
            }
          }}
          onDone={(message) => {
            setOpen(false);
            notify(message);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Settings: exporting every setting to a file or a git repository, and importing them back (on another computer, say). */
export function settingsTransferRows(notify: (text: string) => void): SettingRow[] {
  const exportSettings = async () => {
    const file = await save({ title: "Export Tributary's settings", defaultPath: "tributary-settings.json", filters: [{ name: "Settings", extensions: ["json"] }] });
    if (!file) return;
    const text = exportedText();
    try {
      await saveSettingsFile(file, text);
      notify(`Exported ${plural(Object.keys(JSON.parse(text).settings).length, "setting")}`);
    } catch (e) {
      notify(String(e));
    }
  };
  const importSettings = async () => {
    const file = await open({ title: "Import Tributary's settings", multiple: false, directory: false, filters: [{ name: "Settings", extensions: ["json"] }] });
    if (typeof file !== "string") return;
    try {
      applyImported(await readSettingsFile(file), notify);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };
  return [
    {
      kind: "custom",
      label: "Export your settings",
      hint: "Appearance, columns, notices, and each repository's pinned, hidden and protected branches. No passwords or tokens.",
      content: (
        <div className="settings-buttons">
          <button className="outline-button" onClick={() => void exportSettings()}>
            <span className="button-label">Export to a file…</span>
          </button>
          <RepositoryButton mode="export" notify={notify} />
        </div>
      ),
    },
    {
      kind: "custom",
      label: "Import settings",
      hint: "Exported here or on another computer. Tributary starts again with them.",
      content: (
        <div className="settings-buttons">
          <button className="outline-button" onClick={() => void importSettings()}>
            <span className="button-label">Import from a file…</span>
          </button>
          <RepositoryButton mode="import" notify={notify} />
        </div>
      ),
    },
  ];
}
