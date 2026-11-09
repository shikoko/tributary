import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { unitySetup, type Action, type UnitySetup } from "../api";
import type { SettingRow } from "./SettingsDialog";

/** "Unity 2022.3.10f1", from the editor's folder in a UnityYAMLMerge path, or the path. */
export function toolLabel(tool: string): string {
  const version = tool.split(/[\\/]/).find((part) => /^\d{4}\.\d+\.\d+[abfp]\d+$/.test(part) || /^\d{4,}\.\d+\.\d+/.test(part));
  return version ? `Unity ${version}` : tool;
}

/** The repository's Unity project (null when it has none) and Smart Merge's setup, loaded. */
export function useUnitySetup(path: string): [UnitySetup | null, () => void] {
  const [setup, setSetup] = useState<UnitySetup | null>(null);
  const load = useCallback(() => {
    unitySetup(path)
      .then((found) => setSetup(found.project ? found : null))
      .catch(() => setSetup(null));
  }, [path]);
  useEffect(load, [load]);
  return [setup, load];
}

/**
 * Unity's Smart Merge, in a Unity project's settings: whether scenes and prefabs merge
 * with it, which UnityYAMLMerge does it, and setting it up or turning it off. Null when
 * the repository has no Unity project.
 */
export function useUnityRows(path: string, run: (action: Action) => Promise<boolean>): SettingRow[] | null {
  const [setup, reload] = useUnitySetup(path);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!setup) return null;

  const tools = [chosen, setup.configuredTool, ...setup.tools].filter((each, index, all): each is string => Boolean(each) && all.indexOf(each) === index);
  const tool = chosen ?? setup.configuredTool ?? setup.tools[0] ?? null;
  const apply = async (action: Action) => {
    setBusy(true);
    await run(action);
    setBusy(false);
    reload();
  };
  const choose = async () => {
    const picked = await open({ multiple: false, directory: false, title: "Choose Unity's Smart Merge (UnityYAMLMerge)" });
    if (typeof picked !== "string") return;
    // On macOS it's inside the editor's app.
    setChosen(picked.endsWith(".app") ? `${picked}/Contents/Tools/UnityYAMLMerge` : picked);
  };
  const where = "It comes with the Unity editor: in its folder, under Editor/Data/Tools (Windows and Linux), or inside Unity.app, under Contents/Tools (macOS).";

  const rows: SettingRow[] = [
    {
      kind: "custom",
      label: setup.configured ? "Scenes and prefabs merge with Unity's Smart Merge" : "Scenes and prefabs merge line by line",
      hint: setup.configured
        ? `${setup.configuredTool ? `With ${toolLabel(setup.configuredTool)}. ` : ""}Conflicts in them mostly resolve by themselves.`
        : `Unity's Smart Merge merges them by what changed in them (objects and their properties), so most conflicts resolve by themselves.${setup.editorVersion ? ` This project uses Unity ${setup.editorVersion}.` : ""}`,
      content: setup.configured ? (
        <button className="outline-button" onClick={() => apply({ kind: "removeUnityMerge" })} disabled={busy}>
          <span className="button-label">Turn off</span>
        </button>
      ) : null,
    },
  ];
  rows.push({
    kind: "custom",
    label: "Smart Merge program",
    hint: tools.length === 0 ? `None found where Unity Hub installs editors. ${where}` : "UnityYAMLMerge, from an installed Unity editor.",
    content: (
      <div className="unity-tool">
        {tools.length > 0 && (
          <select className="settings-select" value={tool ?? ""} onChange={(event) => setChosen(event.target.value)} aria-label="Smart Merge program">
            {tools.map((each) => (
              <option key={each} value={each} title={each}>
                {toolLabel(each)}
              </option>
            ))}
          </select>
        )}
        <button className="outline-button" onClick={() => void choose()} disabled={busy}>
          <span className="button-label">Choose…</span>
        </button>
      </div>
    ),
  });
  if (!setup.configured || (chosen && chosen !== setup.configuredTool)) {
    rows.push({
      kind: "custom",
      label: "",
      hint: "Only for this repository on this computer: the files your team shares don't change.",
      content: (
        <button
          className="primary-small-button"
          disabled={busy || !tool}
          onClick={async () => {
            await apply({ kind: "setUpUnityMerge", tool: tool! });
            setChosen(null);
          }}
        >
          {setup.configured ? "Use this one" : "Set up Smart Merge"}
        </button>
      ),
    });
  }
  return rows;
}
