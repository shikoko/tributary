import { useMemo, useState } from "react";
import type { FileChange, PullRequest, RequestDetails } from "../api";
import type { RequestFiles } from "../app/useRequestFiles";
import { ActorNames, useActorNames } from "../lib/actorNames";
import { FILTER_FROM, filterFiles } from "../lib/fileFilter";
import { fileTreeRows } from "../lib/fileTree";
import { requestNoun, requestNumber } from "../lib/pullRequests";
import { FileLine, FolderLine } from "./FileLine";
import { FileFilter, FileList } from "./FileList";
import { FilesLayoutSwitch, useFilesLayout } from "./FilesLayoutSwitch";
import { CloseIcon } from "./Icons";
import { Loader } from "./Loader";
import { Button } from "./ui/Button";

interface Props {
  repoPath: string;
  request: PullRequest;
  /** As its site says, once loaded. */
  details: RequestDetails | null;
  files: RequestFiles;
  /** Show a file's changes, over the pull request. */
  onOpenFile: (file: FileChange) => void;
  isShown: (path: string) => boolean;
  /** How many comments each file has on its lines, once its conversation is read. */
  comments: ReadonlyMap<string, number> | null;
  /** Fetch its commits, from the remote it's on. */
  onFetch: (() => void) | null;
  /** Close the pull request. */
  onClose: () => void;
}

const NONE_CLOSED: ReadonlySet<string> = new Set();

/**
 * An open pull request's files, in the details panel as a commit's are: what its branch
 * changed since it split from the one it goes into, each opening its changes over the
 * pull request.
 */
export function RequestFilesPanel({ repoPath, request, details, files, onOpenFile, isShown, comments, onFetch, onClose }: Props) {
  const { comparison, error, unknown, missing } = files;
  const noun = requestNoun(request.forge);
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  const site = request.forge === "gitlab" ? "GitLab" : "GitHub";
  // Unreal actors among the files, named as they are in the editor.
  const actors = useActorNames(repoPath, details?.headSha ?? null, comparison?.base ?? null, comparison?.files);
  // A long list can be narrowed down; another pull request starts unfiltered, with every folder open.
  const [filter, setFilter] = useState({ key: files.key, query: "" });
  const query = filter.key === files.key ? filter.query : "";
  const [closedFolders, setClosedFolders] = useState({ key: files.key, paths: new Set<string>() });
  const closed = closedFolders.key === files.key ? closedFolders.paths : NONE_CLOSED;
  const toggleFolder = (path: string) => {
    const next = new Set(closed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setClosedFolders({ key: files.key, paths: next });
  };
  const [layout] = useFilesLayout();
  const all = comparison?.files;
  const shown = useMemo(() => (all ? (all.length > FILTER_FROM && query.trim() ? filterFiles(all, query, actors) : all) : []), [all, query, actors]);
  const rows = useMemo(() => (layout === "tree" ? fileTreeRows(shown, closed) : null), [layout, shown, closed]);
  const fileLine = (file: FileChange, depth?: number) => <FileLine file={file} depth={depth} onOpen={onOpenFile} shown={isShown(file.path)} comments={comments?.get(file.path)} />;

  return (
    <ActorNames.Provider value={actors}>
      <aside className="details request-files" aria-label={`${Noun} ${requestNumber(request)}'s files`}>
        <header className="details-header">
          <span className="details-label">{Noun}</span>
          <span className="spacer" />
          <Button kind="icon" onClick={onClose} title={`Close the ${noun} (Esc)`} aria-label={`Close the ${noun}`}>
            <CloseIcon />
          </Button>
        </header>
        <div className="details-scroll">
          <section className="details-message">
            <h2 className="details-summary">
              <span className="request-files-number">{requestNumber(request)}</span> {request.title}
            </h2>
            {details && (
              <p className="request-files-sides">
                <span className="mono">{details.branch}</span> → <span className="mono">{details.base}</span>
                {details.additions !== null && details.deletions !== null && (
                  <span className="request-files-lines">
                    <span className="added">+{details.additions.toLocaleString()}</span> <span className="removed">−{details.deletions.toLocaleString()}</span>
                  </span>
                )}
              </p>
            )}
          </section>
          <section className="details-section files">
            <div className="details-section-head">
              <h3>Changed files</h3>
              {all && <span className="details-section-note">{all.length.toLocaleString()}</span>}
              {all && all.length > 1 && <FilesLayoutSwitch />}
            </div>
            {error ? (
              <div className="details-error">{error}</div>
            ) : unknown ? (
              <div className="muted">{site} didn't say which commits it's between, so its files can't be read here.</div>
            ) : missing ? (
              <div className="request-files-missing">
                <p className="muted">Its commits aren't in this repository yet. Fetch them to see its files here.</p>
                {onFetch && (
                  <Button kind="outline" onClick={onFetch} title={`Fetch ${requestNumber(request)}'s commits from ${request.remote}`}>
                    <span className="button-label">Fetch its commits</span>
                  </Button>
                )}
              </div>
            ) : !comparison ? (
              <Loader size={48} title="Reading its files" />
            ) : comparison.files.length === 0 ? (
              <div className="muted">It doesn't change any files.</div>
            ) : (
              <>
                {comparison.files.length > FILTER_FROM && <FileFilter value={query} onChange={(value) => setFilter({ key: files.key, query: value })} shown={shown.length} total={comparison.files.length} />}
                {rows ? (
                  <FileList
                    items={rows}
                    keyOf={(row) => (row.kind === "folder" ? `folder:${row.path}` : `${row.file.status}:${row.file.oldPath ?? ""}:${row.file.path}`)}
                    render={(row) => (row.kind === "folder" ? <FolderLine row={row} onToggle={() => toggleFolder(row.path)} /> : fileLine(row.file, row.depth))}
                  />
                ) : (
                  <FileList items={shown} keyOf={(file) => `${file.status}:${file.oldPath ?? ""}:${file.path}`} render={(file) => fileLine(file)} />
                )}
                {shown.length === 0 && <div className="muted">No files match “{query.trim()}”.</div>}
              </>
            )}
          </section>
        </div>
      </aside>
    </ActorNames.Provider>
  );
}
