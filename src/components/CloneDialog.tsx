import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { cancelAction, cloneRepository, onProgress, type CloneOptions, type Progress } from "../api";
import { useStoredState } from "../lib/settings";
import type { Accounts, Forge } from "../app/useAccounts";
import { AccountChips } from "./AccountChips";
import { Dialog } from "./Dialog";
import { ProgressBars, ProgressText } from "./ProgressStrip";
import { YourRepositories } from "./YourRepositories";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";

interface Props {
  onCancel: () => void;
  /** Cloned into `path`: open it. */
  onDone: (path: string) => void;
  /** Who's signed in, for picking one of your repositories. */
  accounts: Accounts;
  onSignIn: (forge: Forge) => void;
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
export function CloneDialog({ onCancel, onDone, accounts, onSignIn }: Props) {
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
  const signedIn = Boolean(accounts.github.status?.account || accounts.gitlab.status?.account);

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
          <Button kind="secondary" onClick={() => cancelAction().catch(() => {})}>
            Cancel
          </Button>
        ) : (
          <>
            <Button kind="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button kind="primary" onClick={clone} disabled={!url.trim() || !parent || !name.trim()}>
              Clone
            </Button>
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
        {signedIn ? (
          <Field group label="Your repositories">
            <YourRepositories
              accounts={accounts}
              picked={url.trim()}
              onPick={(repo) => {
                setUrl(repo.url);
                setNameEdited(false);
                setError(null);
              }}
            />
            {!running && <AccountChips accounts={accounts} onSignIn={onSignIn} />}
          </Field>
        ) : (
          !running && (
            <div className="field clone-sign-in">
              <span>Sign in to pick one of your repositories</span>
              <AccountChips accounts={accounts} onSignIn={onSignIn} />
            </div>
          )
        )}
        <Field label={signedIn ? "Or its address" : "Address"}>
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
            autoFocus={!signedIn}
            disabled={running}
          />
        </Field>
        <Field group label="Into">
          <div className="field-row">
            <input className="text-input" value={parent} readOnly placeholder="Choose a folder" onClick={choose} disabled={running} />
            <Button type="button" kind="secondary" onClick={choose} disabled={running}>
              Choose…
            </Button>
          </div>
        </Field>
        <Field label="Folder name">
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
        </Field>
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
            <p className="hint checkbox-hint">They arrive as small pointer files. Download them all from Repository → Git LFS, or as you check out branches.</p>
            <Field label="Only these folders">
              <input
                className="text-input"
                value={folders}
                onChange={(event) => setFolders(event.target.value)}
                placeholder="Everything, or like: Content/Maps, Source"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </Field>
            {parseFolders(folders).length > 0 && (
              <p className="hint">Other folders aren't checked out, and their files aren't downloaded. Files at the top are always there.</p>
            )}
            <Field label="History">
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
            </Field>
          </fieldset>
        ) : (
          !running && (
            <Button type="button" kind="link" className="clone-options-toggle" onClick={() => setShowOptions(true)}>
              Options for big repositories…
            </Button>
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
