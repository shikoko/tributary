import type { FileChange } from "../api";

/** How many of a folder's files (all the way down) were added, changed or deleted. */
export interface ChangeCounts {
  added: number;
  changed: number;
  deleted: number;
}

/** A folder in the tree: its path from the top, the name it shows (a chain of folders joined: "Content/Props"), and what's in it. */
export interface FolderRow {
  kind: "folder";
  path: string;
  name: string;
  depth: number;
  open: boolean;
  counts: ChangeCounts;
}

export interface FileRow {
  kind: "file";
  file: FileChange;
  depth: number;
}

export type TreeRow = FolderRow | FileRow;

interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  files: FileChange[];
}

const folder = (name: string, path: string): Folder => ({ name, path, folders: new Map(), files: [] });

/** Added, changed or deleted, for the counts. */
function kind(status: FileChange["status"]): keyof ChangeCounts {
  if (status === "added" || status === "untracked") return "added";
  if (status === "deleted") return "deleted";
  return "changed";
}

function counts(of: Folder): ChangeCounts {
  const total: ChangeCounts = { added: 0, changed: 0, deleted: 0 };
  for (const file of of.files) total[kind(file.status)]++;
  for (const inner of of.folders.values()) {
    const sub = counts(inner);
    total.added += sub.added;
    total.changed += sub.changed;
    total.deleted += sub.deleted;
  }
  return total;
}

/** A folder holding nothing but one other folder is shown as one, with the two names joined. */
function joined(of: Folder): Folder {
  let current = of;
  while (current.files.length === 0 && current.folders.size === 1) {
    const [only] = current.folders.values();
    current = { ...only, name: `${current.name}/${only.name}` };
  }
  return current;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/** A file's name in its folder ("dir/" for an untracked folder, listed whole). */
function nameOf(file: FileChange): string {
  const path = file.path.endsWith("/") ? file.path.slice(0, -1) : file.path;
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * `files` as a tree, in rows: each folder (folders first, then files, each by name), then
 * what's in it, unless it's in `closed` (by its path). A chain of folders with nothing else
 * in them is one row ("Content/Props"). Files at the top have no folder.
 */
export function fileTreeRows(files: FileChange[], closed: ReadonlySet<string> = new Set()): TreeRow[] {
  const top = folder("", "");
  for (const file of files) {
    const path = file.path.endsWith("/") ? file.path.slice(0, -1) : file.path;
    const parts = path.split("/");
    let at = top;
    for (const part of parts.slice(0, -1)) {
      const path = at.path ? `${at.path}/${part}` : part;
      let next = at.folders.get(part);
      if (!next) at.folders.set(part, (next = folder(part, path)));
      at = next;
    }
    at.files.push(file);
  }
  const rows: TreeRow[] = [];
  const walk = (at: Folder, depth: number) => {
    for (const key of [...at.folders.keys()].sort(byName)) {
      const shown = joined(at.folders.get(key)!);
      const open = !closed.has(shown.path);
      rows.push({ kind: "folder", path: shown.path, name: shown.name, depth, open, counts: counts(shown) });
      if (open) walk(shown, depth + 1);
    }
    for (const file of [...at.files].sort((a, b) => byName(nameOf(a), nameOf(b)))) rows.push({ kind: "file", file, depth });
  };
  walk(top, 0);
  return rows;
}
