import { useCallback, useEffect, useState } from "react";
import { speedSettings, type Action, type SpeedSettings, type SpeedUp } from "../api";
import type { SettingRow } from "./SettingsDialog";

/** git's speed-ups for big repositories, in a repository's settings: each on or off. */
export function useSpeedRows(path: string, run: (action: Action) => Promise<boolean>): SettingRow[] {
  const [settings, setSettings] = useState<SpeedSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    speedSettings(path)
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [path]);
  useEffect(load, [load]);
  if (!settings) return [{ kind: "custom", label: "Loading…", content: null }];

  const apply = async (action: Action) => {
    setBusy(true);
    await run(action);
    setBusy(false);
    load();
  };
  const toggle = (which: SpeedUp, value: boolean) => apply({ kind: "setSpeedUp", which, on: value });
  const allOn = settings.fileWatcher !== false && settings.untrackedCache && settings.commitGraph && settings.maintenance;
  const files = settings.files.toLocaleString("en-US");
  const rows: SettingRow[] = [
    {
      kind: "custom",
      label: settings.big ? `${files} files: big enough for git's speed-ups to help` : `${files} files: quick enough without git's speed-ups`,
      hint: "git leaves them off by default. They make checking for changes, the history, and the push and pull counts quicker in big repositories, here and on the command line.",
      content: allOn ? null : (
        <button className={settings.big ? "primary-small-button" : "outline-button"} onClick={() => apply({ kind: "speedUpAll" })} disabled={busy}>
          {settings.big ? "Turn them all on" : <span className="button-label">Turn them all on</span>}
        </button>
      ),
    },
  ];
  if (settings.fileWatcher !== null) {
    rows.push({
      kind: "toggle",
      label: "Watch files for changes",
      hint: "git's file watcher: looking for changes only looks at the files that changed (core.fsmonitor).",
      value: settings.fileWatcher,
      set: (value) => toggle("fileWatcher", value),
      disabled: busy,
    });
  } else {
    rows.push({
      kind: "custom",
      label: "Watch files for changes",
      hint: `git's own file watcher is on Windows and macOS, from git 2.36 (this is ${settings.gitVersion || "an older git"}).`,
      content: null,
    });
  }
  rows.push(
    {
      kind: "toggle",
      label: "Remember where new files can be",
      hint: "Looking for new files skips folders that haven't changed (core.untrackedCache).",
      value: settings.untrackedCache,
      set: (value) => toggle("untrackedCache", value),
      disabled: busy,
    },
    {
      kind: "toggle",
      label: "Commit graph",
      hint: "An index of the history: the commit list, counts and merges are quicker. Each fetch keeps it up to date.",
      value: settings.commitGraph,
      set: (value) => toggle("commitGraph", value),
      disabled: busy,
    },
    {
      kind: "toggle",
      label: "Tidy up in the background",
      hint: "git's maintenance: every hour it fetches ahead and packs the repository, scheduled with your computer's scheduler (git maintenance).",
      value: settings.maintenance,
      set: (value) => toggle("maintenance", value),
      disabled: busy,
    },
  );
  return rows;
}
