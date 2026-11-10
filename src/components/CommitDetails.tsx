import { useEffect, useMemo, useState, type ReactNode } from "react";
import { commitDetails, type CommitDetails, type CommitRow, type CommitSignature, type FileChange, type Lock, type Person, type WebRemote } from "../api";
import { useThemeColors } from "../app/useAppearance";
import { laneColor } from "../lib/colors";
import { dateInZone, fullDate, plural, shortId, utcOffset } from "../lib/format";
import { copyText } from "../lib/clipboard";
import { coAuthors } from "../lib/weblinks";
import { Avatar } from "./Avatar";
import { CheckIcon, CloseIcon, CopyIcon, KeyIcon } from "./Icons";
import { describeSignature } from "../lib/signatures";
import { CommitChecks } from "./CommitChecks";
import { MentionedIssues } from "./MentionedIssues";
import { MessageText } from "./MessageText";
import { RefPills } from "./RefPills";
import { FileLine } from "./FileLine";
import { FileFilter, FileList } from "./FileList";
import { ActorNames, useActorNames } from "../lib/actorNames";
import { FILTER_FROM, filterFiles } from "../lib/fileFilter";
import { highlightedFirst } from "../lib/diffTargets";
import { reflowBody } from "../lib/message";
import { Loader } from "./Loader";


interface Props {
  repoPath: string;
  commit: CommitRow;
  /** Details already loaded this session, by commit id. */
  cache: Map<string, CommitDetails>;
  hasCommit: (id: string) => boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Buttons shown under the commit's details, like "Hard reset main to this commit…". */
  actions: DetailsAction[];
  /** The remote that issue numbers like #12 in the message link to. */
  remote: WebRemote | undefined;
  /** An abbreviated commit id → the id of a loaded commit with it, or null. */
  resolveCommit: (prefix: string) => string | null;
  /** Right-click on a changed file. */
  onFileMenu?: (file: FileChange, x: number, y: number) => void;
  /** Files to show first and stand out, like the one whose history is highlighted. */
  isHighlighted?: (path: string) => boolean;
  /** A file's Git LFS lock. */
  lockOf?: (path: string) => Lock | undefined;
  /** Show a file's changes. */
  onOpenFile?: (file: FileChange) => void;
  /** The file whose changes are shown. */
  isShown?: (path: string) => boolean;
  /** Say what was done (like re-running failed checks). */
  notify?: (text: string) => void;
}

export interface DetailsAction {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
}

type Loaded = { id: string; details?: CommitDetails; error?: string };

