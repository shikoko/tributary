import type { FileChange, WorktreeStatus } from "../api";
import { plural } from "../lib/format";
import { FileLine } from "./CommitDetails";
import { CloseIcon } from "./Icons";

interface Props {
  status: WorktreeStatus;
  headBranch: string | null;
  onClose: () => void;
}

/** Details for the "Uncommitted changes" row: what is staged and what isn't. */
export function WorktreeDetailsPanel({ status, headBranch, onClose }: Props) {
  return (
    <aside className="details" aria-label="Uncommitted changes">
      <header className="details-header">
        <span className="details-label">Working tree</span>
        <span className="spacer" />
        <button className="icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close details">
          <CloseIcon />
        </button>
      </header>

      <div className="details-scroll">
        <h2 className="details-summary">Uncommitted changes</h2>
        <p className="details-body">
          {headBranch ? `On branch ${headBranch}.` : "HEAD is detached."} Changes made in other apps show up when you come back to this window.
        </p>
        <FileSection title="Staged" files={status.staged} empty="Nothing staged." />
        <FileSection title="Unstaged" files={status.unstaged} empty="No unstaged changes." />
      </div>
    </aside>
  );
}

function FileSection({ title, files, empty }: { title: string; files: FileChange[]; empty: string }) {
  return (
    <section className="files">
      <h3>
        {title}
        <span className="hint">{plural(files.length, "file")}</span>
      </h3>
      {files.length === 0 ? (
        <div className="muted">{empty}</div>
      ) : (
        <ul className="file-list">
          {files.map((file) => (
            <FileLine key={`${file.status}:${file.oldPath ?? ""}:${file.path}`} file={file} />
          ))}
        </ul>
      )}
    </section>
  );
}
