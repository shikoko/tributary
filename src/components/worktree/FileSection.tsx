import type { ReactNode } from "react";
import type { DiffSource, FileChange, Lock, Overlap } from "../../api";
import { plural } from "../../lib/format";
import { FileLine } from "../FileLine";

interface Props {
  title: string;
  files: FileChange[];
  empty: string;
  bulk: { label: string; onClick: () => void };
  fileAction: (file: FileChange) => { label: string; icon: ReactNode; onClick: () => void };
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

/** Staged or unstaged files, each with a button to move it to the other list, and one for all of them. */
export function FileSection({ title, files, empty, bulk, fileAction, busy, lockOf, onFileMenu, elsewhereOf, source, onOpen, isShown }: Props) {
  return (
    <section className="files">
      <h3>
        {title}
        <span className="hint">{plural(files.length, "file")}</span>
        <span className="spacer" />
        {files.length > 0 && (
          <button className="link-button" onClick={bulk.onClick} disabled={busy}>
            {bulk.label}
          </button>
        )}
      </h3>
      {files.length === 0 ? (
        <div className="muted">{empty}</div>
      ) : (
        <ul className="file-list">
          {files.map((file) => (
            <FileLine
              key={`${file.status}:${file.oldPath ?? ""}:${file.path}`}
              file={file}
              action={{ ...fileAction(file), disabled: busy }}
              lock={lockOf(file.path)}
              elsewhere={elsewhereOf?.(file.path)}
              onContextMenu={(file, x, y) => onFileMenu(file, x, y, source)}
              onOpen={(file) => onOpen(file, source)}
              shown={isShown(file.path, source)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