export function CommitDetailsPanel(props: Props) {
  const colors = useThemeColors();
  const { repoPath, commit, cache, hasCommit, onSelect, onClose, actions, remote, resolveCommit } = props;
  const { onFileMenu, isHighlighted, lockOf, onOpenFile, isShown } = props;
  const [loaded, setLoaded] = useState<Loaded>({ id: commit.id, details: cache.get(commit.id) });

  useEffect(() => {
    const cached = cache.get(commit.id);
    if (cached) {
      setLoaded({ id: commit.id, details: cached });
      return;
    }
    setLoaded({ id: commit.id });
    let cancelled = false;
    // A short delay, so holding down an arrow key doesn't load every commit on the way.
    const timer = setTimeout(() => {
      commitDetails(repoPath, commit.id).then(
        (details) => {
          cache.set(commit.id, details);
          if (!cancelled) setLoaded({ id: commit.id, details });
        },
        (error) => {
          if (!cancelled) setLoaded({ id: commit.id, error: String(error) });
        },
      );
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [repoPath, commit.id, cache]);

  const current = loaded.id === commit.id ? loaded : { id: commit.id };
  const details = current.details;
  // A long list of files can be narrowed down; a new commit starts unfiltered.
  const [filter, setFilter] = useState({ id: commit.id, query: "" });
  const query = filter.id === commit.id ? filter.query : "";
  const setQuery = (value: string) => setFilter({ id: commit.id, query: value });
  // Unreal actors among the files, named as they are in the editor.
  const actors = useActorNames(repoPath, commit.id, null, details?.files);
  const files = useMemo(() => filterFiles(highlightedFirst(details?.files ?? [], isHighlighted), query, actors), [details, isHighlighted, query, actors]);
  const author: Person = details?.author ?? {
    name: commit.authorName,
    email: commit.authorEmail,
    time: commit.time,
    offset: 0,
  };
  const committer = details?.committer;
  const showCommitter =
    committer &&
    (committer.name !== author.name || committer.email !== author.email || Math.abs(committer.time - author.time) > 60);

  return (
    <ActorNames.Provider value={actors}>
      <aside className="details" aria-label="Commit details">
        <header className="details-header">
          <span className="details-label">{commit.kind === "stash" ? "Stash" : "Commit"}</span>
          <CopyButton text={commit.id} label={shortId(commit.id)} />
          <span className="spacer" />
          <button className="icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close details">
            <CloseIcon />
          </button>
        </header>

        <div className="details-scroll">
          <h2 className="details-summary">
            <MessageText
              text={details?.summary ?? commit.summary}
              remote={remote}
              resolveCommit={resolveCommit}
              onSelectCommit={onSelect}
            />
          </h2>
          {details?.body && (
            <div className="details-body">
              {reflowBody(details.body).map((block, index) => {
                const text = <MessageText text={block.text} remote={remote} resolveCommit={resolveCommit} onSelectCommit={onSelect} />;
                if (block.kind === "code") return <pre key={index} className="body-code">{text}</pre>;
                if (block.kind === "paragraph") return <p key={index} className="body-paragraph">{text}</p>;
                return (
                  <div key={index} className="body-item" style={{ paddingLeft: block.depth * 16 }}>
                    <span className="body-marker">{block.marker}</span>
                    <span>{text}</span>
                  </div>
                );
              })}
            </div>
          )}
          <MentionedIssues text={`${details?.summary ?? commit.summary}\n${details?.body ?? ""}\n${commit.refs.map((ref) => ref.name).join("\n")}`} />
          {props.notify && <CommitChecks repoPath={repoPath} id={commit.id} notify={props.notify} />}

          {commit.refs.length > 0 && (
            <div className="details-refs">
              <RefPills refs={commit.refs} color={laneColor(commit.graph.column, colors.lanes)} />
            </div>
          )}

          <div className="people">
            <PersonLine role="authored" person={author} exact={Boolean(details)} />
            {showCommitter && <PersonLine role="committed" person={committer} exact />}
            {details &&
              coAuthors(details.body).map((person) => (
                <PersonLine key={person.email} role="co-authored" person={{ ...person, time: 0, offset: 0 }} exact={false} />
              ))}
          </div>

          <dl className="meta">
            <dt>SHA</dt>
            <dd>
              <ShaButton sha={commit.id} />
            </dd>
            {details?.signature && (
              <>
                <dt>Signed</dt>
                <dd>
                  <SignatureMark signature={details.signature} />
                </dd>
              </>
            )}
            <dt>{commit.parents.length === 1 ? "Parent" : "Parents"}</dt>
            <dd className="parents">
              {commit.parents.length === 0 && <span className="muted">None (first commit)</span>}
              {commit.parents.map((parent) => (
                <button
                  key={parent}
                  className="sha-link"
                  onClick={() => onSelect(parent)}
                  disabled={!hasCommit(parent)}
                  title={hasCommit(parent) ? "Go to parent" : "Not loaded"}
                >
                  {shortId(parent)}
                </button>
              ))}
            </dd>
          </dl>

          {actions.length > 0 && (
            <div className="details-actions">
              {actions.map((action) => (
                <button
                  key={action.label}
                  className={action.danger ? "danger-outline-button" : "outline-button"}
                  onClick={action.onClick}
                  title={action.label}
                >
                  {action.icon}
                  <span className="button-label">{action.label}</span>
                </button>
              ))}
            </div>
          )}

          <section className="files">
            <h3>
              {details ? plural(details.files.length, "changed file") : "Changed files"}
              {commit.parents.length > 1 && <span className="hint">compared to the first parent</span>}
            </h3>
            {current.error ? (
              <div className="details-error">{current.error}</div>
            ) : !details ? (
              <Loader size={48} title="Reading the commit" />
            ) : details.files.length === 0 ? (
              <div className="muted">No file changes.</div>
            ) : (
              <>
                {details.files.length > FILTER_FROM && <FileFilter value={query} onChange={setQuery} shown={files.length} total={details.files.length} />}
                <FileList
                  items={files}
                  keyOf={(file) => `${file.status}:${file.oldPath ?? ""}:${file.path}`}
                  render={(file) => (
                    <FileLine
                      file={file}
                      highlighted={isHighlighted?.(file.path) || (file.oldPath ? isHighlighted?.(file.oldPath) : false)}
                      lock={lockOf?.(file.path)}
                      onContextMenu={onFileMenu}
                      onOpen={onOpenFile}
                      shown={isShown?.(file.path)}
                    />
                  )}
                />
                {files.length === 0 && <div className="muted">No files match “{query.trim()}”.</div>}
              </>
            )}
          </section>
        </div>
      </aside>
    </ActorNames.Provider>
  );
}

function PersonLine({ role, person, exact }: { role: string; person: Person; exact: boolean }) {
  return (
    <div className="person">
      <Avatar name={person.name} email={person.email} size={32} />
      <div className="person-text">
        <div className="person-name">
          <span className="person-full-name" title={person.name}>
            {person.name || "Unknown"}
          </span>
          <span className="person-email" title={person.email}>
            {person.email}
          </span>
        </div>
        <div className="person-when">
          {role}
          {person.time > 0 &&
            ` ${exact ? `${dateInZone(person.time, person.offset)} (${utcOffset(person.offset)})` : fullDate(person.time)}`}
        </div>
      </div>
    </div>
  );
}

/** Copies `text`, and says so for a moment afterwards. */
function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => void copyText(text).then(() => setCopied(true));
  return [copied, copy];
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, copy] = useCopy(text);
  return (
    <button className="copy-button" onClick={copy} title="Copy the full SHA">
      <span className="mono">{label}</span>
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
    </button>
  );
}

/** The full SHA: clicking it copies it. */
function ShaButton({ sha }: { sha: string }) {
  const [copied, copy] = useCopy(sha);
  return (
    <button className={`full-sha mono${copied ? " copied" : ""}`} onClick={copy} title={copied ? "Copied" : "Copy the full SHA"}>
      <span>{sha}</span>
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </button>
  );
}

/** "Verified" (or why not) for a signed commit, with who signed it. */
function SignatureMark({ signature }: { signature: CommitSignature }) {
  const { label, tone, detail } = describeSignature(signature);
  // The signer's name, without the address the details already show.
  const signer = signature.signer?.replace(/\s*<[^>]*>$/, "");
  return (
    <span className="signature-line" title={detail}>
      <span className={`signature-mark ${tone}`}>
        {tone === "good" ? <CheckIcon size={11} /> : tone === "bad" ? <CloseIcon size={11} /> : <KeyIcon size={11} />}
        {label}
      </span>
      {signer && <span className="signature-signer">{signer}</span>}
    </span>
  );
}
