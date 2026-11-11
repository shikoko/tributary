import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { runAction, type CommitRow, type Worktree } from "../api";
import { shortId } from "../lib/format";
import { folderSlug, joinPath, parentFolder } from "../lib/paths";
import { Dialog } from "./Dialog";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";

interface Props {
  repoPath: string;
  /** The repository's folder name, like "notebook". */
  repoName: string;
  /** Local branch names. */
  branches: string[];
  worktrees: Worktree[];
  /** The branch to check out, or the commit to start a new branch at. */
  branch?: string;
  start: CommitRow;
  onCancel: () => void;
  /** Made it: show `message`, and open the new working tree if asked. */
  onDone: (message: string, path: string, openIt: boolean) => void;
}

/** Check out a branch in a new folder, beside this one, to work on it at the same time. */
export function NewWorktreeDialog({ repoPath, repoName, branches, worktrees, branch: initial, start, onCancel, onDone }: Props) {
  const [branch, setBranch] = useState(initial ?? "");
  const [parent, setParent] = useState(parentFolder(repoPath));
  const [folder, setFolder] = useState("");
  /** The folder name follows the branch until it's edited by hand. */
  const [folderEdited, setFolderEdited] = useState(false);
  const [openIt, setOpenIt] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!folderEdited) setFolder(`${repoName}-${folderSlug(branch)}`);
  }, [branch, folderEdited, repoName]);

  const name = branch.trim();
  const existing = branches.includes(name);
  const busyElsewhere = worktrees.find((worktree) => worktree.branch === name);
  const path = joinPath(parent, folder.trim());

  const choose = async () => {
    const picked = await open({ directory: true, multiple: false, defaultPath: parent, title: "Put the worktree in which folder?" }).catch(() => null);
    if (typeof picked === "string") setParent(picked);
  };

  const create = async () => {
    if (!name || !folder.trim() || busyElsewhere || running) return;
    setRunning(true);
    setError(null);
    try {
      const message = await runAction(repoPath, { kind: "addWorktree", path, branch: name, create: !existing, start: existing ? null : start.id });
      onDone(message, path, openIt);
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };

  return (
    <Dialog
      title="New worktree"
      error={error}
      busy={running}
      onCancel={onCancel}
      buttons={
        <>
          <Button kind="secondary" onClick={onCancel} disabled={running}>
            Cancel
          </Button>
          <Button kind="primary" onClick={create} disabled={running || !name || !folder.trim() || Boolean(busyElsewhere)}>
            {running ? "Creating…" : "Create worktree"}
          </Button>
        </>
      }
    >
      <p>A worktree is another folder with another branch checked out. It shares this repository's history, so you can work on two branches at once.</p>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <Field label="Branch">
          <input
            className="text-input"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="A branch to check out, or a name for a new one"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
            disabled={running}
          />
        </Field>
        <p className="hint">
          {!name
            ? " "
            : busyElsewhere
              ? `${name} is already checked out in ${busyElsewhere.path}.`
              : existing
                ? `Checks out the branch ${name}.`
                : `Makes the new branch ${name} at ${shortId(start.id)} ${start.summary}.`}
        </p>
        <Field group label="In">
          <div className="field-row">
            <input className="text-input" value={parent} readOnly onClick={choose} disabled={running} />
            <Button type="button" kind="secondary" onClick={choose} disabled={running}>
              Choose…
            </Button>
          </div>
        </Field>
        <Field label="Folder name">
          <input
            className="text-input"
            value={folder}
            onChange={(event) => {
              setFolder(event.target.value);
              setFolderEdited(true);
            }}
            spellCheck={false}
            disabled={running}
          />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={openIt} onChange={(event) => setOpenIt(event.target.checked)} disabled={running} />
          Open it in a new tab
        </label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
