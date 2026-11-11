import { useCallback, useEffect, useState } from "react";
import { lfsSettings, type Action, type LfsFolder, type LfsSettings } from "../api";
import { formatBytes, plural } from "../lib/format";
import { openInBrowser } from "../lib/weblinks";
import { DownloadIcon, ExternalLinkIcon, PlusIcon } from "./Icons";
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
  /** Which folders' files are downloaded, while choosing (before any folder is in the list). */
  const [fetchMode, setFetchMode] = useState<FetchMode | null>(null);
  const load = useCallback(() => {
    lfsSettings(path)
      .then(setSettings)
      .catch(() => setSettings({ installed: false, patterns: [], suggestions: [], fetchInclude: [], fetchExclude: [], folders: [] }));
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
          <button className="outline-button" onClick={() => openInBrowser("https://git-lfs.com")} data-url="https://git-lfs.com">
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
  if (using && settings.folders.length > 0) {
    rows.push(...downloadRows(settings, fetchMode, setFetchMode, busy, change));
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

/** Download every folder's Git LFS files, only some folders', or all but some. */
type FetchMode = "all" | "only" | "except";

/**
 * Which folders' Git LFS files are downloaded (git-lfs's `lfs.fetchinclude` and
 * `lfs.fetchexclude`): handy in big projects where you only work on some of it. Files in
 * other folders stay small pointer files.
 */
function downloadRows(
  settings: LfsSettings,
  chosenMode: FetchMode | null,
  setMode: (mode: FetchMode | null) => void,
  busy: boolean,
  change: (action: Action) => Promise<void>,
): SettingRow[] {
  const saved: FetchMode = settings.fetchInclude.length > 0 ? "only" : settings.fetchExclude.length > 0 ? "except" : "all";
  const mode = chosenMode ?? saved;
  const list = mode === "only" ? settings.fetchInclude : mode === "except" ? settings.fetchExclude : [];
  const save = (next: FetchMode, names: string[]) =>
    change({ kind: "setLfsFetchFolders", include: next === "only" ? names : [], exclude: next === "except" ? names : [] });
  const files = settings.folders.reduce((sum, folder) => sum + folder.files, 0);
  const downloaded = settings.folders.reduce((sum, folder) => sum + folder.downloaded, 0);
  const rows: SettingRow[] = [
    {
      kind: "select",
      label: "Download Git LFS files",
      hint: "In a big project you may only need some of it. Files in other folders stay small pointer files, and pulling skips them.",
      value: mode,
      options: [
        { value: "all", label: "From every folder" },
        { value: "only", label: "Only from some folders" },
        { value: "except", label: "From every folder but some" },
      ],
      set: (value) => {
        const next = value as FetchMode;
        setMode(next === saved ? null : next);
        // Moving to another kind of list starts it empty; every folder needs no list.
        if (next === "all" || saved !== "all") void save("all", []);
      },
    },
  ];
  if (mode !== "all") {
    const others = settings.folders.filter((folder) => !list.includes(folder.path));
    rows.push({
      kind: "custom",
      label: mode === "only" ? "Folders to download" : "Folders to skip",
      hint: list.length === 0 ? "Pick folders below, or type a folder or a pattern like *.wav." : undefined,
      content: (
        <span className="lfs-folders">
          <NameList
            names={list}
            placeholder={busy ? "…" : "Add, like Content/Art"}
            onChange={(names) => {
              setMode(names.length > 0 ? null : mode);
              void save(mode, names);
            }}
          />
          {others.length > 0 && (
            <span className="lfs-suggestions">
              {others.map((folder) => (
                <FolderChip key={folder.path} folder={folder} disabled={busy} onAdd={() => {
                  setMode(null);
                  void save(mode, [...list, folder.path]);
                }} />
              ))}
            </span>
          )}
        </span>
      ),
    });
  }
  rows.push({
    kind: "custom",
    label: "Download now",
    hint: `${downloaded.toLocaleString()} of the ${plural(files, "file")} stored with Git LFS are on this computer. Pulling downloads the ones you chose; this gets them now.`,
    content: (
      <button className="outline-button" disabled={busy} onClick={() => void change({ kind: "downloadLfsFiles" })}>
        <DownloadIcon size={13} />
        <span className="button-label">Download</span>
      </button>
    ),
  });
  return rows;
}

function FolderChip({ folder, disabled, onAdd }: { folder: LfsFolder; disabled: boolean; onAdd: () => void }) {
  return (
    <button className="lfs-suggestion" onClick={onAdd} disabled={disabled} title={`Add ${folder.path}`} aria-label={`Add ${folder.path} (${plural(folder.files, "file")}, ${formatBytes(folder.bytes)})`}>
      <PlusIcon size={11} />
      <span className="lfs-suggestion-pattern">{folder.path}</span>
      <span className="lfs-suggestion-size">
        {plural(folder.files, "file")}
        {folder.bytes > 0 && `, ${formatBytes(folder.bytes)}`}
      </span>
    </button>
  );
}
