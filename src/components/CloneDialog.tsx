import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { cancelAction, cloneRepository, onProgress, type Progress } from "../api";
import { useStoredState } from "../lib/settings";
import { Dialog } from "./Dialog";

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
      const path = await cloneRepository(url.trim(), parent, name.trim());
      onDone(path);
    } catch (e) {
      setError(String(e) === "Cancelled." ? null : String(e));
      setRunning(false);
    } finally {
      stop?.();
    }
  };

  const percent = progress?.percent ?? null;
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
        {running && (
          <div className="clone-progress">
            <span>
              Cloning…{" "}
              <span className="muted">
                {progress && progress.phase !== "Connecting" ? `${progress.phase}${percent !== null ? ` ${percent}%` : ""}` : ""}
              </span>
            </span>
            <div className="progress-track">
              <div
                className={`progress-fill${percent === null ? " indeterminate" : ""}`}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
