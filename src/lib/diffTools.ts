import { useEffect, useRef, useState } from "react";
import { diffToolSettings, type DiffToolSettings } from "../api";

/** Names people know the tools by, for buttons like "Open in Meld". */
const LABELS: Record<string, string> = {
  vscode: "Visual Studio Code",
  meld: "Meld",
  kdiff3: "KDiff3",
  p4merge: "P4Merge",
  bc: "Beyond Compare",
  bc3: "Beyond Compare",
  bc4: "Beyond Compare",
  winmerge: "WinMerge",
  opendiff: "FileMerge",
  smerge: "Sublime Merge",
  tortoisemerge: "TortoiseMerge",
  araxis: "Araxis Merge",
  deltawalker: "DeltaWalker",
  diffmerge: "DiffMerge",
  codecompare: "Code Compare",
  examdiff: "ExamDiff",
  guiffy: "Guiffy",
  kompare: "Kompare",
  tkdiff: "TkDiff",
  xxdiff: "xxdiff",
  gvimdiff: "gVim",
  diffuse: "Diffuse",
  ecmerge: "ECMerge",
};

/** "Meld" for "meld"; "your diff tool" for a command of your own. */
export function toolLabel(name: string | null, kind: "diff" | "merge" = "diff"): string {
  if (!name) return `your ${kind} tool`;
  if (name === "custom") return `your ${kind} tool`;
  return LABELS[name] ?? name;
}

const listeners = new Set<() => void>();

/** The diff or merge tool was changed (in Settings): show the new one everywhere. */
export function diffToolsChanged() {
  for (const listener of listeners) listener();
}

/** The diff and merge tools set up, read again whenever they change (not looked up while `enabled` is false). */
export function useDiffTools(path: string | null, list = false, enabled = true): DiffToolSettings | null {
  const [settings, setSettings] = useState<DiffToolSettings | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const listener = () => setAsked((count) => count + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  // The tools on this computer are looked for once (it takes a moment); after a change,
  // only which ones are chosen is read again.
  const listed = useRef<{ path: string | null; available: DiffToolSettings["available"] } | null>(null);
  useEffect(() => {
    if (!enabled) {
      listed.current = null;
      return;
    }
    let live = true;
    const known = list && listed.current?.path === path ? listed.current.available : null;
    diffToolSettings(path, list && !known)
      .then((found) => {
        if (!live) return;
        if (list && !known) listed.current = { path, available: found.available };
        setSettings(known ? { ...found, available: known } : found);
      })
      .catch(() => live && setSettings({ diff: null, merge: null, diffCommand: null, mergeCommand: null, available: [] }));
    return () => {
      live = false;
    };
  }, [path, list, asked, enabled]);
  return settings;
}
