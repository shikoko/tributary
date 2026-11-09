import { useEffect, useMemo, useState } from "react";
import { shelves as loadShelves, type Action, type FileChange, type Shelf, type WorktreeStatus } from "../api";
import { plural, relativeTime } from "../lib/format";
import { baseName, folderOf } from "../lib/paths";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";
import { ShelfIcon } from "./Icons";

interface Props {
  repoPath: string;
  /** Your uncommitted changes, to shelve (null when there are none, or it can't change). */
  status: WorktreeStatus | null;
  /** The files to start with; all of them when left out. */
  paths?: string[];
  /** The commit checked out, to say when a shelf was made on another one. */
  head: string | null;
  /** Whether shelves can be opened here (not in a bare repository). */
  canChange: boolean;
  /** Runs a git action (closing this first); resolves to whether it worked. */
  run: (action: Action, kind: "push" | "download" | "other") => Promise<boolean>;
  onClose: () => void;
}

/**
 * Shelves: unfinished work shared with the team without committing it to a branch. Shelve
 * your changes, or open someone's: its files are taken into your copy as they were shelved.
 */
export function ShelvesDialog({ repoPath, status, paths, head, canChange, run, onClose }: Props) {
  const files = useMemo(() => {
    const byPath = new Map<string, FileChange>();
    for (const file of [...(status?.staged ?? []), ...(status?.unstaged ?? [])]) {
      if (file.status !== "conflicted" && !byPath.has(file.path)) byPath.set(file.path, file);
    }
    return [...byPath.values()];
  }, [status]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(files.filter((file) => !paths || paths.includes(file.path)).map((file) => file.path)));
  const [description, setDescription] = useState("");
  const [keep, setKeep] = useState(true);
  const [list, setList] = useState<Shelf[] | null>(null);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // The ones here at once, then the remote's.
  useEffect(() => {
    let current = true;
    loadShelves(repoPath, false)
      .then((found) => current && setList((before) => before ?? found))
      .catch(() => {});
    loadShelves(repoPath, true)
      .then((found) => current && setList(found))
      .catch((error) => current && setFetchError(String(error)))
      .finally(() => current && setFetching(false));
    return () => {
      current = false;
    };
  }, [repoPath]);

  const toggle = (path: string) =>
    setChosen((now) => {
      const next = new Set(now);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const picked = files.filter((file) => chosen.has(file.path));
  const everything = picked.length === files.length;
  const shelve = () => {
    if (picked.length === 0 || !description.trim()) return;
    const list = everything ? [] : picked.flatMap((file) => (file.oldPath ? [file.oldPath, file.path] : [file.path]));
    onClose();
    void run({ kind: "shelve", paths: list, description: description.trim(), keep }, "push");
  };
  const remove = async (shelf: Shelf) => {
    if (deleting !== shelf.reference) {
      setDeleting(shelf.reference);
      return;
    }
    if (await run({ kind: "deleteShelf", reference: shelf.reference }, "other")) {
      setList((now) => (now ?? []).filter((each) => each.reference !== shelf.reference));
    }
    setDeleting(null);
  };

  return (
    <Dialog
      title="Shelves"
      wide
      className="shelves-dialog"
      onCancel={onClose}
      buttons={
        <button className="secondary-button" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="dialog-note-line">
        Unfinished work, shared with your team without committing it to a branch. Anyone can open a shelf: its files are taken into their copy as they were
        shelved.
      </p>

      {files.length > 0 && (
        <form
          className="shelve-form"
          onSubmit={(event) => {
            event.preventDefault();
            shelve();
          }}
        >
          <h3>Shelve your changes</h3>
          <input
            className="text-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What it is, like “Tavern sign, darker wood: for Rosa to look at”"
            aria-label="What the shelf is for"
            autoFocus
          />
          <ul className="stash-files shelve-files">
            {files.map((file) => (
              <li key={file.path}>
                <label className="checkbox">
                  <input type="checkbox" checked={chosen.has(file.path)} onChange={() => toggle(file.path)} />
                  <span className="stash-file-name">{baseName(file.path)}</span>
                  <span className="stash-file-dir">{file.status === "untracked" ? "new" : folderOf(file.path)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="shelve-actions">
            <label className="checkbox" title="Unticked, they're taken out of your copy once shelved (Undo puts them back)">
              <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
              Keep them in my copy too
            </label>
            <span className="spacer" />
            <button
              type="button"
              className="link-button"
              onClick={() => setChosen(new Set(chosen.size === files.length ? [] : files.map((file) => file.path)))}
            >
              {chosen.size === files.length ? "Select none" : "Select all"}
            </button>
            <button type="submit" className="primary-small-button" disabled={picked.length === 0 || !description.trim()}>
              <ShelfIcon size={13} />
              Shelve {plural(picked.length, "file")}
            </button>
          </div>
        </form>
      )}

      <div className="shelves-head">
        <h3>On the shelves</h3>
        {fetching && <span className="shelves-status">Fetching the team's…</span>}
        {!fetching && fetchError && <span className="shelves-status error">{fetchError}</span>}
      </div>
      {list === null ? (
        <p className="shelves-empty">Looking…</p>
      ) : list.length === 0 ? (
        <p className="shelves-empty">{fetching ? "None here yet." : "None yet. Shelve your changes to share them."}</p>
      ) : (
        <ul className="shelves-list">
          {list.map((shelf) => {
            const expanded = open === shelf.reference;
            const elsewhere = shelf.base && head && shelf.base !== head;
            return (
              <li key={shelf.reference} className={`shelf${shelf.mine ? " mine" : ""}`}>
                <Avatar name={shelf.author} email={shelf.email} size={28} />
                <div className="shelf-text">
                  <strong className="shelf-description">{shelf.description}</strong>
                  <span className="shelf-meta">
                    {shelf.mine ? "You" : shelf.author} · {relativeTime(shelf.time)}
                    {shelf.branch && (
                      <>
                        {" · on "}
                        <span className="mono">{shelf.branch}</span>
                      </>
                    )}
                    {" · "}
                    <button className="link-button shelf-files-toggle" onClick={() => setOpen(expanded ? null : shelf.reference)} aria-expanded={expanded}>
                      {plural(shelf.files.length, "file")}
                    </button>
                  </span>
                  {expanded && (
                    <ul className="shelf-files">
                      {shelf.files.map((file) => (
                        <li key={file.path}>
                          <span className={`shelf-change ${file.change}`}>{file.change === "added" ? "A" : file.change === "deleted" ? "D" : "M"}</span>
                          <span className="mono">{file.path}</span>
                        </li>
                      ))}
                      {elsewhere && <li className="shelf-note">Shelved on another commit than yours: its files come as they were shelved.</li>}
                    </ul>
                  )}
                </div>
                <div className="shelf-buttons">
                  <button
                    className="outline-button"
                    disabled={!canChange}
                    title={canChange ? "Take its files into your copy, as they were shelved" : undefined}
                    onClick={() => {
                      onClose();
                      void run({ kind: "openShelf", reference: shelf.reference }, "download");
                    }}
                  >
                    <span className="button-label">Open</span>
                  </button>
                  <button
                    className={`outline-button${deleting === shelf.reference ? " danger" : ""}`}
                    onClick={() => void remove(shelf)}
                    onBlur={() => deleting === shelf.reference && setDeleting(null)}
                    title={shelf.mine ? "Delete it, for everyone" : `Delete ${shelf.author}'s shelf, for everyone`}
                  >
                    <span className="button-label">{deleting === shelf.reference ? (shelf.mine ? "Delete it?" : `Delete ${shelf.author.split(" ")[0]}'s?`) : "Delete"}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
