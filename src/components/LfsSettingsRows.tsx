import { useCallback, useEffect, useState } from "react";
import { lfsSettings, type Action, type LfsSettings } from "../api";
import { formatBytes, plural } from "../lib/format";
import { openInBrowser } from "../lib/weblinks";
import { ExternalLinkIcon, PlusIcon } from "./Icons";
import { LfsStorageSummary } from "./LfsCleanup";
import { NameList, type SettingRow } from "./SettingsDialog";

/** File types often stored with Git LFS, offered when a repository doesn't use it yet. */
const COMMON = ["*.psd", "*.png", "*.wav", "*.mp4", "*.fbx", "*.uasset", "*.umap", "*.zip"];

interface Options {
  path: string;
  run: (action: Action) => Promise<boolean>;
  onCleanUp: () => void;
}

/**
 * The repository settings' Git LFS rows: which files are stored with it (add or remove
 * patterns, or start with suggestions from the big files here), and the space its files
 * take on this computer.
 */
export function useLfsSettingsRows({ path, run, onCleanUp }: Options): SettingRow[] {
  const [settings, setSettings] = useState<LfsSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    lfsSettings(path)
      .then(setSettings)
      .catch(() => setSettings({ installed: false, patterns: [], suggestions: [] }));
  }, [path]);
  useEffect(load, [load]);

  const change = async (action: Action) => {
    setBusy(true);
    await run(action);
    setBusy(false);
    load();
  };
  const track = (patterns: string[]) => change({ kind: "trackWithLfs", patterns, paths: [] });

  if (!settings) return [{ kind: "custom", label: "Git LFS", hint: "Looking…", content: null }];
  if (!settings.installed) {
    return [
      {
        kind: "custom",
        label: "Git LFS isn't installed",
        hint: "It keeps big files like art, audio and video out of git itself, so clones stay small. Install it, then come back here to choose which files to store with it.",
        content: (
          <button className="outline-button" onClick={() => openInBrowser("https://git-lfs.com")}>
            <ExternalLinkIcon size={13} />
            <span className="button-label">Get Git LFS</span>
          </button>
        ),
      },
    ];
  }

  const using = settings.patterns.length > 0;
  const rows: SettingRow[] = [
    {
      kind: "custom",
      label: using ? "Stored with Git LFS" : "Store big files with Git LFS",
      hint: using
        ? "Files matching these go to Git LFS from their next commit. Files committed before stay in git's history. Commit .gitattributes to share the list."
        : "Git LFS keeps big files like art, audio and video out of git itself, so clones stay small. Add the kinds of files to store with it, like *.psd.",
      content: (
        <NameList
          names={settings.patterns}
          placeholder={busy ? "…" : "Add, like *.psd"}
          onChange={(names) => {
            const added = names.filter((name) => !settings.patterns.includes(name));
            const removed = settings.patterns.filter((name) => !names.includes(name));
            if (added.length > 0) track(added);
            else if (removed.length > 0) change({ kind: "untrackWithLfs", patterns: removed });
          }}
        />
      ),
    },
  ];
  if (settings.suggestions.length > 0) {
    rows.push({
      kind: "custom",
      label: "Big files here",
      hint: "Kinds of files over 1 MB in this repository that aren't stored with Git LFS.",
      content: (
        <span className="lfs-suggestions">
          {settings.suggestions.map((suggestion) => (
            <button
              key={suggestion.pattern}
              className="lfs-suggestion"
              onClick={() => track([suggestion.pattern])}
              disabled={busy}
              title={`Store ${suggestion.pattern} files with Git LFS`}
              aria-label={`Store ${suggestion.pattern} files with Git LFS (${plural(suggestion.files, "file")}, ${formatBytes(suggestion.bytes)})`}
            >
              <PlusIcon size={11} />
              <span className="lfs-suggestion-pattern">{suggestion.pattern}</span>
              <span className="lfs-suggestion-size">
                {plural(suggestion.files, "file")}, {formatBytes(suggestion.bytes)}
              </span>
            </button>
          ))}
        </span>
      ),
    });
  } else if (!using) {
    rows.push({
      kind: "custom",
      label: "Common kinds",
      content: (
        <span className="lfs-suggestions">
          {COMMON.map((pattern) => (
            <button
              key={pattern}
              className="lfs-suggestion"
              onClick={() => track([pattern])}
              disabled={busy}
              title={`Store ${pattern} files with Git LFS`}
              aria-label={`Store ${pattern} files with Git LFS`}
            >
              <PlusIcon size={11} />
              <span className="lfs-suggestion-pattern">{pattern}</span>
            </button>
          ))}
        </span>
      ),
    });
  }
  if (using) {
    rows.push({
      kind: "custom",
      label: "Git LFS files on this computer",
      hint: "Copies of every version you've downloaded. Cleaning up keeps what you still need.",
      content: <LfsStorageSummary repoPath={path} onCleanUp={onCleanUp} />,
    });
  }
  return rows;
}
