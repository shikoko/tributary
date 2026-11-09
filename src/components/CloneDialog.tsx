import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { cancelAction, cloneRepository, onProgress, type CloneOptions, type Progress } from "../api";
import { useStoredState } from "../lib/settings";
import { Dialog } from "./Dialog";
import { ProgressBars, ProgressText } from "./ProgressStrip";

interface Props {
  onCancel: () => void;
  /** Cloned into `path`: open it. */
  onDone: (path: string) => void;
}

/** "https://github.com/owner/repo.git" → "repo". */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[/\\]+$/, "").replace(/\.git$/, "");
  const last = trimmed.split(/[/\\:]/).pop() ?? "";
  return last.replace(/[^\w.-]/g, "-");
}

/** "Content/Maps, Source\nDocs" → ["Content/Maps", "Source", "Docs"]. */
export function parseFolders(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((folder) => folder.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
}

/** How much history to download. */
const DEPTHS: { label: string; depth: number | null }[] = [
  { label: "All of it", depth: null },
  { label: "The last 1,000 commits", depth: 1000 },
  { label: "The last 100 commits", depth: 100 },
  { label: "Only the latest commit", depth: 1 },
];

/** Joins a folder and a name for display, with the separator the folder already uses. */
function join(folder: string, name: string) {
  const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return folder.endsWith(separator) ? folder + name : folder + separator + name;
}

/** Clone a repository from an address into a new folder, then open it. */
export function CloneDialog({ onCancel, onDone }: Props) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useStoredState<string>("clone.parent", "");
  const [name, setName] = useState("");
  /** The name follows the address until it's edited by hand. */
  const [nameEdited, setNameEdited] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // For big repositories: download less.
  const [showOptions, setShowOptions] = useState(false);
  const [skipLfs, setSkipLfs] = useState(false);
  const [folders, setFolders] = useState("");
  const [depth, setDepth] = useState<number | null>(null);
  const [submodules, setSubmodules] = useState(true);

  useEffect(() => {
    if (!nameEdited) setName(repoNameFromUrl(url));
  }, [url, nameEdited]);

  const choose = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Clone into which folder?" }).catch(() => null);
    if (typeof folder === "string") setParent(folder);
  };

  const clone = async () => {
    if (!url.trim() || !parent || !name.trim() || running) return;
    setRunning(true);
    setError(null);
    setProgress(null);
    const stop = await onProgress(setProgress).catch(() => undefined);
    try {
      const options: CloneOptions = { skipLfs, folders: parseFolders(folders), depth, submodules };
      const path = await cloneRepository(url.trim(), parent, name.trim(), options);
      onDone(path);
    } catch (e) {
      setError(String(e) === "Cancelled." ? null : String(e));
      setRunning(false);
    } finally {
      stop?.();
    }
  };

  return (
    <Dialog
      title="Clone a repository"
      error={error}
      busy={running}
      onCancel={onCancel}
      buttons={
        running ? (
          <button className="secondary-button" onClick={() => cancelAction().catch(() => {})}>
            Cancel
          </button>
        ) : (
          <>
            <button className="secondary-button" onClick={onCancel}>
              Cancel
            </button>
            <button className="primary-small-button" onClick={clone} disabled={!url.trim() || !parent || !name.trim()}>
              Clone
            </button>
          </>
        )
      }
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          clone();
        }}
      >
        <label className="field">
          <span>Address</span>
          <input
            className="text-input"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            placeholder="https://github.com/owner/repo.git or git@github.com:owner/repo.git"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
            disabled={running}
          />
        </label>
        <div className="field">
          <span>Into</span>
          <div className="field-row">
            <input className="text-input" value={parent} readOnly placeholder="Choose a folder" onClick={choose} disabled={running} />
            <button type="button" className="secondary-button" onClick={choose} disabled={running}>
              Choose…
            </button>
          </div>
        </div>
        <label className="field">
          <span>Folder name</span>
          <input
            className="text-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameEdited(true);
            }}
            spellCheck={false}
            disabled={running}
          />
        </label>
        {parent && name.trim() && <p className="hint">The repository will be in {join(parent, name.trim())}</p>}
        <label className="checkbox clone-submodules">
          <input type="checkbox" checked={submodules} onChange={(event) => setSubmodules(event.target.checked)} disabled={running} />
          Also clone its submodules, if it has any
        </label>
        {showOptions ? (
          <fieldset className="clone-options" disabled={running}>
            <legend>For big repositories</legend>
            <label className="checkbox">
              <input type="checkbox" checked={skipLfs} onChange={(event) => setSkipLfs(event.target.checked)} />
              Download Git LFS files later
            </label>
            <p className="hint checkbox-hint">They arrive as small pointer files. Download them all from the Repository menu, or as you check out branches.</p>
            <label className="field">
              <span>Only these folders</span>
              <input
                className="text-input"
                value={folders}
                onChange={(event) => setFolders(event.target.value)}
                placeholder="Everything, or like: Content/Maps, Source"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            {parseFolders(folders).length > 0 && (
              <p className="hint">Other folders aren't checked out, and their files aren't downloaded. Files at the top are always there.</p>
            )}
            <label className="field">
              <span>History</span>
              <select
                className="text-input"
                value={depth ?? ""}
                onChange={(event) => setDepth(event.target.value ? Number(event.target.value) : null)}
              >
                {DEPTHS.map((choice) => (
                  <option key={choice.label} value={choice.depth ?? ""}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        ) : (
          !running && (
            <button type="button" className="link-button clone-options-toggle" onClick={() => setShowOptions(true)}>
              Options for big repositories…
            </button>
          )
        )}
        {running && (
          <div className="clone-progress">
            <ProgressText label="Cloning" progress={progress} />
            <ProgressBars progress={progress} />
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
