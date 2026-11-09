import { useOpenApps } from "../lib/apps";
import type { SettingRow } from "./SettingsDialog";

/** Settings: the editor and terminal that "Open in …" uses, among those installed here. */
export function useAppRows(): SettingRow[] {
  const { apps, editor, terminal, setEditorId, setTerminalId } = useOpenApps();
  if (!apps) return [];
  const editors = apps.filter((app) => !app.terminal);
  const terminals = apps.filter((app) => app.terminal);
  const row = (label: string, list: typeof apps, chosen: string | undefined, set: (id: string) => void, none: string): SettingRow =>
    list.length > 0
      ? { kind: "select", label, value: chosen ?? list[0].id, options: list.map((app) => ({ value: app.id, label: app.name })), set }
      : { kind: "custom", label, hint: none, content: null };
  return [
    row("Editor", editors, editor?.id, setEditorId, "None found (Visual Studio Code, Rider, Visual Studio, Zed, Sublime Text, …)."),
    row("Terminal", terminals, terminal?.id, setTerminalId, "None found."),
  ];
}
