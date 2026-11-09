// The editor and terminal to open a repository (or a file) in: those installed here,
// looked for once, and the one chosen in Settings (or else the first found).
import { useEffect, useState } from "react";
import { installedApps, type InstalledApp } from "../api";
import { useStoredState } from "./settings";

let found: Promise<InstalledApp[]> | null = null;

/** The editors and terminals installed here (null while they're looked for). */
export function useInstalledApps(): InstalledApp[] | null {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  useEffect(() => {
    let current = true;
    found ??= installedApps().catch(() => []);
    found.then((list) => current && setApps(list));
    return () => {
      current = false;
    };
  }, []);
  return apps;
}

/** The app of each kind to use: the chosen one if it's still installed, or the first found. */
export function pickApps(apps: InstalledApp[], editorId: string | null, terminalId: string | null): { editor: InstalledApp | null; terminal: InstalledApp | null } {
  const editors = apps.filter((app) => !app.terminal);
  const terminals = apps.filter((app) => app.terminal);
  return {
    editor: editors.find((app) => app.id === editorId) ?? editors[0] ?? null,
    terminal: terminals.find((app) => app.id === terminalId) ?? terminals[0] ?? null,
  };
}

/** The editor and terminal to use, and the setters for Settings. */
export function useOpenApps() {
  const apps = useInstalledApps();
  const [editorId, setEditorId] = useStoredState<string | null>("apps.editor", null);
  const [terminalId, setTerminalId] = useStoredState<string | null>("apps.terminal", null);
  return { apps, ...pickApps(apps ?? [], editorId, terminalId), setEditorId, setTerminalId };
}
