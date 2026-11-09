import { useCallback, useEffect, useState } from "react";
import { sparseSettings, type Action, type SparseSettings } from "../api";
import { plural } from "../lib/format";
import type { SettingRow } from "./SettingsDialog";

/** Whether `folder` is inside one of `chosen` (so choosing it too changes nothing). */
function inside(folder: string, chosen: ReadonlySet<string>): boolean {
  return [...chosen].some((other) => other !== folder && folder.startsWith(`${other}/`));
}

/** The folders to check out: without those inside another one chosen. */
export function foldersToCheckOut(chosen: ReadonlySet<string>): string[] {
  return [...chosen].filter((folder) => !inside(folder, chosen)).sort();
}

/**
 * Which folders are checked out, in a repository's settings: all of them, or only some
 * (a sparse checkout), changed after cloning.
 */
export function useSparseRows(path: string, run: (action: Action) => Promise<boolean>): SettingRow[] {
  const [settings, setSettings] = useState<SparseSettings | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    sparseSettings(path)
      .then((found) => {
        setSettings(found);
        setChosen(new Set(found.folders));
      })
      .catch(() => setSettings(null));
  }, [path]);
  useEffect(load, [load]);
  if (!settings) return [{ kind: "custom", label: "Loading…", content: null }];

  const apply = async (folders: string[]) => {
    setBusy(true);
    await run({ kind: "setSparseFolders", folders });
    setBusy(false);
    load();
  };
  const wanted = foldersToCheckOut(chosen);
  const unchanged = settings.sparse && wanted.join("\n") === [...settings.folders].sort().join("\n");
  const toggle = (folder: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  const rows: SettingRow[] = [
    {
      kind: "custom",
      label: settings.sparse ? `Only some folders are checked out` : "Every folder is checked out",
      hint: settings.sparse
        ? `${settings.folders.join(", ") || "None"}, and the files at the top.${settings.partial ? " Files in the other folders aren't downloaded." : ""}`
        : "To work on part of a big repository, check out only the folders you need: the others leave your disk, and the list and searches stay the same.",
      content: settings.sparse ? (
        <button className="outline-button" onClick={() => apply([])} disabled={busy}>
          <span className="button-label">Check out everything</span>
        </button>
      ) : null,
    },
  ];
  if (settings.sparse && !settings.cone) {
    rows.push({
      kind: "custom",
      label: "Checked out by patterns",
      hint: "This repository's sparse checkout uses patterns rather than folders, so it's changed with git sparse-checkout instead.",
      content: null,
    });
    return rows;
  }
  if (settings.available.length === 0) return rows;
  rows.push({
    kind: "custom",
    label: "Folders to check out",
    hint: settings.partial || settings.sparse ? "Folders you add are downloaded and checked out; folders you take away leave your disk (commit or stash changes in them first)." : "Folders you take away leave your disk (commit or stash changes in them first). Files at the top always stay.",
    content: (
      <div className="sparse-folders" role="group" aria-label="Folders to check out">
        {settings.available.map((folder) => {
          const covered = inside(folder.path, chosen);
          return (
            <label key={folder.path} className={`checkbox sparse-folder${folder.nested ? " nested" : ""}`}>
              <input type="checkbox" checked={covered || chosen.has(folder.path)} disabled={covered || busy} onChange={() => toggle(folder.path)} />
              <span className="mono">{folder.nested ? folder.path.slice(folder.path.indexOf("/") + 1) : folder.path}</span>
            </label>
          );
        })}
      </div>
    ),
  });
  rows.push({
    kind: "custom",
    label: "",
    hint: wanted.length > 0 ? `${plural(wanted.length, "folder")} and the files at the top.` : undefined,
    content: (
      <button className="primary-small-button" onClick={() => apply(wanted)} disabled={busy || wanted.length === 0 || unchanged}>
        {busy ? "Checking out…" : "Check out only these"}
      </button>
    ),
  });
  return rows;
}
