import { useState } from "react";
import { exportSettingsToRepository, importSettingsFromRepository } from "../api";
import { useStoredState } from "../lib/settings";
import { Dialog } from "./Dialog";

/** The repository the settings were last exported to or imported from. */
const REPOSITORY_KEY = "settings.repository";

interface Props {
  mode: "export" | "import";
  /** The settings to export, as JSON text. */
  contents: () => string;
  /** Imported settings, as JSON text, to apply. */
  onImported: (text: string) => void;
  onDone: (message: string) => void;
  onCancel: () => void;
}

/**
 * Export the settings to a git repository of your own, or import them from one: just its
 * link, any computer. Your git does the work, with its own sign-in.
 */
export function SettingsRepositoryDialog({ mode, contents, onImported, onDone, onCancel }: Props) {
  const [saved, setSaved] = useStoredState(REPOSITORY_KEY, "");
  const [url, setUrl] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exporting = mode === "export";

  const go = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (exporting) {
        const message = await exportSettingsToRepository(url.trim(), contents());
        setSaved(url.trim());
        onDone(message);
      } else {
        const text = await importSettingsFromRepository(url.trim());
        setSaved(url.trim());
        onImported(text);
      }
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={exporting ? "Export your settings to a repository" : "Import settings from a repository"}
      className="settings-repository-window"
      busy={busy}
      error={error}
      onCancel={onCancel}
      buttons={
        <>
          <button className="secondary-button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary-small-button" onClick={() => void go()} disabled={busy || !url.trim()}>
            {busy ? (exporting ? "Exporting…" : "Importing…") : exporting ? "Export" : "Import"}
          </button>
        </>
      }
    >
      <p className="settings-repository-lead">
        {exporting
          ? "Tributary commits your settings to the repository, as tributary-settings.json, and pushes them with your git and its sign-in. Import them on any computer with the same link."
          : "Tributary reads tributary-settings.json from the repository, where Export put it, and starts again with those settings."}
      </p>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void go();
        }}
      >
        <label className="field">
          <span>Repository</span>
          <input
            className="text-input"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            placeholder="https://github.com/you/tributary-settings.git"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
            disabled={busy}
          />
        </label>
      </form>
      {exporting && (
        <p className="hint">
          Keep the repository private. Your settings include where your repositories are on this computer (their folders), and anyone who can
          see the repository could read that.
        </p>
      )}
    </Dialog>
  );
}
