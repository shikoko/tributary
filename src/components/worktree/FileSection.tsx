import { useMemo, useState, type ReactNode } from "react";
import type { DiffSource, FileChange, Lock, Overlap } from "../../api";
import { fileTreeRows } from "../../lib/fileTree";
import { plural } from "../../lib/format";
import { useFilesLayout } from "../FilesLayoutSwitch";
import { FileLine, FolderLine } from "../FileLine";
import { FileList } from "../FileList";
import { Button } from "../ui/Button";

interface Props {
  title: string;
  files: FileChange[];
  empty: string;
  bulk: { label: string; onClick: () => void };
  fileAction: (file: FileChange) => { label: string; icon: ReactNode; onClick: () => void };
  /** The same for a folder in the tree: everything changed in it, like "Stage folder". */
  folderAction: (files: FileChange[]) => { label: string; icon: ReactNode; onClick: () => void };
  busy: boolean;
  lockOf: (path: string) => Lock | undefined;
  onFileMenu: (file: FileChange, x: number, y: number, source: DiffSource) => void;
  /** Where else a file was changed, if anywhere. */
  elsewhereOf?: (path: string) => Overlap | undefined;
  /** Staged or unstaged: what a file's changes are compared against. */
  source: DiffSource;
  onOpen: (file: FileChange, source: DiffSource) => void;
  /** The file whose changes are shown. */
  isShown: (path: string, source: DiffSource) => boolean;
}

/**
 * Staged or unstaged files, each with a button to move it to the other list, and one for all of
 * them. As a tree of their folders (the List or Tree choice), each folder has a button for
 * everything changed in it.
 */
export function FileSection({ title, files, empty, bulk, fileAction, folderAction, busy, lockOf, onFileMenu, elsewhereOf, source, onOpen, isShown }: Props) {
  const [layout] = useFilesLayout();
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (path: string) =>
    setClosed((before) => {
      const next = new Set(before);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const rows = useMemo(() => (layout === "tree" ? fileTreeRows(files, closed) : null), [layout, files, closed]);
  /** The files under `folder`, all the way down (an untracked folder's own path ends in "/"). */
  const inside = (folder: string) => files.filter((file) => file.path.startsWith(`${folder}/`));
  const fileLine = (file: FileChange, depth?: number) => (
    <FileLine
      file={file}
      depth={depth}
      action={{ ...fileAction(file), disabled: busy }}
      lock={lockOf(file.path)}
      elsewhere={elsewhereOf?.(file.path)}
      onContextMenu={(file, x, y) => onFileMenu(file, x, y, source)}
      onOpen={(file) => onOpen(file, source)}
      shown={isShown(file.path, source)}
    />
  );
  return (
    <section className="files">
      <h3>
        {title}
        <span className="hint">{plural(files.length, "file")}</span>
        <span className="spacer" />
        {files.length > 0 && (
          <Button kind="link" onClick={bulk.onClick} disabled={busy}>
            {bulk.label}
          </Button>
        )}
      </h3>
      {files.length === 0 ? (
        <div className="muted">{empty}</div>
      ) : rows ? (
        <FileList
          items={rows}
          keyOf={(row) => (row.kind === "folder" ? `folder:${row.path}` : `${row.file.status}:${row.file.oldPath ?? ""}:${row.file.path}`)}
          render={(row) =>
            row.kind === "folder" ? (
              <FolderLine row={row} onToggle={() => toggle(row.path)} action={{ ...folderAction(inside(row.path)), disabled: busy }} />
            ) : (
              fileLine(row.file, row.depth)
            )
          }
        />
      ) : (
        <FileList items={files} keyOf={(file) => `${file.status}:${file.oldPath ?? ""}:${file.path}`} render={(file) => fileLine(file)} />
      )}
    </section>
  );
}
